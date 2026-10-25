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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, absPath, createProject, project as projectTable, type Project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { HOOK_MARKER, normalizeLyric, parseLrc, type TimedLine } from "../lrc";
import { cachedFileHash } from "./collection";

export const ALIGN_STORE_VERSION = 2; // 2: key without hook markers, LRC with word end tags

export type SongProject = { project: Project; songFile: string; songHash: string; created: boolean };

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

export async function findOrCreateSongProject(ws: Workspace, song: string, log: (m: string) => void = () => {}): Promise<SongProject> {
  if (!existsSync(song)) throw new Error(`Song not found: ${song}`);
  const songHash = await cachedFileHash(ws, song);
  const found = ws.db.select().from(projectTable).where(eq(projectTable.audio_hash, songHash)).get();
  if (found?.audio_path && existsSync(absPath(ws, found.audio_path))) {
    return { project: found, songFile: absPath(ws, found.audio_path), songHash, created: false };
  }
  if (found) {
    // The project's copy of the song went missing: copy it again.
    const target = absPath(ws, found.audio_path ?? `projects/${found.id}/audio/${path.basename(song)}`);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(song, target);
    return { project: found, songFile: target, songHash, created: false };
  }
  log(`new project for ${path.basename(song)}`);
  const created = await createProject(ws, { title: path.parse(song).name, audioFile: song });
  const updated = ws.db.update(projectTable).set({ audio_hash: songHash }).where(eq(projectTable.id, created.id)).returning().get();
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

export type LineReport = { number: number; text: string; is_hook: boolean; start_ms: number; end_ms: number; confidence: number };
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
  lines: TimedLine[]; // parsed, with hooks from lyrics.txt
};

export type AlignRunner = (args: { song: string; lyrics: string; out: string; report: string; hint?: string; fresh: boolean; lang: string }) => Promise<void>;

// Runs "pnpm align" (services/audio) with its output going straight to the terminal.
export const runAlignCommand: AlignRunner = (a) =>
  new Promise((resolve, reject) => {
    const args = [path.join(REPO_ROOT, "services/audio/scripts/align.mjs"), a.song, a.lyrics, "--out", a.out, "--report", a.report, "--lang", a.lang];
    if (a.hint) args.push("--hint", a.hint);
    if (a.fresh) args.push("--fresh");
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("pnpm align failed (see the messages above)."))));
  });

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
  const relDir = `projects/${sp.project.id}/lyrics`;
  const dir = absPath(ws, relDir);
  mkdirSync(dir, { recursive: true });
  const warnings: string[] = [];
  const hint = options.lrc ? null : projectHint(dir, options, log, warnings);

  // Keep a copy of the lyrics.txt this alignment was made from.
  const txtCopy = path.join(dir, `lyrics-${lyricsHash.slice(0, 12)}.txt`);
  if (!existsSync(txtCopy)) copyFileSync(options.lyricsTxt, txtCopy);

  let key: string;
  let name: string;
  let source: Alignment["source"];
  if (options.lrc) {
    const lrcHash = sha256(readFileSync(options.lrc));
    key = lrcHash.slice(0, 12);
    name = `given-${key}.lrc`;
    source = "given";
    if (!existsSync(path.join(dir, name))) copyFileSync(options.lrc, path.join(dir, name));
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
      const tmpLrc = path.join(dir, `.${name}.part`);
      const tmpReport = path.join(dir, `.${name}.report.part`);
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
export function storeProjectHint(ws: Workspace, projectId: string, hintFile: string): string {
  const dir = absPath(ws, `projects/${projectId}/lyrics`);
  mkdirSync(dir, { recursive: true });
  projectHint(dir, { hint: hintFile }, () => {}, []);
  return (JSON.parse(readFileSync(path.join(dir, "hint.json"), "utf8")) as StoredHint).copy;
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
    if (!existsSync(path.join(dir, copy))) writeFileSync(path.join(dir, copy), content);
    if (stored?.sha256 !== hash) {
      writeFileSync(record, `${JSON.stringify({ source: path.resolve(options.hint), copy, sha256: hash, stored_at: new Date().toISOString() }, null, 2)}\n`);
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
