// Singing lines (Lyrics Sync → Singer, 21 Nov 2026, Paul's workflow): Paul ticks the lines where the singer shows and
// picks, per line, a picture or video from Creation. The app cuts the vocal for each line (the vocal stem, lined up on
// the song; else the song itself), sends it with the picture or video to WaveSpeed InfiniteTalk (his own key; cost
// first, the spending cap), and each singing clip comes back:
//   - into Creation, as a take of its picture labelled "Lip sync · line N" (pictures\takes\<picture> sings line N.mp4,
//     without sound: the vocal is never kept in any file);
//   - into the Storyboard (the end of his story line; he may move it) and onto its line as a story anchor with "sync":
//     the song second its first frame belongs to. Make cuts it in on the beat and plays it in time with the song
//     (anchors.ts), never slowed, never used for other shots.
// Lines in a row sung from the same picture or video are one RUN: one continuous take from just before the first line
// to two bars after the last (one request, one cost), placed on the first line with "through" = the last line, so the
// singer stays on screen, lips in time, until the last line is sung (Paul, 21 Nov 2026: "the missing part"). A pause
// between two lines longer than RUN_GAP_MS (an instrumental break) starts a new run.
// The vocal piece runs from just before the downbeat before the line to two bars after it is sung, so the cut and the
// hold that follow always have footage, and the lips sing what the song sings there.
// The song and the stem are only read (FFmpeg decodes a piece into a temporary file). Requests are never retried.
// Settings: <song folder>\pictures\singer.json { "lines": { "<line>": "<Creation file>" }, "scripts": { "<first line of a block>": "what the
// singer does" } }: the little script goes to InfiniteTalk with the voice (its optional prompt: expression and pose).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, beat as beatTable, ffmpegBin, project as projectTable, uniqueFileName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { applyDownbeatOffset } from "../beats";
import { type PicturesView } from "./animate";
import { nextTakeN } from "./animate";
import { BOARD_VIDEO_FILE, itemLabel, makePlayable, PICTURE_FILE, POLL_MS, TAKES_DIR, TIMEOUT_MS, WAVESPEED, data, json, keyFor, readPictures, setTake, sleepMs, songFolder, update, waveSpeedUpload, type Take } from "./animate";
import { importSongClips } from "./assets";
import { setClipLabel, setClipOmit } from "./clip-edits";
import { download, errorText } from "./characters/fal";
import { lyricsView, saveAnchors } from "./lyrics-view";
import { feelFor, filmLookFor } from "./film-looks";
import { singingRealism, type Feel } from "./realism";
import { feelingWords } from "../feelings";
import { feelingForLines, type TakeFeeling } from "./section-feelings";
import { readRecipe } from "./recipe";
import { songPaths, songPathsById } from "./song-folder";
import { storedStemCheck } from "./voice-source";

export const SINGER_FILE = "singer.json";
// The resolution asked of InfiniteTalk (Lyrics Sync → Singer bar, saved per video in singer.json; 720p by default, the
// only one sent before 21 Nov 2026) and its price per second (WaveSpeed price list, 21 Nov 2026).
export const LIPSYNC_RESOLUTIONS = ["480p", "720p"] as const;
export type LipsyncResolution = (typeof LIPSYNC_RESOLUTIONS)[number];
export const LIPSYNC_RESOLUTION: LipsyncResolution = "720p"; // the default
export const LIPSYNC_USD_PER_SECOND_AT: Record<LipsyncResolution, number> = { "480p": 0.03, "720p": 0.06 };
export const LIPSYNC_USD_PER_SECOND = LIPSYNC_USD_PER_SECOND_AT[LIPSYNC_RESOLUTION];
export const isLipsyncResolution = (v: unknown): v is LipsyncResolution => LIPSYNC_RESOLUTIONS.includes(v as LipsyncResolution);
export const LIPSYNC_MIN_SECONDS = 3; // billed at least 3 s, rounded up to whole seconds
export const LIPSYNC_MODEL = "InfiniteTalk";
const LEAD_MS = 500; // the piece starts this long before the downbeat the shot cuts in on
const TAIL_BARS = 2; // and runs two bars past the line's sung end (the shot holds until the next regular cut)
export const RUN_GAP_MS = 8000; // lines in a row with the same picture and at most this pause between them: one take

export type SingerSettings = { lines: Record<string, string>; scripts?: Record<string, string>; resolution?: LipsyncResolution };
export const SCRIPT_MAX = 200;
// Every singing take asks InfiniteTalk to SING, not talk (Paul, 21 Nov 2026: a calm portrait came back "talking"):
// this cue opens the prompt, then Paul's own script. SINGING_STYLE marks takes made with it; a block made before it
// shows as to make again (only made when Paul presses Make singing clips, cost first).
export const SINGING_CUE = "A person singing a song with deep emotion, like a live music performance: wide open mouth on sustained notes, expressive lips and jaw following the melody, visible breathing between phrases, eyes closing on long notes, natural head and shoulder movement with the rhythm";
export const SINGING_STYLE = 1;
// The song's Film look line (film-looks.ts), as the take was recorded with it, closes the prompt.
// The realism rules of the take's feel (realism.ts) follow the cue; a take made before them (no feel) keeps its old prompt.
// Then the feeling of the lines' section (feelings.ts), changing over the take when its lines run into another section.
export const singingPrompt = (script: string, look?: string, feel?: Feel, feeling?: string, feelingTo?: string) =>
  [SINGING_CUE, feel ? singingRealism(feel) : "", feelingWords(feeling, feelingTo), script.trim().replace(/\.$/, ""), look ? `Film look, the same in every shot: ${look.trim().replace(/\.$/, "")}` : ""].filter(Boolean).join(". ");
// parts: a vocal piece longer than PART_MAX_MS is made in parts of about PART_TARGET_MS (Joey's 4-10 s rule, Paul 22 Nov
// 2026: "6 to 8 s the lips are not in sync"), each its own request, chained from the last frame of the one before and
// joined into one take; seconds / usd are then the parts' (each billed at least 3 s, whole seconds).
export type Piece = { fromMs: number; toMs: number; seconds: number; usd: number; parts?: { fromMs: number; toMs: number }[] };
export const PART_MAX_MS = 10_000; // a piece up to this long is one request
export const PART_TARGET_MS = 8_000; // else parts of about this long
export const PART_MIN_MS = 4_000; // and never shorter than this
// A take of a group (the same picture or video, the same lines), as Lyrics Sync lists it under the group.
// inUse: its clip is the singing anchor on those lines now. fresh: a later take not chosen yet ("New — compare").
export type GroupTake = Take & { inUse: boolean; fresh: boolean };
export type SingerLine = {
  number: number;
  text: string;
  source: string | null; // the Creation file sung from (null: not ticked)
  piece: Piece; // what would be sent for this line's run (the same on every line of a run)
  script: string; // the block's little script (what the singer does; on every line of the block)
  run: { first: number; last: number } | null; // the run of lines in a row sung from the same source, in one take
  take: (Take & { file?: string }) | null; // the newest singing take of this line's run from its source
  takes: GroupTake[]; // every singing take of this group (its source, its lines), oldest first (only on a run's first line)
  needed: boolean; // ticked and without a finished or running take of this source and piece (only on a run's first line)
};
export type SingerView = {
  lines: SingerLine[] | null; // null: no timed lines yet
  why: string | null;
  sources: { file: string; label: string | null; url: string; kind: "picture" | "video" }[]; // Creation's pictures and videos (url: workspace-relative)
  voice: "stem" | "song";
  ready: boolean; // WAVESPEED_API_KEY (or the stand-in)
  keyName: string;
  toMake: { lines: number[]; seconds: number; usd: number };
  usdPerSecond: number; // at the chosen resolution
  resolution: LipsyncResolution; // what the next take is made at (singer.json; 720p by default)
  song: string | null; // workspace-relative song file (a take plays with the song from its first frame's song time)
  folder: string; // workspace-relative Creation folder (a take's file is <folder>/<take.file>)
  running: number; // singing takes being made now
};

export function readSinger(dir: string): SingerSettings {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, SINGER_FILE), "utf8")) as Partial<SingerSettings>;
    return { lines: raw.lines && typeof raw.lines === "object" ? raw.lines : {}, ...(raw.scripts && typeof raw.scripts === "object" ? { scripts: raw.scripts } : {}), ...(isLipsyncResolution(raw.resolution) ? { resolution: raw.resolution } : {}) };
  } catch {
    return { lines: {} };
  }
}
function writeSinger(dir: string, s: SingerSettings): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, SINGER_FILE), `${JSON.stringify({ _help: "Lyrics Sync → Singer: the lines where the singer shows, each with the Creation picture or video it is sung from. Written by the app.", ...s }, null, 2)}\n`);
}

// The vocal piece for a line: from just before the downbeat at or before the line shows, to two bars after it is sung.
export function singingPiece(line: { shownMs: number; sungEndMs: number }, downbeats: readonly number[], songMs: number, usdPerSecond = LIPSYNC_USD_PER_SECOND): Piece {
  const gaps = downbeats.slice(1).map((d, i) => d - downbeats[i]).sort((a, b) => a - b);
  const bar = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2000;
  const cutAt = downbeats.filter((d) => d <= line.shownMs).at(-1) ?? line.shownMs - bar;
  let fromMs = Math.max(0, Math.round((cutAt - LEAD_MS) / 10) * 10);
  let toMs = Math.min(songMs, Math.round((line.sungEndMs + TAIL_BARS * bar) / 10) * 10);
  if (toMs - fromMs < LIPSYNC_MIN_SECONDS * 1000) {
    toMs = Math.min(songMs, fromMs + LIPSYNC_MIN_SECONDS * 1000);
    fromMs = Math.max(0, toMs - LIPSYNC_MIN_SECONDS * 1000);
  }
  const seconds = Math.max(LIPSYNC_MIN_SECONDS, Math.ceil((toMs - fromMs) / 1000));
  return { fromMs, toMs, seconds, usd: Math.round(seconds * usdPerSecond * 100) / 100 };
}

// The parts of a long vocal piece: cut on a downbeat near every PART_TARGET_MS (between PART_MIN_MS and PART_MAX_MS from
// the last cut, leaving at least PART_MIN_MS), a downbeat in a pause between sung lines first. Short pieces: one part.
export function singingParts(piece: Piece, downbeats: readonly number[], lines: readonly { shownMs: number; sungEndMs: number }[], usdPerSecond = LIPSYNC_USD_PER_SECOND): Piece {
  if (piece.toMs - piece.fromMs <= PART_MAX_MS) return piece;
  const parts: { fromMs: number; toMs: number }[] = [];
  const sung = (t: number) => lines.some((l) => l.shownMs <= t && t <= l.sungEndMs);
  let start = piece.fromMs;
  while (piece.toMs - start > PART_MAX_MS) {
    const lo = start + PART_MIN_MS;
    const hi = Math.min(start + PART_MAX_MS, piece.toMs - PART_MIN_MS);
    const near = (list: number[]) => list.sort((a, b) => Math.abs(a - (start + PART_TARGET_MS)) - Math.abs(b - (start + PART_TARGET_MS)))[0];
    const inWindow = downbeats.filter((d) => d >= lo && d <= hi);
    const cut = near(inWindow.filter((d) => !sung(d))) ?? near(inWindow) ?? Math.min(hi, start + PART_TARGET_MS);
    parts.push({ fromMs: start, toMs: Math.round(cut) });
    start = Math.round(cut);
  }
  parts.push({ fromMs: start, toMs: piece.toMs });
  const seconds = parts.reduce((n, x) => n + Math.max(LIPSYNC_MIN_SECONDS, Math.ceil((x.toMs - x.fromMs) / 1000)), 0);
  return { ...piece, seconds, usd: Math.round(seconds * usdPerSecond * 100) / 100, parts };
}

type Ctx = { root: string; dir: string; songRel: string | null; songFile: string; songMs: number; lines: { number: number; text: string; shownMs: number; sungEndMs: number }[] | null; why: string | null; downbeats: number[] };
async function context(ws: Workspace, projectId: string): Promise<Ctx> {
  const { root, dir } = songFolder(ws, projectId);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p?.audio_path) throw new Error("Song not found.");
  const view = await lyricsView(ws, projectId);
  const beats = applyDownbeatOffset(
    ws.db.select().from(beatTable).where(eq(beatTable.project_id, projectId)).all().sort((a, b) => a.time_ms - b.time_ms).map((b) => ({ time_ms: b.time_ms, strength: b.strength, is_downbeat: b.is_downbeat })),
    p.downbeat_offset ?? 0,
  );
  return {
    root,
    dir,
    songRel: p.audio_path ?? null,
    songFile: absPath(ws, p.audio_path),
    songMs: p.duration_ms ?? 600_000,
    lines: view.lines?.map((l) => ({ number: l.number, text: l.text, shownMs: l.screen.readableMs, sungEndMs: l.sungEndMs ?? l.screen.leaveMs })) ?? null,
    why: view.why,
    downbeats: beats.filter((b) => b.is_downbeat).map((b) => b.time_ms),
  };
}

// Every singing take of a group: the same picture or video, the same first and last line (oldest first).
function groupTakes(dir: string, source: string, first: number, last: number): Take[] {
  const rec = readPictures(dir).pictures[source];
  return (rec?.takes ?? []).filter((t) => t.kind === "lipsync" && t.line === first && (t.through ?? t.line) === last).map((t) => (t.clip && !t.sent ? { ...t, sent: t.clip } : t));
}
// The singing anchors of the song now: "first:last:clip" (lower case), to tell which take is in use.
function singingAnchorKeys(ws: Workspace, projectId: string): Set<string> {
  const recipe = songPathsById(ws, projectId).recipe;
  return new Set((recipe ? (readRecipe(recipe).anchors ?? []) : []).filter((a) => a.sync !== undefined).map((a) => `${a.line}:${a.through ?? a.line}:${a.clip.toLowerCase()}`));
}
const inUseKey = (t: Take) => (t.sent ? `${t.line}:${t.through ?? t.line}:${t.sent.toLowerCase()}` : "");

// The runs: ticked lines in a row (by number) with the same source and a short pause between them.
export function singingRuns(lines: readonly { number: number; shownMs: number; sungEndMs: number }[], settings: SingerSettings, gapMs = RUN_GAP_MS): { source: string; first: number; last: number }[] {
  const runs: { source: string; first: number; last: number; endMs: number }[] = [];
  for (const l of [...lines].sort((a, b) => a.number - b.number)) {
    const source = settings.lines[String(l.number)];
    if (!source) continue;
    const prev = runs.at(-1);
    if (prev && prev.source === source && prev.last === l.number - 1 && l.shownMs - prev.endMs <= gapMs) {
      prev.last = l.number;
      prev.endMs = l.sungEndMs;
    } else runs.push({ source, first: l.number, last: l.number, endMs: l.sungEndMs });
  }
  return runs.map(({ source, first, last }) => ({ source, first, last }));
}
// A group is made when one of its takes (running, done, or sent and waiting for its result) has this vocal piece and
// the singing cue. A new mood text or resolution does not make a group "to make" again: Retake makes another take.
const covers = (t: Take, piece: Piece) => (t.status === "running" || t.status === "done" || t.status === "interrupted") && t.sync_ms === piece.fromMs && t.to_ms === piece.toMs && t.style === SINGING_STYLE;

export async function singerView(ws: Workspace, projectId: string, env: NodeJS.ProcessEnv = process.env): Promise<SingerView> {
  const c = await context(ws, projectId);
  const settings = readSinger(c.dir);
  const board = readPictures(c.dir).pictures;
  const rel = path.relative(ws.dir, c.dir).split(path.sep).join("/");
  const sources = existsSync(c.dir)
    ? readdirSync(c.dir)
        .filter((f) => (PICTURE_FILE.test(f) || BOARD_VIDEO_FILE.test(f)) && statSync(path.join(c.dir, f)).isFile())
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((f) => ({ file: f, label: board[f]?.label ?? null, url: `${rel}/${f}`, kind: PICTURE_FILE.test(f) ? ("picture" as const) : ("video" as const) }))
    : [];
  const runs = c.lines ? singingRuns(c.lines, settings) : [];
  const byNumber = new Map((c.lines ?? []).map((l) => [l.number, l]));
  const resolution = settings.resolution ?? LIPSYNC_RESOLUTION;
  const usdPerSecond = LIPSYNC_USD_PER_SECOND_AT[resolution];
  const anchors = singingAnchorKeys(ws, projectId);
  const lines = c.lines?.map((l) => {
    const source = settings.lines[String(l.number)] ?? null;
    const run = runs.find((r) => r.first <= l.number && l.number <= r.last) ?? null;
    const first = run ? byNumber.get(run.first)! : l;
    const last = run ? byNumber.get(run.last)! : l;
    // A picture's long piece is made in parts (a video source stays one request: its motion cannot be chained).
    const whole = singingPiece({ shownMs: first.shownMs, sungEndMs: last.sungEndMs }, c.downbeats, c.songMs, usdPerSecond);
    const piece = source && BOARD_VIDEO_FILE.test(source) ? whole : singingParts(whole, c.downbeats, c.lines ?? [], usdPerSecond);
    const all = source && run ? groupTakes(c.dir, source, run.first, run.last) : [];
    const take = all.at(-1) ?? null;
    const script = run ? (settings.scripts?.[String(run.first)] ?? "") : "";
    const takes: GroupTake[] = run?.first === l.number ? all.map((t) => ({ ...t, inUse: t.status === "done" && anchors.has(inUseKey(t)), fresh: !!t.fresh && t.status === "done" })) : [];
    return { number: l.number, text: l.text, source, piece, script, run: run ? { first: run.first, last: run.last } : null, take, takes, needed: !!source && run?.first === l.number && !all.some((t) => covers(t, piece)) };
  }) ?? null;
  const toMake = (lines ?? []).filter((l) => l.needed);
  return {
    lines,
    why: c.lines ? null : c.why,
    sources,
    voice: (await voiceFor(ws, projectId)).kind,
    ready: !!env.LYRIC_GENERATE_STUB || !!keyFor("wavespeed", env),
    keyName: "WAVESPEED_API_KEY",
    toMake: { lines: toMake.map((l) => l.number), seconds: toMake.reduce((s, l) => s + l.piece.seconds, 0), usd: Math.round(toMake.reduce((s, l) => s + l.piece.usd, 0) * 100) / 100 },
    usdPerSecond,
    resolution,
    song: c.songRel,
    folder: rel,
    running: (lines ?? []).reduce((n, l) => n + l.takes.filter((t) => t.status === "running").length, 0),
  };
}

// The resolution singing clips are made at from now on (this video's singer.json); takes already made keep theirs.
export function setSingerResolution(ws: Workspace, projectId: string, resolution: unknown): SingerSettings {
  if (!isLipsyncResolution(resolution)) throw new Error(`Choose ${LIPSYNC_RESOLUTIONS.join(" or ")}.`);
  const { dir } = songFolder(ws, projectId);
  const next = { ...readSinger(dir), resolution };
  writeSinger(dir, next);
  return next;
}

// Tick or untick a line, or choose what it is sung from (null: not a singing line).
export function setSingerLine(ws: Workspace, projectId: string, line: unknown, source: unknown): SingerSettings {
  const { dir } = songFolder(ws, projectId);
  const n = Number(line);
  if (!Number.isInteger(n) || n < 1) throw new Error("Choose a line.");
  const s = readSinger(dir);
  if (source === null || source === undefined || source === "") {
    delete s.lines[String(n)];
    // No singer on this line: the singing clip that covers it leaves (and is set to Omit, see saveAnchors); the other
    // lines of its run are made again as their own run.
    const recipe = readRecipe(songPathsById(ws, projectId).recipe);
    const covering = (a: { line: number; sync?: number; through?: number }) => a.sync !== undefined && a.line <= n && n <= (a.through ?? a.line);
    if ((recipe.anchors ?? []).some(covering)) saveAnchors(ws, projectId, (recipe.anchors ?? []).filter((a) => !covering(a)));
  } else {
    const name = path.basename(String(source));
    if (!(PICTURE_FILE.test(name) || BOARD_VIDEO_FILE.test(name)) || !existsSync(path.join(dir, name))) throw new Error(`No ${name} in this song's Creation space: add the picture or video there first.`);
    s.lines[String(n)] = name;
  }
  writeSinger(dir, s);
  return s;
}

// The little script of the block that starts on `line` (what the singer does: "turns to the sea, soft smile"); empty
// removes it. A block already made is made again only when Paul presses Make singing clips (the cost shows first).
export function setSingerScript(ws: Workspace, projectId: string, line: unknown, text: unknown): SingerSettings {
  const { dir } = songFolder(ws, projectId);
  const n = Number(line);
  if (!Number.isInteger(n) || n < 1) throw new Error("Choose a line.");
  const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, SCRIPT_MAX);
  const s = readSinger(dir);
  const scripts = { ...(s.scripts ?? {}) };
  if (clean) scripts[String(n)] = clean;
  else delete scripts[String(n)];
  const next = { ...s, scripts };
  writeSinger(dir, next);
  return next;
}

// The voice sent to the model: the vocal stem (lined up on the song by the stem check) when it follows the song, else
// the song itself.
type Voice = { kind: "stem"; file: string; offsetMs: number; speed?: number } | { kind: "song" };
async function voiceFor(ws: Workspace, projectId: string, project?: typeof projectTable.$inferSelect): Promise<Voice> {
  const p = project ?? ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) return { kind: "song" };
  const paths = songPaths(ws, p);
  if (!paths.vocals || !existsSync(paths.vocals)) return { kind: "song" };
  const stored = p.audio_hash ? await storedStemCheck(ws, { project: p, songHash: p.audio_hash }).catch(() => null) : null;
  if (stored?.check.status === "rejected") return { kind: "song" };
  return { kind: "stem", file: paths.vocals, offsetMs: stored?.check.offset_ms ?? 0, ...(typeof stored?.check.speed === "number" ? { speed: stored.check.speed } : {}) };
}

// A piece of the voice as a WAV (song time fromMs → toMs; the stem's offset and speed applied).
export function cutVoice(voice: Voice, songFile: string, piece: { fromMs: number; toMs: number }, out: string): void {
  const durS = (piece.toMs - piece.fromMs) / 1000;
  if (voice.kind === "stem") {
    const speed = voice.speed ?? 1;
    const startS = Math.max(0, (voice.offsetMs + speed * piece.fromMs) / 1000);
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", startS.toFixed(3), "-t", (durS * speed).toFixed(3), "-i", voice.file, ...(speed !== 1 ? ["-af", `atempo=${speed}`] : []), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
  } else {
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", (piece.fromMs / 1000).toFixed(3), "-t", durS.toFixed(3), "-i", songFile, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
  }
}

// ---------------------------------------------------------------- a take with the song (Creation's player)

// Where each take belongs in the song (Paul, 21 Nov 2026: "why can't I hear the song with the take? it would be easier to
// check"): a singing take from its own first frame (sync_ms: the vocal piece it was made from); an Animate take shown on
// a line from the downbeat that line cuts in on (minus where in the clip it starts). A take on no line has no place in
// the song yet. Adds song / songFromMs / clipInS / songWhy to the view (Creation plays the song file with the silent take).
export async function withSongStarts(ws: Workspace, projectId: string, view: PicturesView): Promise<PicturesView> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p?.audio_path) return view;
  const recipe = songPathsById(ws, projectId).recipe;
  const plain = (recipe ? (readRecipe(recipe).anchors ?? []) : []).filter((a) => a.sync === undefined);
  const placed = (t: Take) => {
    const clip = (t.sent ?? t.clip)?.toLowerCase();
    return clip ? plain.filter((a) => a.clip.toLowerCase() === clip).sort((a, b) => a.line - b.line)[0] : undefined;
  };
  const needLines = view.pictures.some((pic) => pic.takes.some((t) => t.kind !== "lipsync" && t.status === "done" && placed(t)));
  const c = needLines ? await context(ws, projectId).catch(() => null) : null;
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
  for (const pic of view.pictures) {
    pic.takes = pic.takes.map((t) => {
      if (t.status !== "done") return t;
      if (t.kind === "lipsync" && t.sync_ms !== undefined) return { ...t, songFromMs: t.sync_ms, clipInS: 0, songWhy: `with the song from ${clock(t.sync_ms)}, where this take's vocal starts: the lips should sing what the song sings` };
      const a = placed(t);
      const line = a && c?.lines?.find((l) => l.number === a.line);
      if (!a || !line || !c) return t;
      const cut = c.downbeats.filter((d) => d <= line.shownMs).at(-1) ?? line.shownMs;
      return { ...t, songFromMs: cut, clipInS: a.clipIn ?? 0, songWhy: `with the song from ${clock(cut)}, where line ${a.line} cuts to it` };
    });
  }
  return { ...view, song: p.audio_path };
}

// ---------------------------------------------------------------- the service

export type SingTransport = {
  upload: (file: string) => Promise<string>;
  submit: (o: { image?: string; video?: string; audio: string; prompt?: string; resolution?: LipsyncResolution }) => Promise<{ id: string }>;
  poll: (id: string) => Promise<{ status: "running" } | { status: "done"; url: string } | { status: "failed"; error: string }>;
  download: (url: string, file: string) => Promise<void>;
};

export function infiniteTalkTransport(key: string, f: typeof fetch = (...a) => globalThis.fetch(...a)): SingTransport {
  const auth = { Authorization: `Bearer ${key}` };
  return {
    upload: (file) => waveSpeedUpload(key, file, f),
    submit: async (o) => {
      const model = o.video ? "wavespeed-ai/infinitetalk/video-to-video" : "wavespeed-ai/infinitetalk";
      const body = { ...(o.video ? { video: o.video } : { image: o.image }), audio: o.audio, ...(o.prompt ? { prompt: o.prompt } : {}), resolution: o.resolution ?? LIPSYNC_RESOLUTION, seed: -1 };
      const b = data(await json(await f(`${WAVESPEED}/${model}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), "WaveSpeed InfiniteTalk"));
      if (typeof b.id !== "string") throw new Error("WaveSpeed: no request id in the answer");
      return { id: b.id };
    },
    poll: async (id) => {
      const r = await f(`${WAVESPEED}/predictions/${encodeURIComponent(id)}/result`, { headers: auth });
      if (r.status === 429 || r.status >= 500) return { status: "running" };
      const b = data(await json(r, "WaveSpeed"));
      const s = String(b.status ?? "");
      if (s === "completed") {
        const url = (b.outputs as unknown[] | undefined)?.find((x): x is string => typeof x === "string");
        return url ? { status: "done", url } : { status: "failed", error: "finished without a video" };
      }
      if (["failed", "cancelled", "timeout", "deleted"].includes(s)) return { status: "failed", error: String(b.error || s) };
      return { status: "running" };
    },
    download: (url, file) => download(url, file, writeFileSync, undefined, f),
  };
}

// Tests and the cloud (LYRIC_GENERATE_STUB): a clip as long as the voice, made from the picture (or the video's first
// frame) by FFmpeg, with the voice as its sound (as the real service returns it); nothing sent anywhere.
let stubTakes = 0; // every stand-in take a little different (as the real ones are), across requests
export function stubSingTransport(mode: string): SingTransport {
  const files = new Map<string, string>();
  let n = 0;
  return {
    upload: async (file) => {
      const url = `stub://${++n}`;
      files.set(url, file);
      return url;
    },
    submit: async (o) => {
      if (mode === "fail") throw new Error("stand-in: the service refused the request");
      return { id: JSON.stringify({ picture: files.get(o.image ?? o.video ?? "") ?? "", audio: files.get(o.audio) ?? "", take: ++stubTakes }) };
    },
    poll: async (id) => ({ status: "done", url: id }),
    download: async (url, file) => {
      const { picture, audio, take } = JSON.parse(url) as { picture: string; audio: string; take?: number };
      const still = PICTURE_FILE.test(picture);
      execFileSync(ffmpegBin(), ["-y", "-v", "error", ...(still ? ["-loop", "1"] : ["-stream_loop", "-1"]), "-i", picture, "-i", audio, "-shortest", "-r", "30", "-vf", `scale=trunc(iw/2)*2:trunc(ih/2)*2,drawbox=x=${(take ?? 0) % 40}:y=0:w=2:h=2:color=white:t=fill,format=yuv420p`, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", file]);
    },
  };
}

export function singTransportFor(env: NodeJS.ProcessEnv = process.env): SingTransport {
  if (env.LYRIC_GENERATE_STUB) return stubSingTransport(env.LYRIC_GENERATE_STUB);
  const key = keyFor("wavespeed", env);
  if (!key) throw new Error("No WAVESPEED_API_KEY in .env: add a line WAVESPEED_API_KEY=<your key from wavespeed.ai → API keys> to D:\\videomaker\\.env, then restart Lyric Studio.");
  return infiniteTalkTransport(key);
}

// ---------------------------------------------------------------- make the singing clips

export type SingJob = { source: string; n: number };

// "Make singing clips": checks the cost against the cap and records a running take for every ticked line that has no
// clip for its source and piece yet (a line already made is never paid for twice). `lines`: only these.
export async function startSinging(ws: Workspace, projectId: string, o: { capUsd: number; lines?: number[] }, env: NodeJS.ProcessEnv = process.env): Promise<{ jobs: SingJob[]; usd: number; seconds: number }> {
  const view = await singerView(ws, projectId, env);
  if (!view.lines) throw new Error(view.why ?? "This song's lines are not timed yet.");
  const todo = view.lines.filter((l) => l.needed && (!o.lines || o.lines.includes(l.number)));
  if (!todo.length) throw new Error("Nothing to make: tick the lines where the singer shows (each with its picture or video), or they are made already.");
  if (!view.ready) singTransportFor(env); // throws the plain-words message
  const usd = Math.round(todo.reduce((s, l) => s + l.piece.usd, 0) * 100) / 100;
  const seconds = todo.reduce((s, l) => s + l.piece.seconds, 0);
  const cap = Number(o.capUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (usd > cap) throw new Error(`${todo.length} singing line${todo.length === 1 ? "" : "s"} (${seconds} s of voice) cost about $${usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: tick fewer lines or raise the cap. Nothing was sent.`);
  const { dir } = songFolder(ws, projectId);
  const now = new Date().toISOString();
  const look = filmLookFor(ws, projectId);
  const feel = feelFor(ws, projectId);
  const jobs = todo.map((l) => recordTake(dir, l, view.resolution, now, look, feel, feelingForLines(ws, projectId, l.number, l.run?.last)));
  return { jobs, usd, seconds };
}

// A new running take of a group (its picture, its lines, its vocal piece, the mood text and resolution of now).
function recordTake(dir: string, l: SingerLine, resolution: LipsyncResolution, now: string, look: { name: string; line: string } | null, feel: Feel, feeling: TakeFeeling = {}): SingJob {
  let n = 0;
  update(dir, l.source!, (p) => {
    n = nextTakeN(p);
    p.takes.push({ n, kind: "lipsync", line: l.number, ...(l.run && l.run.last > l.number ? { through: l.run.last } : {}), sync_ms: l.piece.fromMs, to_ms: l.piece.toMs, ...(l.piece.parts ? { parts: l.piece.parts.map((x) => ({ ...x })) } : {}), ...(l.script ? { prompt: l.script } : {}), style: SINGING_STYLE, ...(look ? { filmLook: look.name, look: look.line } : {}), feel, ...feeling, resolution, service: "wavespeed", quality: "best", model: LIPSYNC_MODEL, status: "running", started_at: now, cost_usd: l.piece.usd, pid: process.pid });
  });
  return { source: l.source!, n };
}

// "Retake" (Lyrics Sync, next to "singing clip on lines X–Y"): the same group again as a new take: the same picture or
// video, the same piece of the vocal, the mood text and resolution of now. Earlier takes are never touched; the new one
// arrives as "New — compare" when the group already has a take in use.
export async function startRetake(ws: Workspace, projectId: string, o: { capUsd: number; line: unknown }, env: NodeJS.ProcessEnv = process.env): Promise<{ jobs: SingJob[]; usd: number; seconds: number }> {
  const view = await singerView(ws, projectId, env);
  if (!view.lines) throw new Error(view.why ?? "This song's lines are not timed yet.");
  const n = Number(o.line);
  const l = view.lines.find((x) => x.number === n);
  if (!l?.source || !l.run) throw new Error(`Line ${o.line} has no singer: choose a picture or video in Who sings first.`);
  if (l.run.first !== n) throw new Error(`Line ${n} is sung with line ${l.run.first}: retake lines ${l.run.first}-${l.run.last} there.`);
  if (!view.ready) singTransportFor(env); // throws the plain-words message
  const cap = Number(o.capUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (l.piece.usd > cap) throw new Error(`A retake (${l.piece.seconds} s of voice) costs about $${l.piece.usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: raise the cap in Creation → Your defaults. Nothing was sent.`);
  const { dir } = songFolder(ws, projectId);
  return { jobs: [recordTake(dir, l, view.resolution, new Date().toISOString(), filmLookFor(ws, projectId), feelFor(ws, projectId), feelingForLines(ws, projectId, l.number, l.run.last))], usd: l.piece.usd, seconds: l.piece.seconds };
}

// The finished take's clip in the Storyboard (added once; a later take waits outside it until it is chosen).
async function takeIntoStoryboard(ws: Workspace, projectId: string, dir: string, source: string, t: Take): Promise<string> {
  const known = t.sent ?? t.clip;
  const clips = songPathsById(ws, projectId).clips;
  if (known && clips && existsSync(path.join(clips, known))) return known;
  if (!t.file) throw new Error("This take has no video yet.");
  const file = path.join(dir, t.file);
  const r = await importSongClips(ws, projectId, [{ file, name: path.basename(file) }]);
  const clip = r.added[0] ?? r.duplicates[0]?.sameAs;
  if (!clip) throw Object.assign(new Error(r.skipped[0]?.reason ?? "it could not be added to the Storyboard"), { made: true });
  const label = itemLabel(readPictures(dir).pictures[source], t.n);
  if (label && r.added.length) setClipLabel(songPathsById(ws, projectId).root, clip, label);
  setTake(dir, source, t.n, { sent: clip });
  return clip;
}

// The take on its lines, locked to the song (any other anchor on those lines gives way and, if singing, is set to Omit).
function placeTake(ws: Workspace, projectId: string, t: Take, clip: string): void {
  const paths = songPathsById(ws, projectId);
  const recipe = readRecipe(paths.recipe!);
  const last = t.through ?? t.line!;
  const others = (recipe.anchors ?? []).filter((a) => a.line < t.line! || a.line > last);
  try {
    setClipOmit(paths.root, clip, false); // a take chosen again comes back out of Omit
  } catch {
    // not a song clip (the anchor still names it)
  }
  saveAnchors(ws, projectId, [...others, { line: t.line!, clip, sync: t.sync_ms! / 1000, ...(t.through ? { through: t.through } : {}) }]);
}

// "Use this take": the line switches to this take at once (nothing is made or rendered again). The other takes of the
// group stay in Creation; the one it replaces is set to Omit in the Storyboard (out of its line its lips are out of time).
export async function chooseSingingTake(ws: Workspace, projectId: string, source: unknown, n: unknown): Promise<{ clip: string; line: number; through: number }> {
  const { dir } = songFolder(ws, projectId);
  const file = path.basename(String(source ?? ""));
  const t = readPictures(dir).pictures[file]?.takes.find((x) => x.n === Number(n));
  if (!t || t.kind !== "lipsync" || !t.line || t.sync_ms === undefined) throw new Error("No such singing take.");
  if (t.status !== "done" || !t.file) throw new Error("This take is not ready yet.");
  const clip = await takeIntoStoryboard(ws, projectId, dir, file, t);
  placeTake(ws, projectId, t, clip);
  // Chosen: the group's "New — compare" marks go (Paul has compared).
  update(dir, file, (p) => {
    for (const x of p.takes) if (x.kind === "lipsync" && x.line === t.line && (x.through ?? x.line) === (t.through ?? t.line)) delete x.fresh;
  });
  return { clip, line: t.line, through: t.through ?? t.line };
}

// A "New — compare" take was watched: the mark goes.
export function seenSingingTake(ws: Workspace, projectId: string, source: unknown, n: unknown): void {
  const { dir } = songFolder(ws, projectId);
  const file = path.basename(String(source ?? ""));
  if (readPictures(dir).pictures[file]?.takes.some((x) => x.n === Number(n) && x.fresh)) setTake(dir, file, Number(n), { fresh: undefined });
}


// A take in parts (singingParts): part 1 from the picture, every next part from the last frame of the part before (no jump
// where they meet: Joey's "extend from the last frame"), each with its own piece of the voice; each part cut to its exact
// song length (a frame short or long would put the next part's lips out of time), then joined into one silent take.
// A part already sent (its request id kept in the take) is only fetched again (free).
async function singInParts(c: { dir: string; source: string; n: number; take: Take; tmp: string; voice: Voice; songFile: string; transport: SingTransport; picture: Promise<string>; sleep: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number; onSent: (id: string) => void }, out: string): Promise<void> {
  const parts = c.take.parts!;
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = readPictures(c.dir).pictures[c.source]?.takes.find((x) => x.n === c.n)?.parts?.[i] ?? parts[i];
    let rid = part.request_id;
    if (!rid) {
      const voiceFile = path.join(c.tmp, `voice-${i + 1}.wav`);
      cutVoice(c.voice, c.songFile, part, voiceFile);
      let image: string;
      let audio: string;
      try {
        image = i === 0 ? await c.picture : await c.transport.upload(lastFrame(files[i - 1], path.join(c.tmp, `from-${i + 1}.png`)));
        audio = await c.transport.upload(voiceFile);
      } catch (error) {
        throw Object.assign(new Error(`Part ${i + 1}: the picture or the voice could not be put online: ${errorText(error)}`), { unsent: i === 0 });
      }
      const t = c.take;
      rid = (await c.transport.submit({ image, audio, prompt: t.style === SINGING_STYLE ? singingPrompt(t.prompt ?? "", t.look, t.feel, t.feeling, t.feelingTo) : (t.prompt ?? "") || undefined, resolution: isLipsyncResolution(t.resolution) ? t.resolution : LIPSYNC_RESOLUTION })).id; // never retried
      const sent = rid;
      update(c.dir, c.source, (p) => {
        const tk = p.takes.find((x) => x.n === c.n);
        if (!tk?.parts?.[i]) return;
        tk.parts[i].request_id = sent;
        tk.request_id ??= sent;
      });
      c.onSent(rid);
    }
    const t0 = Date.now();
    let url: string;
    for (;;) {
      const st = await c.transport.poll(rid);
      if (st.status === "done") {
        url = st.url;
        break;
      }
      if (st.status === "failed") throw new Error(`WaveSpeed, part ${i + 1}: ${st.error}`);
      if (Date.now() - t0 > (c.timeoutMs ?? TIMEOUT_MS * 3)) throw new Error(`part ${i + 1}: no answer within an hour: get its result later (free)`);
      await c.sleep(c.pollMs ?? POLL_MS);
    }
    const raw = path.join(c.tmp, `part-${i + 1}-raw.mp4`);
    await c.transport.download(url, raw);
    makePlayable(raw, false); // the voice removed
    const fitted = path.join(c.tmp, `part-${i + 1}.mp4`);
    fitLength(raw, fitted, part.toMs - part.fromMs);
    files.push(fitted);
  }
  joinParts(files, out, path.join(c.tmp, "parts.txt"));
}

// The last frame of a part (the next part starts from it).
function lastFrame(file: string, png: string): string {
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-sseof", "-0.1", "-i", file, "-frames:v", "1", "-update", "1", png]);
  return png;
}
// A part at exactly its song length, 30 fps (its last frame held if the model's clip is a little short).
export function fitLength(file: string, out: string, ms: number): void {
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", file, "-vf", "tpad=stop_mode=clone:stop_duration=3,fps=30,format=yuv420p", "-t", (ms / 1000).toFixed(3), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out]);
}
// The parts one after another, as one file (they are encoded alike, so nothing is encoded again).
export function joinParts(files: string[], out: string, list: string): void {
  writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
}

// Makes the singing clips (in parallel). Each: the picture or video and its piece of voice go online, the request is
// sent once, polled, downloaded; the sound is removed; the clip goes to Creation, the Storyboard and onto its line.
// `resume`: takes that already have a request id are only polled and fetched (free).
export async function runSinging(openWs: () => Workspace, projectId: string, jobs: SingJob[], o: { env?: NodeJS.ProcessEnv; transport?: SingTransport; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number } = {}): Promise<void> {
  const env = o.env ?? process.env;
  const sleep = o.sleep ?? sleepMs;
  let dir: string;
  let songFile: string;
  let voice: Voice;
  {
    const ws = openWs();
    try {
      dir = songFolder(ws, projectId).dir;
      const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()!;
      songFile = absPath(ws, p.audio_path!);
      voice = await voiceFor(ws, projectId, p);
    } finally {
      ws.close();
    }
  }
  let transport: SingTransport;
  try {
    transport = o.transport ?? singTransportFor(env);
  } catch (error) {
    for (const j of jobs) setTake(dir, j.source, j.n, { status: "failed", error: errorText(error), ended_at: new Date().toISOString(), pid: undefined });
    return;
  }
  const uploads = new Map<string, Promise<string>>(); // one upload per picture or video
  await Promise.all(
    jobs.map(async (j) => {
      const t = readPictures(dir).pictures[j.source]?.takes.find((x) => x.n === j.n);
      if (!t || t.sync_ms === undefined || t.to_ms === undefined || !t.line) return;
      let id = t.request_id;
      const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-sing-"));
      try {
        setTake(dir, j.source, j.n, { status: "running", pid: process.pid, error: undefined });
        const got = path.join(tmp, "sings.mp4");
        if (t.parts && t.parts.length > 1 && !BOARD_VIDEO_FILE.test(j.source)) {
          // In parts (a long piece): each from the last frame of the one before, joined into one take.
          if (!uploads.has(j.source)) uploads.set(j.source, transport.upload(path.join(dir, j.source)));
          await singInParts({ dir, source: j.source, n: j.n, take: t, tmp, voice, songFile, transport, picture: uploads.get(j.source)!, sleep, pollMs: o.pollMs, timeoutMs: o.timeoutMs, onSent: (rid) => (id ??= rid) }, got);
        } else {
          if (!id) {
            const src = path.join(dir, j.source);
            if (!uploads.has(j.source)) uploads.set(j.source, transport.upload(src));
            const voiceFile = path.join(tmp, "voice.wav");
            cutVoice(voice, songFile, { fromMs: t.sync_ms, toMs: t.to_ms }, voiceFile);
            let media: string;
            let audio: string;
            try {
              [media, audio] = await Promise.all([uploads.get(j.source)!, transport.upload(voiceFile)]);
            } catch (error) {
              throw Object.assign(new Error(`The picture or the voice could not be put online: ${errorText(error)}`), { unsent: true });
            }
            const sent = await transport.submit({ ...(BOARD_VIDEO_FILE.test(j.source) ? { video: media } : { image: media }), audio, prompt: t.style === SINGING_STYLE ? singingPrompt(t.prompt ?? "", t.look, t.feel, t.feeling, t.feelingTo) : (t.prompt ?? "") || undefined, resolution: isLipsyncResolution(t.resolution) ? t.resolution : LIPSYNC_RESOLUTION }); // never retried
            id = sent.id;
            setTake(dir, j.source, j.n, { request_id: id });
          }
          const t0 = Date.now();
          let url: string;
          for (;;) {
            const s = await transport.poll(id);
            if (s.status === "done") {
              url = s.url;
              break;
            }
            if (s.status === "failed") throw new Error(`WaveSpeed: ${s.error}`);
            if (Date.now() - t0 > (o.timeoutMs ?? TIMEOUT_MS * 3)) throw new Error("no answer within an hour: get its result later (free)");
            await sleep(o.pollMs ?? POLL_MS);
          }
          await transport.download(url, got);
          // The model's copy carries the vocal: only the picture is kept (the vocal never goes into any file of ours).
          makePlayable(got, false); // the voice removed; browser-ready H.264
        }
        const silent = got;
        const takesDir = path.join(dir, TAKES_DIR);
        mkdirSync(takesDir, { recursive: true });
        const name = uniqueFileName(takesDir, `${path.parse(j.source).name} sings ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`}.mp4`);
        copyFileSync(silent, path.join(takesDir, name));
        setTake(dir, j.source, j.n, { file: `${TAKES_DIR}/${name}`, playable: true });
        const ws = openWs();
        try {
          // The group's first take goes into the Storyboard and onto its lines by itself (a take of other lines there,
          // e.g. line 9 alone before the block 9-11, gives way). A later take of the same group while one is in use
          // never replaces it: it waits in Creation as "New — compare" until Paul chooses it (Use this take).
          const anchors = singingAnchorKeys(ws, projectId);
          const taken = readPictures(dir).pictures[j.source]?.takes.some((x) => x.n !== j.n && x.kind === "lipsync" && x.line === t.line && (x.through ?? x.line) === (t.through ?? t.line) && anchors.has(inUseKey(x.clip && !x.sent ? { ...x, sent: x.clip } : x)));
          if (taken) {
            setTake(dir, j.source, j.n, { status: "done", fresh: true, ended_at: new Date().toISOString(), pid: undefined });
          } else {
            const done = readPictures(dir).pictures[j.source]!.takes.find((x) => x.n === j.n)!;
            const clip = await takeIntoStoryboard(ws, projectId, dir, j.source, done);
            placeTake(ws, projectId, done, clip);
            setTake(dir, j.source, j.n, { status: "done", ended_at: new Date().toISOString(), pid: undefined });
          }
        } finally {
          ws.close();
        }
      } catch (error) {
        if ((error as { made?: boolean }).made) {
          setTake(dir, j.source, j.n, { status: "done", error: `Made, but not placed: ${errorText(error)}. Send it to the Storyboard from Creation.`, ended_at: new Date().toISOString(), pid: undefined });
          return;
        }
        const unsent = !id || (error as { unsent?: boolean }).unsent;
        setTake(dir, j.source, j.n, { status: unsent ? "failed" : "interrupted", error: unsent ? `${errorText(error)}. Nothing was spent.` : `${errorText(error)} (sent: get its result later, free)`, ended_at: new Date().toISOString(), pid: undefined });
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }),
  );
}
