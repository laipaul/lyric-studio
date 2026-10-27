// The Lyrics tab (Step 5c.2): every lyric line with its time stamp (the stored alignment), where it
// starts now (after the vocal-start check and hand-set times), what the viewer sees (when it fades in,
// is readable and leaves, by the same code as the render), confidence, the vocal-start check's
// verdict, and lines of lyrics.txt that look like labels, titles or credits. Saving nudges writes
// hand-set lines into hints.lrc (the stored alignment is kept); editing the text keeps the old
// lyrics.txt in .studio\replaced\ (words changed = aligned again on the next make).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { lyricFrames, rawLyric, type RenderBase } from "../compose";
import { VIDEO } from "../config";
import { parseHandTimes, withHandTimes } from "../hand-times";
import { HOOK_MARKER, normalizeLyric, type TimedLine } from "../lrc";
import { applyGuard, type GuardMove } from "../vocal-guard";
import { CHECKED_BY_EAR_FILE, checkedByEar, type EarCheck } from "../checked-by-ear";
import { loadBrand } from "./brand";
import { loadFontCatalog } from "./font-catalog";
import { keepReplaced } from "./project-settings";
import { songPathsById } from "./song-folder";
import { applyHandSet, ensureAlignment, matchReport, wordsOfLyrics, type AlignRunner, type Alignment, type VocalGuard } from "./song-project";

export type LyricsLine = {
  number: number;
  text: string;
  isHook: boolean;
  alignedMs: number; // the stored alignment's stamp
  startMs: number; // where it starts now
  source: "alignment" | "vocal-start check" | "hand";
  confidence: number | null;
  lowConfidence: boolean;
  check: VocalGuard["check"]["lines"][number] | null; // the vocal-start check of the last pnpm make (if it checked this line)
  flagged: string | null; // why it is flagged for review
  screen: { fadeInMs: number | null; readableMs: number; leaveMs: number }; // what the viewer sees (song time)
  sungEndMs: number | null;
  checkedByEar: string | null; // when the user checked it by ear (still the same alignment, words and start)
  checkLapsed: boolean; // checked by ear before, but the alignment, words or start changed since
};

export type LabelFlag = { line: number; text: string; why: string }; // a line of lyrics.txt (1-based)

export type LyricsView = {
  title: string;
  lyricsText: string;
  labels: LabelFlag[];
  lines: LyricsLine[] | null; // null: no stored alignment yet
  why: string | null; // why there are no lines
  checkRan: boolean; // the vocal-start check's record exists for this alignment
  song: string | null; // workspace-relative song file (for the audio preview)
  vocals: boolean;
  leadMs: number;
  gap: { hideMs: number; leadInMs: number };
  hintsFile: string | null; // workspace-relative
  replaced: { file: string; at: string; lines: number }[]; // earlier lyrics.txt versions (newest first)
};

const LOW = 0.5;
const SECTION = /^(intro|outro|verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|hook|refrain|couplet|pont|instrumental|solo|interlude|break|drop|breakdown|ad[- ]?libs?)\b[\s\d:.#-]*$/i;

// Lines of lyrics.txt that are probably not sung: section labels, repeat marks, credits, the title at the top.
export function labelLines(lyricsText: string, title: string, artist: string): LabelFlag[] {
  const lines = lyricsText.replace(/^﻿/, "").split(/\r?\n/);
  const out: LabelFlag[] = [];
  const firstText = lines.findIndex((l) => l.trim());
  const key = (s: string) => normalizeLyric(s);
  const titleKey = key(title);
  lines.forEach((raw, i) => {
    const t = raw.trim().replace(HOOK_MARKER, "").trim();
    if (!t) return;
    let why: string | null = null;
    if (/^[[(].*[\])]$/.test(t)) why = "a label in brackets (e.g. [Chorus])";
    else if (SECTION.test(t.replace(/:$/, ""))) why = "a section label (verse, chorus, bridge, ...)";
    else if (/^\(?x\s?\d+\)?$/i.test(t) || /^\d+\s?x$/i.test(t)) why = "a repeat mark";
    else if (/\b(written|lyrics|words|music|produced|composed|mixed|mastered|arranged)\s+by\b/i.test(t) || /©|\bcopyright\b|all rights reserved/i.test(t)) why = "a credit line";
    else if (i === firstText && titleKey && (key(t) === titleKey || key(t) === key(`${title} ${artist}`) || key(t) === key(`${artist} ${title}`))) {
      const elsewhere = lines.some((o, k) => k !== i && key(o.replace(HOOK_MARKER, "")) === key(t));
      if (!elsewhere) why = "the song title at the top";
    }
    if (why) out.push({ line: i + 1, text: t, why });
  });
  return out;
}

const refuse: AlignRunner = async () => {
  throw new Error("no stored alignment");
};

// The song's stored alignment for its current lyrics.txt and hints (en, else fr); never aligns.
async function storedAlignment(ws: Workspace, projectId: string): Promise<{ alignment: Alignment; hints: string | null } | null> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p?.audio_path || !p.audio_hash) return null;
  const paths = songPathsById(ws, projectId);
  if (!existsSync(paths.lyricsTxt)) return null;
  const hints = paths.hints && existsSync(paths.hints) ? paths.hints : null;
  const sp = { project: p, songFile: absPath(ws, p.audio_path), songHash: p.audio_hash, created: false };
  for (const lang of ["en", "fr"]) {
    try {
      const alignment = await ensureAlignment(ws, sp, { lyricsTxt: paths.lyricsTxt, hint: hints ?? undefined, lang, durationMs: p.duration_ms ?? 600_000, align: refuse });
      return { alignment, hints };
    } catch {
      // not aligned in this language
    }
  }
  return null;
}

export async function lyricsView(ws: Workspace, projectId: string): Promise<LyricsView> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const paths = songPathsById(ws, projectId);
  const lyricsText = existsSync(paths.lyricsTxt) ? readFileSync(paths.lyricsTxt, "utf8") : "";
  const brand = loadBrand(ws.dir, loadFontCatalog(ws.dir), p.artist).brand;
  const gap = { hideMs: Math.round(brand.motion.gapHideS * 1000), leadInMs: Math.round(brand.motion.gapLeadInS * 1000) };
  const leadMs = 250;
  const replacedDir = path.join(paths.root, ".studio", "replaced");
  const replaced = existsSync(replacedDir)
    ? readdirSync(replacedDir)
        .filter((f) => /-lyrics\.txt$/.test(f))
        .sort()
        .reverse()
        .map((f) => ({ file: f, at: statSync(path.join(replacedDir, f)).mtime.toISOString(), lines: readFileSync(path.join(replacedDir, f), "utf8").split(/\r?\n/).filter((l) => l.trim()).length }))
    : [];
  const base = {
    title: p.title,
    lyricsText,
    labels: labelLines(lyricsText, p.title, p.artist),
    song: p.audio_path ?? null,
    vocals: false,
    leadMs,
    gap,
    hintsFile: paths.hints ? path.relative(ws.dir, paths.hints).split(path.sep).join("/") : null,
    replaced,
  };
  const current = await currentLines(ws, projectId);
  if (!current) return { ...base, lines: null, why: "This song has no stored alignment for its current lyrics.txt yet: make a video first (Generate), then its lines appear here.", checkRan: false };
  const { alignment, hand, guard, moves, lines, ear } = current;
  const valid = checkedByEar(ear, alignment.lrcHash, lines);
  const reports = matchReport(alignment.lines, alignment.report);
  const frames = lyricFrames({ plan: { start_frame: 0 }, lyrics: lines.map((l) => rawLyric(l)) } as unknown as RenderBase, leadMs, p.lyrics_offset_ms, true, gap);
  const ms = (f: number) => Math.round((f * 1000) / VIDEO.fps);
  return {
    ...base,
    why: null,
    checkRan: !!guard?.check,
    lines: lines.map((l, i) => {
      const check = guard?.check?.lines.find((c) => c.number === i + 1) ?? null;
      const flagged = !hand.skip.has(i) && check?.result === "flagged for review" ? check.why : null;
      const confidence = reports[i]?.confidence ?? null;
      return {
        number: i + 1,
        text: l.text,
        isHook: l.isHook,
        alignedMs: alignment.lines[i].start_ms,
        startMs: l.start_ms,
        source: hand.skip.has(i) ? "hand" : moves.some((m) => m.index === i) ? "vocal-start check" : "alignment",
        confidence,
        lowConfidence: confidence !== null && confidence < LOW,
        check,
        flagged,
        screen: { fadeInMs: frames[i].enterFrame !== undefined ? ms(frames[i].enterFrame!) : null, readableMs: ms(frames[i].startFrame), leaveMs: ms(frames[i].endFrame) },
        sungEndMs: l.sung_end_ms ?? null,
        checkedByEar: valid.has(i) ? (ear.find((c) => c.number === i + 1)?.at ?? null) : null,
        checkLapsed: !valid.has(i) && ear.some((c) => c.number === i + 1),
      };
    }),
  };
}

// The lines as the next video has them: the stored alignment, the hand-set starts (hints.lrc) and the
// vocal-start check's moves of the last make (hand-set lines are left alone); the "checked by ear" marks.
async function currentLines(ws: Workspace, projectId: string) {
  const stored = await storedAlignment(ws, projectId);
  if (!stored) return null;
  const { alignment, hints } = stored;
  const hand = applyHandSet(alignment, hints ?? undefined);
  const dir = path.dirname(alignment.lrcFile);
  const record = path.join(dir, `guard-${alignment.lrcHash.slice(0, 12)}.json`);
  const guard = existsSync(record) ? (JSON.parse(readFileSync(record, "utf8")) as { moves: VocalGuard["moves"]; check?: VocalGuard["check"] }) : null;
  const moves: GuardMove[] = (guard?.moves ?? [])
    .filter((m) => !hand.skip.has(m.number - 1))
    .map((m) => ({ index: m.number - 1, fromMs: m.from_ms, toMs: m.to_ms, ...(m.shortens_previous ? { shortensPrevious: true } : {}) }));
  const lines: TimedLine[] = applyGuard(hand.alignment.lines, moves);
  const earFile = path.join(dir, CHECKED_BY_EAR_FILE);
  const ear = existsSync(earFile) ? (JSON.parse(readFileSync(earFile, "utf8")) as EarCheck[]) : [];
  return { alignment, hand, guard, moves, lines, ear, earFile };
}

// "Checked by ear" on a line (or off again): kept with the song for this alignment, words and start.
export async function setCheckedByEar(ws: Workspace, projectId: string, number: number, checked: boolean, now = new Date()): Promise<void> {
  const current = await currentLines(ws, projectId);
  if (!current) throw new Error("This song has no stored alignment yet: make a video first.");
  const line = current.lines[number - 1];
  if (!line) throw new Error(`There is no line ${number}.`);
  const others = current.ear.filter((c) => c.number !== number);
  const next = checked ? [...others, { number, text: line.text, lrc: current.alignment.lrcHash, start_ms: line.start_ms, at: now.toISOString() }] : others;
  writeFileSync(current.earFile, `${JSON.stringify(next.sort((a, b) => a.number - b.number), null, 2)}\n`);
}

// The Lyrics tab's Save: hand-set starts for these lines (null = back to the alignment / check) in hints.lrc.
// The old hints.lrc is kept in .studio\replaced\. Returns how many lines are set by hand now.
export async function saveHandTimes(ws: Workspace, projectId: string, changes: readonly { number: number; ms: number | null }[]): Promise<number> {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy || !paths.hints) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const stored = await storedAlignment(ws, projectId);
  if (!stored) throw new Error("This song has no stored alignment yet: make a video first.");
  const current = existsSync(paths.hints) ? readFileSync(paths.hints, "utf8") : "";
  const times = new Map(parseHandTimes(current).map((t) => [t.number, t]));
  for (const c of changes) {
    const line = stored.alignment.lines[c.number - 1];
    if (!line) throw new Error(`There is no line ${c.number}.`);
    if (c.ms === null) times.delete(c.number);
    else {
      if (!Number.isFinite(c.ms) || c.ms < 0) throw new Error(`Line ${c.number}: not a time.`);
      times.set(c.number, { number: c.number, ms: Math.round(c.ms), text: line.text });
    }
  }
  const next = withHandTimes(current, [...times.values()]);
  if (next === current) return times.size;
  if (existsSync(paths.hints)) keepReplaced(paths.root, paths.hints, true);
  writeFileSync(paths.hints, next);
  return times.size;
}

// The Lyrics tab's text editor: a new lyrics.txt (the old one kept in .studio\replaced\). realign: the
// words changed, so the next make aligns again (hook markers and blank lines alone do not).
export function saveLyricsText(ws: Workspace, projectId: string, text: string): { changed: boolean; realign: boolean } {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  if (!text.trim()) throw new Error("The lyrics are empty.");
  const normalised = text.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
  const old = existsSync(paths.lyricsTxt) ? readFileSync(paths.lyricsTxt, "utf8") : "";
  if (old.replace(/\r\n/g, "\n") === normalised) return { changed: false, realign: false };
  if (old) keepReplaced(paths.root, paths.lyricsTxt, true);
  writeFileSync(paths.lyricsTxt, normalised);
  return { changed: true, realign: wordsOfLyrics(old) !== wordsOfLyrics(normalised) };
}

// Undo: an earlier lyrics.txt from .studio\replaced\ back (the current one is kept there too).
export function restoreLyrics(ws: Workspace, projectId: string, file: string): { realign: boolean } {
  const paths = songPathsById(ws, projectId);
  if (!/^[\dT-]+-lyrics\.txt$/.test(file)) throw new Error("Not an earlier lyrics.txt.");
  const source = path.join(paths.root, ".studio", "replaced", file);
  if (!existsSync(source)) throw new Error("That earlier version is not there any more.");
  return saveLyricsText(ws, projectId, readFileSync(source, "utf8"));
}
