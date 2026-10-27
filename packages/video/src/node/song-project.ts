// "pnpm make": the Project for a song (found again by the song's content hash) and its lyric timings.
//
// Lyric timings are immutable: every alignment is stored as its own file in
//   WORKSPACE_DIR\projects\<id>\lyrics\aligned-<key>-<time>.lrc   (+ .report.json with confidences)
// and is never rewritten afterwards. <key> is made from the words of lyrics.txt (hook markers "* "
// ignored: adding or removing a hook does not re-align), the hint file and the language, so the same
// inputs reuse the stored alignment and --realign adds a new file next to it. Hook lines always come
// from the current lyrics.txt.
//
// Hints (tapped times) are remembered per project: the first --hint is copied into the lyrics folder
// (hints-<hash>.lrc, recorded in hint.json) and used for every later alignment of the project. Corrections
// (the project's lyrics offset, and per-line overrides in Step 5e) are applied at render time.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, absPath, createProject, project as projectTable, type Project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { HOOK_MARKER, normalizeLyric, parseLrc, type TimedLine } from "../lrc";
import { clockText } from "../section";
import { applyGuard, asrWindows, checkVocalStart, earlyMs, type AsrWord, type LineCheck, type VoiceLevels } from "../vocal-guard";
import { cachedFileHash } from "./collection";
import { processAlive } from "./jobs";
import { ADDING_PREFIX, adoptIntoSongFolder, songPaths, songPathsById } from "./song-folder";

export const ALIGN_STORE_VERSION = 2; // 2: key without hook markers, LRC with word end tags

export type SongProject = { project: Project; songFile: string; songHash: string; created: boolean };

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

export async function findOrCreateSongProject(ws: Workspace, song: string, log: (m: string) => void = () => {}): Promise<SongProject> {
  if (!existsSync(song)) throw new Error(`Song not found: ${song}`);
  const songHash = await cachedFileHash(ws, song);
  const found = ws.db.select().from(projectTable).where(eq(projectTable.audio_hash, songHash)).get();
  if (found?.audio_path && existsSync(absPath(ws, found.audio_path))) {
    if (!found.folder && found.audio_path.startsWith(`songs/${ADDING_PREFIX}`)) {
      adoptIntoSongFolder(ws, found.id); // an interrupted adoption: finish it
      const done = ws.db.select().from(projectTable).where(eq(projectTable.id, found.id)).get()!;
      return { project: done, songFile: absPath(ws, done.audio_path!), songHash, created: false };
    }
    return { project: found, songFile: absPath(ws, found.audio_path), songHash, created: false };
  }
  if (found) {
    // The project's copy of the song went missing: copy it again.
    const target = absPath(ws, found.audio_path ?? (found.folder ? `${found.folder}/song${path.extname(song).toLowerCase()}` : `projects/${found.id}/audio/${path.basename(song)}`));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(song, target);
    return { project: found, songFile: target, songHash, created: false };
  }
  log(`new project for ${path.basename(song)}`);
  const created = await createProject(ws, { title: path.parse(song).name, audioFile: song });
  ws.db.update(projectTable).set({ audio_hash: songHash }).where(eq(projectTable.id, created.id)).run();
  adoptIntoSongFolder(ws, created.id, song); // its own folder: songs\<artist>\<title>\
  const updated = ws.db.select().from(projectTable).where(eq(projectTable.id, created.id)).get()!;
  return { project: updated, songFile: absPath(ws, updated.audio_path!), songHash, created: true };
}

// Hook lines marked with "* " in lyrics.txt (compared by words, like the LRC rules).
export function hookKeys(lyricsTxt: string): Set<string> {
  return new Set(
    lyricsTxt
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => HOOK_MARKER.test(l))
      .map(normalizeLyric),
  );
}

// early_ms: set by pnpm make from the vocal-start guard (how long after its start the voice begins).
export type LineReport = { number: number; text: string; is_hook: boolean; start_ms: number; end_ms: number; confidence: number; early_ms?: number | null };
export type AlignReport = { model: string; lang: string; low_confidence: number; lines: LineReport[] };

export type Alignment = {
  lrcFile: string; // full path (never modified)
  lrcStored: string; // workspace-relative
  lrcHash: string;
  report: AlignReport | null; // null when the LRC was given with --lrc
  source: "aligned" | "stored" | "given";
  key: string;
  lyricsTxt: string; // full path of the lyrics.txt used
  lyricsHash: string;
  hint: { file: string; hash: string; source: string; stored: boolean } | null; // stored: reused from an earlier --hint
  warnings: string[];
  lines: TimedLine[]; // parsed, with hooks from lyrics.txt (and the vocal-start guard's moves, see applyVocalGuard)
  guard?: VocalGuard | null; // null: not checked (a given LRC, or no vocal track)
};

// The vocal-start guard's result for one alignment (also written to guard-<lrc hash>.json).
export type VocalGuard = {
  moves: { number: number; text: string; from_ms: number; to_ms: number }[];
  earlyMs: (number | null)[]; // per line, after the moves: how long after its start the voice begins
  voiceMap: string; // workspace-relative
  // What was measured (printed by pnpm make and kept in the manifest): the song's singing level, the
  // voice threshold, and per checked line its stamp, where the voice starts, the difference and result.
  check: {
    level_db: number;
    threshold_db: number;
    words_check: string; // the recognised-words pass: "ran", or why it did not
    lines: {
      number: number;
      text: string;
      stamp_ms: number;
      voice_ms: number | null;
      words_ms: number | null;
      words_text: string | null;
      duration_ms: number | null;
      first_word_ms: number | null;
      loudest_before_db: number | null;
      target_ms: number;
      agree: string[];
      why: string;
      result: LineCheck["result"];
    }[];
  };
};

const seconds = (ms: number) => `${ms >= 0 ? "+" : "-"}${(Math.abs(ms) / 1000).toFixed(1)} s`;

export type VoiceMapRunner = (args: { song: string; out: string }) => Promise<void>;
export type FirstWordsRunner = (args: { song: string; windows: [number, number, number][]; lang: string; out: string }) => Promise<void>;

// A Node script of services/audio, its last messages in the error when it fails.
function runAudioScript(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "services/audio/scripts", script), ...args], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const tail: string[] = [];
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/[\r\n]+/)) if (line.trim()) tail.push(line.trim());
      tail.splice(0, Math.max(0, tail.length - 6));
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(alignFailure(tail)))));
  });
}

// The words sung around the checked lines (services/audio first_words: speech recognition on the vocal track).
export const runFirstWordsCommand: FirstWordsRunner = (a) => runAudioScript("first-words.mjs", [a.song, "--windows", JSON.stringify(a.windows), "--lang", a.lang, "--out", a.out]);

// Where the voice is heard (services/audio voice_map: the cached vocal stem; Demucs only if not cached).
export const runVoiceMapCommand: VoiceMapRunner = (a) => runAudioScript("voice-map.mjs", [a.song, "--out", a.out]);

// The vocal-start guard on an alignment (stored or new), never re-aligning: line 1 and lines after an
// instrumental gap that start more than 1 s before the voice move to where the voice starts. The voice
// map (the vocal track's level) is cached per song file (.studio/lyrics/voice-<song hash>.v2.json).
// What was measured is always printed, per checked line (stamp, voice start, difference, result), and
// recorded with the moves in guard-<lrc hash>.json next to the alignment. A given LRC (--lrc) is used
// as it is.
export async function applyVocalGuard(
  ws: Workspace,
  sp: SongProject,
  alignment: Alignment,
  options: { log?: (m: string) => void; voiceMap?: VoiceMapRunner; firstWords?: FirstWordsRunner } = {},
): Promise<Alignment> {
  const log = options.log ?? (() => {});
  if (alignment.source === "given") return { ...alignment, guard: null };
  if (!options.voiceMap && process.env.LYRIC_VOICE_MAP === "off") return { ...alignment, guard: null }; // the tests
  const dir = path.dirname(alignment.lrcFile);
  const mapFile = path.join(dir, `voice-${sp.songHash.slice(0, 12)}.v2.json`);
  if (!existsSync(mapFile)) {
    log("lyrics: vocal-start check: reading where the voice is heard (the cached vocal track; Demucs only if it is not cached)");
    const tmp = path.join(dir, `.voice-${sp.songHash.slice(0, 12)}.${process.pid}.part`);
    try {
      await (options.voiceMap ?? runVoiceMapCommand)({ song: sp.songFile, out: tmp });
      renameSync(tmp, mapFile);
    } catch (error) {
      rmSync(tmp, { force: true });
      const why = (error as Error).message.split("\n").pop();
      alignment.warnings.push(`The vocal-start check was skipped (${why}).`);
      log(`lyrics: vocal-start check skipped: ${why}`);
      return { ...alignment, guard: null };
    }
  }
  const map = JSON.parse(readFileSync(mapFile, "utf8")) as { hop_ms: number; db: number[] };
  const levels: VoiceLevels = { hopMs: map.hop_ms, db: map.db };
  // The recognised words around the checked lines (cached per song, windows and language).
  const windows = asrWindows(alignment.lines, levels);
  const lang = alignment.report?.lang ?? "en";
  let asr: Map<number, AsrWord[]> | undefined;
  let wordsCheck = "ran";
  if (windows.length && !options.firstWords && process.env.LYRIC_VOICE_MAP === "off") wordsCheck = "off (tests)";
  else if (windows.length) {
    const key = sha256(`v1|${sp.songHash}|${JSON.stringify(windows)}|${lang}|${process.env.FIRST_WORDS_MODEL ?? "small"}`).slice(0, 12);
    const wordsFile = path.join(dir, `words-${key}.json`);
    if (!existsSync(wordsFile)) {
      log(`lyrics: vocal-start check: recognising the first sung words of ${windows.length} line(s) (a short speech-recognition pass on the vocal track; never re-aligns)`);
      const tmp = path.join(dir, `.words-${key}.${process.pid}.part`);
      try {
        await (options.firstWords ?? runFirstWordsCommand)({ song: sp.songFile, windows, lang, out: tmp });
        renameSync(tmp, wordsFile);
      } catch (error) {
        rmSync(tmp, { force: true });
        wordsCheck = `skipped: ${(error as Error).message.split("\n").pop()}`;
        log(`lyrics: vocal-start check: recognised words ${wordsCheck}`);
      }
    }
    if (existsSync(wordsFile)) {
      const words = JSON.parse(readFileSync(wordsFile, "utf8")) as { windows: { line: number; words: AsrWord[] }[] };
      asr = new Map(words.windows.map((w) => [w.line - 1, w.words]));
    }
  }
  const check = checkVocalStart(alignment.lines, levels, { asr });
  const lines = applyGuard(alignment.lines, check.moves);
  log(`vocal-start check: singing level ${check.levelDb.toFixed(1)} dB; voice = at least 0.5 s above ${check.thresholdDb.toFixed(1)} dB; recognised words: ${wordsCheck}`);
  for (const c of check.lines) {
    const at = (ms: number | null) => (ms === null ? "–" : clockText(ms));
    const heard = c.wordsMs === null ? "words –" : `words ${at(c.wordsMs)} "${c.wordsText}"`;
    const stretched = c.firstWordMs !== null && c.firstWordMs >= 1000 ? ` (first word ${(c.firstWordMs / 1000).toFixed(1)} s)` : "";
    const loud = c.loudestBeforeDb !== null && c.loudestBeforeDb > -90 ? `; loudest sound before it ${c.loudestBeforeDb.toFixed(1)} dB` : "";
    const change = c.result === "moved" ? ` (${seconds(c.targetMs - c.stampMs)})` : "";
    log(`vocal-start check: line ${c.index + 1} stamp ${at(c.stampMs)} · voice ${at(c.voiceMs)} · ${heard} · word durations ${at(c.durationMs)}${stretched} -> ${at(c.targetMs)}: ${c.result}${change}; ${c.why}${loud}`);
  }
  for (const m of check.moves) log(`guard: line ${m.index + 1} moved from ${clockText(m.fromMs)} to ${clockText(m.toMs)} (vocals start)`);
  const guard: VocalGuard = {
    moves: check.moves.map((m) => ({ number: m.index + 1, text: lines[m.index].text, from_ms: m.fromMs, to_ms: m.toMs })),
    earlyMs: earlyMs(lines, check.stretches),
    voiceMap: path.relative(ws.dir, mapFile).split(path.sep).join("/"),
    check: {
      level_db: check.levelDb,
      threshold_db: check.thresholdDb,
      words_check: wordsCheck,
      lines: check.lines.map((c) => ({
        number: c.index + 1,
        text: alignment.lines[c.index].text,
        stamp_ms: c.stampMs,
        voice_ms: c.voiceMs,
        words_ms: c.wordsMs,
        words_text: c.wordsText,
        duration_ms: c.durationMs,
        first_word_ms: c.firstWordMs,
        loudest_before_db: c.loudestBeforeDb,
        target_ms: c.targetMs,
        agree: c.agree,
        why: c.why,
        result: c.result,
      })),
    },
  };
  const record = path.join(dir, `guard-${alignment.lrcHash.slice(0, 12)}.json`);
  const text = `${JSON.stringify({ alignment: path.basename(alignment.lrcFile), voice_map: path.basename(mapFile), moves: guard.moves, check: guard.check }, null, 2)}\n`;
  if (!existsSync(record) || readFileSync(record, "utf8") !== text) writeFileAtomic(record, text);
  return { ...alignment, lines, guard };
}

export type AlignRunner = (args: { song: string; lyrics: string; out: string; report: string; hint?: string; fresh: boolean; lang: string }) => Promise<void>;

// Runs "pnpm align" (services/audio) with its output going straight to the terminal.
export const runAlignCommand: AlignRunner = (a) =>
  new Promise((resolve, reject) => {
    const args = [path.join(REPO_ROOT, "services/audio/scripts/align.mjs"), a.song, a.lyrics, "--out", a.out, "--report", a.report, "--lang", a.lang];
    if (a.hint) args.push("--hint", a.hint);
    if (a.fresh) args.push("--fresh");
    // The output still shows as it comes (terminal), and its last lines go into the error, so the
    // studio's Tasks menu can say why it failed (e.g. the AI packages are not installed).
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const tail: string[] = [];
    const keep = (chunk: Buffer, to: NodeJS.WriteStream) => {
      to.write(chunk);
      for (const line of chunk.toString("utf8").split(/[\r\n]+/)) if (line.trim()) tail.push(line.trim());
      tail.splice(0, Math.max(0, tail.length - 8));
    };
    child.stdout.on("data", (c: Buffer) => keep(c, process.stdout));
    child.stderr.on("data", (c: Buffer) => keep(c, process.stderr));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`pnpm align failed:\n${alignFailure(tail)}`))));
  });

// The useful part of the aligner's last messages (not progress bars).
export function alignFailure(lines: readonly string[]): string {
  const useful = lines.filter((l) => !/^\d+%|it\/s\]$|^\[?[#=\-> ]+\]?$/.test(l));
  return (useful.length ? useful : lines).slice(-4).join("\n") || "no message";
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export async function ensureAlignment(
  ws: Workspace,
  sp: SongProject,
  options: {
    lyricsTxt: string;
    hint?: string;
    noHint?: boolean; // align without the project's stored hints (warns)
    lrc?: string; // use this LRC instead of aligning (stored as-is)
    realign?: boolean;
    lang?: string;
    durationMs: number;
    log?: (m: string) => void;
    align?: AlignRunner;
    now?: Date;
  },
): Promise<Alignment> {
  const log = options.log ?? (() => {});
  const lang = options.lang ?? "en";
  for (const f of [options.lyricsTxt, options.hint, options.lrc]) if (f && !existsSync(f)) throw new Error(`File not found: ${f}`);
  const txtContent = readFileSync(options.lyricsTxt);
  const lyricsHash = sha256(txtContent);
  const relDir = songPaths(ws, sp.project).storeRel;
  const dir = absPath(ws, relDir);
  mkdirSync(dir, { recursive: true });
  const warnings: string[] = [];
  cleanInterrupted(dir, log);
  const hint = options.lrc ? null : projectHint(dir, options, log, warnings);

  // Keep a copy of the lyrics.txt this alignment was made from.
  const txtCopy = path.join(dir, `lyrics-${lyricsHash.slice(0, 12)}.txt`);
  if (!existsSync(txtCopy)) writeFileAtomic(txtCopy, txtContent);

  let key: string;
  let name: string;
  let source: Alignment["source"];
  if (options.lrc) {
    const lrcHash = sha256(readFileSync(options.lrc));
    key = lrcHash.slice(0, 12);
    name = `given-${key}.lrc`;
    source = "given";
    if (!existsSync(path.join(dir, name))) writeFileAtomic(path.join(dir, name), readFileSync(options.lrc));
  } else {
    key = sha256(`v${ALIGN_STORE_VERSION}|${sha256(wordsOfLyrics(txtContent.toString("utf8")))}|${hint?.hash ?? ""}|${lang}`).slice(0, 12);
    const stored = readdirSync(dir)
      .filter((f) => f.startsWith(`aligned-${key}-`) && f.endsWith(".lrc") && existsSync(path.join(dir, f.replace(/\.lrc$/, ".report.json"))))
      .sort();
    if (stored.length && !options.realign) {
      name = stored[stored.length - 1];
      source = "stored";
      log(`lyrics: using the stored alignment ${name} (--realign to align again)`);
    } else {
      name = `aligned-${key}-${stamp(options.now ?? new Date())}.lrc`;
      for (let n = 2; existsSync(path.join(dir, name)); n++) name = `aligned-${key}-${stamp(options.now ?? new Date())}-${n}.lrc`;
      // The aligner writes into temporary files; the alignment is stored only when it has finished and
      // its output is complete (the .lrc appearing is the commit point). Ctrl+C, Stop or a crash leaves
      // only temporary files, which the next run removes.
      const tmpLrc = path.join(dir, `.${name}.${process.pid}.part`);
      const tmpReport = path.join(dir, `.${name}.report.${process.pid}.part`);
      if (!stored.length) for (const line of whyNotStored(dir, txtContent.toString("utf8"), hint?.hash ?? "", lang)) log(`lyrics: ${line}`);
      log(`lyrics: aligning ${path.basename(options.lyricsTxt)} with pnpm align${hint ? ` (hint ${path.basename(hint.file)})` : ""}`);
      try {
        await (options.align ?? runAlignCommand)({
          song: sp.songFile,
          lyrics: path.resolve(options.lyricsTxt),
          out: tmpLrc,
          report: tmpReport,
          hint: hint?.file,
          fresh: !!options.realign,
          lang,
        });
        checkAlignerOutput(tmpLrc, tmpReport, txtContent.toString("utf8"));
        renameSync(tmpReport, path.join(dir, name.replace(/\.lrc$/, ".report.json")));
        renameSync(tmpLrc, path.join(dir, name));
      } finally {
        rmSync(tmpLrc, { force: true });
        rmSync(tmpReport, { force: true });
      }
      source = "aligned";
    }
  }

  const lrcFile = path.join(dir, name);
  const content = readFileSync(lrcFile, "utf8");
  const reportFile = lrcFile.replace(/\.lrc$/, ".report.json");
  const report = source !== "given" && existsSync(reportFile) ? (JSON.parse(readFileSync(reportFile, "utf8")) as AlignReport) : null;

  const hooks = hookKeys(txtContent.toString("utf8"));
  // Hooks from the current lyrics.txt only (a "* " removed there is no longer a hook).
  const lines = parseLrc(content, options.durationMs).map((l) => ({ ...l, isHook: hooks.has(normalizeLyric(l.text)) }));
  return {
    lrcFile,
    lrcStored: `${relDir}/${name}`,
    lrcHash: sha256(content),
    report,
    source,
    key,
    lyricsTxt: path.resolve(options.lyricsTxt),
    lyricsHash,
    hint,
    lines,
    warnings,
  };
}

// Why a song with stored alignments is aligned again: which input differs from the newest one
// (its lyrics words, the hints or the language). Lines to print; empty when nothing was stored.
export function whyNotStored(dir: string, lyricsText: string, hintHash: string, lang: string): string[] {
  const aligned = readdirSync(dir)
    .filter((f) => /^aligned-[0-9a-f]{12}-.*\.lrc$/.test(f))
    .sort((a, b) => statSync(path.join(dir, b)).mtimeMs - statSync(path.join(dir, a)).mtimeMs);
  if (!aligned.length) return [];
  const keyOf = (words: string, h: string, l: string) => sha256(`v${ALIGN_STORE_VERSION}|${sha256(words)}|${h}|${l}`).slice(0, 12);
  const keys = new Set(aligned.map((f) => f.slice("aligned-".length, "aligned-".length + 12)));
  const copies = readdirSync(dir)
    .filter((f) => /^lyrics-[0-9a-f]{12}\.txt$/.test(f))
    .sort((a, b) => statSync(path.join(dir, b)).mtimeMs - statSync(path.join(dir, a)).mtimeMs);
  const words = wordsOfLyrics(lyricsText);
  const out = [`no stored alignment for these words, hints and language (${aligned.length} stored for this song), so it aligns again (never overwritten).`];
  const hints = [hintHash, ""];
  for (const f of readdirSync(dir).filter((x) => /^hints-[0-9a-f]{12}\.lrc$/.test(x))) hints.push(sha256(readFileSync(path.join(dir, f))));
  if (hints.some((h) => h !== hintHash && keys.has(keyOf(words, h, lang)))) {
    out.push("the same words were aligned with other hints before: the stored hints changed (or --no-hint / --hint).");
    return out;
  }
  if (["en", "fr"].some((l) => l !== lang && keys.has(keyOf(words, hintHash, l)))) {
    out.push(`the same words were aligned in another language before (not --lang ${lang}).`);
    return out;
  }
  for (const c of copies) {
    const other = wordsOfLyrics(readFileSync(path.join(dir, c), "utf8"));
    if (other === words || !hints.some((h) => keys.has(keyOf(other, h, lang)))) continue;
    const a = words.split("\n");
    const b = other.split("\n");
    const i = a.findIndex((line, n) => line !== b[n]);
    const at = i < 0 ? b.length : i;
    out.push(
      `the stored alignment was made from other words (${path.join(dir, c)}). First difference, line ${at + 1}: ` +
        `now "${a[at] ?? "(no line)"}", stored "${b[at] ?? "(no line)"}". Use those words again to reuse it.`,
    );
    return out;
  }
  return out;
}

// Writes a file completely or not at all (a temporary file renamed at the end).
export function writeFileAtomic(file: string, content: string | Buffer): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.part`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// Leftovers of an alignment that was interrupted (Ctrl+C, Stop, a crash): temporary files of processes
// that are gone, and a report whose .lrc never appeared. They were never used; removed.
export function cleanInterrupted(dir: string, log: (m: string) => void = () => {}): string[] {
  if (!existsSync(dir)) return [];
  const removed: string[] = [];
  for (const f of readdirSync(dir)) {
    const part = /^\..*\.(\d+)\.part$/.exec(f);
    const oldPart = /^\..*\.part$/.test(f) && !part; // from before the process id was in the name
    const orphan = /^aligned-.*\.report\.json$/.test(f) && !existsSync(path.join(dir, f.replace(/\.report\.json$/, ".lrc"))) && Date.now() - statSync(path.join(dir, f)).mtimeMs > 60_000;
    if ((part && !processAlive(Number(part[1]))) || oldPart || orphan) {
      rmSync(path.join(dir, f), { force: true });
      removed.push(f);
    }
  }
  if (removed.length) log(`lyrics: removed ${removed.length} file(s) left by an interrupted alignment (never used)`);
  return removed;
}

// The aligner's output must be complete before it is stored: every lyric line timed in the .lrc, and
// a report with one entry per line.
export function checkAlignerOutput(lrcFile: string, reportFile: string, lyricsText: string): void {
  const expected = lyricsText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(HOOK_MARKER, "").trim())
    .filter(Boolean).length;
  const problem = (why: string) => new Error(`pnpm align finished without a complete result (${why}); nothing was stored. Run it again.`);
  if (!existsSync(lrcFile)) throw problem("no .lrc written");
  const timed = parseLrc(readFileSync(lrcFile, "utf8"), Number.MAX_SAFE_INTEGER).filter((l) => l.text.trim()).length; // also a last line without an end stamp
  if (timed !== expected) throw problem(`${timed} of ${expected} lines timed`);
  if (!existsSync(reportFile)) throw problem("no report written");
  let lines: unknown;
  try {
    lines = (JSON.parse(readFileSync(reportFile, "utf8")) as { lines?: unknown }).lines;
  } catch {
    throw problem("the report is not valid JSON");
  }
  if (!Array.isArray(lines) || lines.length !== expected) throw problem(`the report has ${Array.isArray(lines) ? lines.length : 0} of ${expected} lines`);
}

// lyrics.txt without its hook markers: what the alignment depends on.
export function wordsOfLyrics(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(HOOK_MARKER, ""))
    .join("\n")
    .trim();
}

type StoredHint = { source: string; copy: string; sha256: string; stored_at: string };

// The hint file for this alignment: a new --hint is stored for the project; without --hint the
// stored one is reused; --no-hint (or a lost copy) aligns without it, with a clear warning.
// Stores a hints file (tapped times) with the project, as the first --hint does: later alignments
// use it automatically. Returns the stored copy's name.
// `source`: how the hints are named in messages (default: the file's path).
export function storeProjectHint(ws: Workspace, projectId: string, hintFile: string, source?: string): string {
  const dir = songPathsById(ws, projectId).store;
  mkdirSync(dir, { recursive: true });
  projectHint(dir, { hint: hintFile }, () => {}, []);
  const record = path.join(dir, "hint.json");
  const stored = JSON.parse(readFileSync(record, "utf8")) as StoredHint;
  if (source) writeFileAtomic(record, `${JSON.stringify({ ...stored, source }, null, 2)}\n`);
  return stored.copy;
}

function projectHint(
  dir: string,
  options: { hint?: string; noHint?: boolean },
  log: (m: string) => void,
  warnings: string[],
): Alignment["hint"] {
  const record = path.join(dir, "hint.json");
  const stored = existsSync(record) ? (JSON.parse(readFileSync(record, "utf8")) as StoredHint) : null;
  if (options.hint) {
    const content = readFileSync(options.hint);
    const hash = sha256(content);
    const copy = `hints-${hash.slice(0, 12)}.lrc`;
    if (!existsSync(path.join(dir, copy))) writeFileAtomic(path.join(dir, copy), content);
    if (stored?.sha256 !== hash) {
      writeFileAtomic(record, `${JSON.stringify({ source: path.resolve(options.hint), copy, sha256: hash, stored_at: new Date().toISOString() }, null, 2)}\n`);
      log(`hints: ${path.basename(options.hint)} stored with the project; later alignments use it automatically`);
    }
    return { file: path.join(dir, copy), hash, source: path.resolve(options.hint), stored: false };
  }
  if (!stored) return null;
  if (options.noHint) {
    warnings.push(`This project normally aligns with the hints from ${stored.source}; aligning WITHOUT them (--no-hint).`);
    return null;
  }
  const file = path.join(dir, stored.copy);
  if (!existsSync(file) || sha256(readFileSync(file)) !== stored.sha256) {
    warnings.push(`The stored hints for this project (from ${stored.source}) are missing or changed; aligning WITHOUT hints. Pass --hint again to store them.`);
    return null;
  }
  log(`using stored hints from ${stored.source} (stored ${stored.stored_at.slice(0, 10)})`);
  return { file, hash: stored.sha256, source: stored.source, stored: true };
}

// The aligner's per-line values for each parsed line (matched in order by text).
export function matchReport(lines: readonly TimedLine[], report: AlignReport | null): (LineReport | null)[] {
  if (!report) return lines.map(() => null);
  let from = 0;
  return lines.map((l) => {
    const key = normalizeLyric(l.text);
    const index = report.lines.findIndex((r, i) => i >= from && normalizeLyric(r.text) === key);
    if (index < 0) return null;
    from = index + 1;
    return report.lines[index];
  });
}
