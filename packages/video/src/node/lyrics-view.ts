// The Lyrics tab (Step 5c.2): every lyric line with its time stamp (the stored alignment), where it
// starts now (after the vocal-start check and hand-set times), what the viewer sees (when it fades in,
// is readable and leaves, by the same code as the render), confidence, the vocal-start check's
// verdict, and lines of lyrics.txt that look like labels, titles or credits. Saving nudges writes
// hand-set lines into hints.lrc (the stored alignment is kept); editing the text keeps the old
// lyrics.txt in .studio\replaced\ (words changed = aligned again on the next make).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, beat as beatTable, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { anchorProblems, checkAnchors, type AnchorSpec, type GapOrder } from "../anchors";
import { applyDownbeatOffset } from "../beats";
import { lyricFrames, rawLyric, type RenderBase } from "../compose";
import { VIDEO } from "../config";
import { parseHandTimes, withHandTimes } from "../hand-times";
import { HOOK_MARKER, normalizeLyric, type TimedLine } from "../lrc";
import { STRETCHED_WORD_MS, applyGuard, flagReason, likelyStart, type GuardMove } from "../vocal-guard";
import { CHECKED_BY_EAR_FILE, checkedByEar, type EarCheck } from "../checked-by-ear";
import { loadBrand } from "./brand";
import { loadFontCatalog } from "./font-catalog";
import { songAssets } from "./assets";
import { syncCollection } from "./collection";
import { keepReplaced, rememberedCollection } from "./project-settings";
import { readRecipe, writeRecipe } from "./recipe";
import { songPathsById } from "./song-folder";
import { dismissHandReset, noteHandTimesSaved, readHandRecord, resetAllHandTimes, resetHandTimesMadeBeforeStem, undoHandReset, type HandReset } from "./hand-reset";
import { DEMUCS, resolveVoiceSource } from "./voice-source";
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
  flagged: string | null; // why it is flagged for review (technical, for a tooltip)
  flagReason: string | null; // the same in plain words
  likelyStartMs: number | null; // a flagged line's likely start (two signals within ~1 s agree; the earlier one): the one-click "Use ..."
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
  instrumental: boolean; // the text is the story.txt of an instrumental (timed by the app, never aligned)
  anchors: AnchorsView;
  voice: "stem" | "demucs" | null; // what the timing listens to (null: no stored alignment)
  handReset: HandReset | null; // hand-set starts just reset (notice with Undo)
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
  // The vocal stem's alignment when there is one; until it is made (a new vocals.wav is being aligned),
  // the one on the vocals the app separated.
  const voice = await resolveVoiceSource(ws, sp);
  for (const v of voice.kind === "stem" ? [voice, DEMUCS] : [voice]) {
    for (const lang of ["en", "fr"]) {
      try {
        const alignment = await ensureAlignment(ws, sp, { lyricsTxt: paths.lyricsTxt, hint: hints ?? undefined, lang, durationMs: p.duration_ms ?? 600_000, align: refuse, voice: v });
        return { alignment, hints };
      } catch {
        // not aligned in this language
      }
    }
  }
  return null;
}

// Story anchors in the Lyrics tab: the song.json list, the clips it can choose from (the song's own and
// its collections, with thumbnails) and what will clash, per line.
export type AnchorClip = { name: string; thumb: string | null; kind: "video" | "photo"; durationMs: number; orientation: string; from: string }; // from: "song" or the collection
export type AnchorsView = { list: AnchorSpec[]; gapOrder: GapOrder | null; clips: AnchorClip[]; problems: { line: number; problem: string }[]; collections: string[] };

export async function anchorClips(ws: Workspace, projectId: string): Promise<{ clips: AnchorClip[]; collections: string[] }> {
  const paths = songPathsById(ws, projectId);
  const recipe = readRecipe(paths.recipe);
  const remembered = rememberedCollection(ws, projectId);
  const collections = recipe.collections ?? (remembered ? [remembered.name] : []);
  const own = await songAssets(ws, projectId);
  const clips: AnchorClip[] = own.clips.filter((c) => !c.duplicateOf).map((c) => ({ name: c.name, thumb: c.thumb, kind: c.kind, durationMs: c.durationMs, orientation: c.orientation, from: "song" }));
  for (const name of collections) {
    try {
      const sync = await syncCollection(ws, { name, prepare: false, ...(remembered?.name === name && remembered.folder ? { folder: remembered.folder } : {}) });
      for (const src of sync.sources) {
        if (clips.some((c) => c.name.toLowerCase() === src.name.toLowerCase())) continue;
        const photo = /\.(jpe?g|png|webp)$/i.test(src.name);
        const w = src.clip.width;
        const h = src.clip.height;
        clips.push({ name: src.name, thumb: src.clip.thumb_path, kind: photo ? "photo" : "video", durationMs: photo ? 0 : src.clip.duration_ms, orientation: Math.abs(w - h) <= Math.max(w, h) * 0.02 ? "square" : h > w ? "vertical" : "horizontal", from: name });
      }
    } catch {
      // A collection folder that is gone: its clips are not offered (make says so when it runs).
    }
  }
  return { clips, collections };
}

// Saves the anchors (and the gap order) in song.json; every other setting stays as it is.
export function saveAnchors(ws: Workspace, projectId: string, anchors: unknown, gapOrder?: GapOrder | null): AnchorSpec[] {
  const checked = checkAnchors(anchors);
  if (checked.problems.length) throw new Error(checked.problems.join("; "));
  const paths = songPathsById(ws, projectId);
  if (!paths.recipe) throw new Error("This song has no song folder yet (migrate it first).");
  const recipe = readRecipe(paths.recipe);
  const byLine = new Map(checked.anchors.map((a) => [a.line, a])); // one anchor per line (the last one given)
  const list = [...byLine.values()].sort((a, b) => a.line - b.line);
  const next = { ...recipe, anchors: list.length ? list : undefined };
  if (gapOrder !== undefined) next.gapOrder = gapOrder ?? undefined;
  writeRecipe(paths.recipe, next);
  return list;
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
        .filter((f) => (paths.instrumental ? /-story\.txt$/.test(f) : EARLIER_LYRICS.test(f) && !/-story\.txt$/.test(f))) // the lyrics under any name
        .sort()
        .reverse()
        .map((f) => ({ file: f, at: statSync(path.join(replacedDir, f)).mtime.toISOString(), lines: readFileSync(path.join(replacedDir, f), "utf8").split(/\r?\n/).filter((l) => l.trim()).length }))
    : [];
  const base = {
    title: p.title,
    lyricsText,
    labels: paths.instrumental ? [] : labelLines(lyricsText, p.title, p.artist),
    instrumental: paths.instrumental,
    song: p.audio_path ?? null,
    vocals: false,
    leadMs,
    gap,
    hintsFile: paths.hints ? path.relative(ws.dir, paths.hints).split(path.sep).join("/") : null,
    replaced,
    voice: null as LyricsView["voice"],
    handReset: null as HandReset | null,
  };
  const recipe = readRecipe(paths.recipe);
  const choice = await anchorClips(ws, projectId);
  const anchors: AnchorsView = { list: recipe.anchors ?? [], gapOrder: recipe.gapOrder ?? null, clips: choice.clips, collections: choice.collections, problems: [] };
  const current = await currentLines(ws, projectId);
  if (!current) return { ...base, anchors, lines: null, why: "This song has no stored alignment for its current lyrics.txt yet: make a video first (Generate), then its lines appear here.", checkRan: false };
  const { alignment, hand, guard, moves, lines, ear } = current;
  base.voice = alignment.voice?.kind ?? "demucs";
  base.handReset = paths.hints ? (readHandRecord(paths.hints)?.reset ?? null) : null;
  const valid = checkedByEar(ear, alignment.lrcHash, lines);
  const reports = matchReport(alignment.lines, alignment.report);
  const frames = lyricFrames({ plan: { start_frame: 0 }, lyrics: lines.map((l) => rawLyric(l)) } as unknown as RenderBase, leadMs, p.lyrics_offset_ms, true, gap);
  const ms = (f: number) => Math.round((f * 1000) / VIDEO.fps);
  const out: LyricsLine[] = lines.map((l, i) => {
      const check = guard?.check?.lines.find((c) => c.number === i + 1) ?? null;
      const flagged = !hand.skip.has(i) && check?.result === "flagged for review" ? check.why : null;
      const flaggedCheck = flagged !== null && check ? { stampMs: check.stamp_ms, voiceMs: check.voice_ms, wordsMs: check.words_ms, durationMs: check.duration_ms } : null;
      const heldNote = !!check && check.first_word_ms !== null && check.first_word_ms >= STRETCHED_WORD_MS && (l.isHook || i === lines.length - 1);
      const likely = flaggedCheck ? likelyStart(flaggedCheck) : null;
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
        flagReason: flaggedCheck ? flagReason(flaggedCheck, heldNote) : null,
        likelyStartMs: likely !== null && (i + 1 >= lines.length || likely < lines[i + 1].start_ms) ? likely : null, // never past the next line
        screen: { fadeInMs: frames[i].enterFrame !== undefined ? ms(frames[i].enterFrame!) : null, readableMs: ms(frames[i].startFrame), leaveMs: ms(frames[i].endFrame) },
        sungEndMs: l.sung_end_ms ?? null,
        checkedByEar: valid.has(i) ? (ear.find((c) => c.number === i + 1)?.at ?? null) : null,
        checkLapsed: !valid.has(i) && ear.some((c) => c.number === i + 1),
      };
    });
  // What the anchors will clash on (the same rules as pnpm make; per platform more can follow).
  const beats = applyDownbeatOffset(
    ws.db.select().from(beatTable).where(eq(beatTable.project_id, projectId)).all().sort((a, b) => a.time_ms - b.time_ms).map((b) => ({ time_ms: b.time_ms, strength: b.strength, is_downbeat: b.is_downbeat })),
    p.downbeat_offset ?? 0,
  );
  anchors.problems = anchorProblems(
    anchors.list,
    new Map(out.map((l) => [l.number, { text: l.text, shownMs: l.screen.readableMs, sungEndMs: l.sungEndMs ?? l.screen.leaveMs }])),
    new Map(anchors.clips.map((c) => [c.name.toLowerCase(), c.kind === "photo" ? null : c.durationMs])),
    beats.filter((b) => b.is_downbeat).map((b) => b.time_ms),
  );
  return { ...base, anchors, why: null, checkRan: !!guard?.check, lines: out };
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
  resetHandTimesMadeBeforeStem(paths.hints, stored.alignment.voice);
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
  noteHandTimesSaved(paths.hints, stored.alignment.voice); // made on this voice (the stem's starts stay)
  return times.size;
}

// "Reset all lines to the vocal stem's timing" (or the app's timing without a stem): every hand-set start
// goes; the old hints.lrc is kept in .studio\replaced\ and Undo brings them back.
export async function resetHandTimes(ws: Workspace, projectId: string, action: "all" | "undo" | "dismiss"): Promise<number> {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy || !paths.hints) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  if (action === "dismiss") {
    dismissHandReset(paths.hints);
    return 0;
  }
  const stored = await storedAlignment(ws, projectId);
  if (!stored) throw new Error("This song has no stored alignment yet: make a video first.");
  return action === "all" ? resetAllHandTimes(paths.hints, stored.alignment.voice) : undoHandReset(paths.hints, stored.alignment.voice);
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

// An earlier version of the lyrics in .studio\replaced\: "<time>-<its own name>.txt".
const EARLIER_LYRICS = /^[\dT-]+(\.\d+)?-.+\.txt$/;

// Undo: an earlier lyrics.txt from .studio\replaced\ back (the current one is kept there too).
export function restoreLyrics(ws: Workspace, projectId: string, file: string): { realign: boolean } {
  const paths = songPathsById(ws, projectId);
  if (!EARLIER_LYRICS.test(file) || path.basename(file) !== file) throw new Error("Not an earlier version of the lyrics.");
  const source = path.join(paths.root, ".studio", "replaced", file);
  if (!existsSync(source)) throw new Error("That earlier version is not there any more.");
  return saveLyricsText(ws, projectId, readFileSync(source, "utf8"));
}
