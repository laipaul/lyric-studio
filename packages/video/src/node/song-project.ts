// "pnpm make": the Project for a song (found again by the song's content hash) and its lyric timings.
//
// Lyric timings are immutable: every alignment is stored as its own file in
//   WORKSPACE_DIR\projects\<id>\lyrics\aligned-<key>-<time>.lrc   (+ .report.json with confidences)
// and is never rewritten afterwards. <key> is made from lyrics.txt, the --hint file and the language,
// so the same inputs reuse the stored alignment and --realign adds a new file next to it. Corrections
// (the project's lyrics offset, and per-line overrides in Step 5e) are applied at render time.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, absPath, createProject, project as projectTable, type Project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { HOOK_MARKER, normalizeLyric, parseLrc, type TimedLine } from "../lrc";
import { cachedFileHash } from "./collection";

export const ALIGN_STORE_VERSION = 1;

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
  hint: { file: string; hash: string } | null;
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
  const hint = options.hint ? { file: path.resolve(options.hint), hash: sha256(readFileSync(options.hint)) } : null;
  const relDir = `projects/${sp.project.id}/lyrics`;
  const dir = absPath(ws, relDir);
  mkdirSync(dir, { recursive: true });

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
    key = sha256(`v${ALIGN_STORE_VERSION}|${lyricsHash}|${hint?.hash ?? ""}|${lang}`).slice(0, 12);
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
  const lines = parseLrc(content, options.durationMs).map((l) => ({ ...l, isHook: l.isHook || hooks.has(normalizeLyric(l.text)) }));
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
  };
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
