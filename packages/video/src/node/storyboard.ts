// The song page's Storyboard (stage 1, read-only): a video's cut plan without rendering it (a dry run
// of the planner: makeVideos with dryRun, the same code Generate renders with) or a past run's plan
// (its manifests). Adds the song's waveform (cached), the beats, the clips' thumbnails and best moments
// (the clip editor's, else the strongest 2 s by motion, colour and contrast, as the Spotify Canvas picks
// them; cached).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { absPath, clip as clipTable, REPO_ROOT, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import type { AnchorUse } from "../anchors";
import { assessVideo, type Assessment } from "../assess";
import { VIDEO } from "../config";
import type { LoopResult, LoopSuggestion } from "../loop";
import { parsePresets } from "../platform";
import type { LyricVideoProps } from "../props";
import { clockText } from "../section";
import { clipEdit, hookSections, peaks, storyLines, storyShots, storyTitleCards, type StoryClip, type StoryLine, type StoryShot } from "../storyboard";
import { analyzeSong } from "./analysis";
import { readLoopAudio } from "./audio-check";
import { bestMoments } from "./best-moment";
import { editOf, readClipEdits } from "./clip-edits";
import { SHORT_LABELS, songRuns } from "./exports";
import { makeVideos } from "./make";
import type { Manifest } from "./manifest";
import { resolveMoved } from "./media";
import { readRecipe, resolveRecipe } from "./recipe";
import { SOURCE_FILE } from "./collection";
import { songCollections } from "./project-settings";
import { readMoves, sharedCollections, songPathsById } from "./song-folder";
import { recipeInputFor } from "./style";

export type StoryboardView = {
  source: "plan" | "run";
  run: string | null; // the past run's folder
  platform: { name: string; label: string };
  video: string; // "v1"
  videos: string[]; // the platform's videos in this plan / run
  settings: string; // "Simple, story, 1x, dissolve as set" etc.
  section: { mode: string; startMs: number; endMs: number; reason: string };
  songStartMs: number; // where the video's audio starts in the song: a moment in the video is this + its time
  durationMs: number;
  bpm: number;
  bars: number[]; // downbeats, in the video (ms)
  beats: number[];
  waveform: { bucketMs: number; peaks: number[] };
  hooks: { startMs: number; endMs: number }[];
  lines: StoryLine[];
  shots: StoryShot[];
  anchorsOutside: { line: number; text: string; clip: string }[];
  anchorWarnings: string[]; // conflicts and anchors not found that no shot carries
  notes: string[]; // what the planner said (warnings)
  // Loop platforms: does the wrap-around flow (the failing points, as QA "Loop flows" names them), and
  // target lengths with an end that loops well from this start (plans only).
  loop: { ok: boolean; problems: string[]; lengthS: number; ending: string | null } | null;
  decisions: string[]; // the app's technical choices in plain words (pacing, transitions)
  assessment: Assessment; // the pro assessment, predicted from the plan (before rendering) // ending: the automatic ending, in plain words
  loopSuggestions: { lengthS: number; end: string; line: string | null; fit: string }[];
  // Stage 2 (plans only): the clips in story order (clips.json, else file names) with their edits; a run
  // is read-only (editable false).
  editable: boolean;
  clips: StoryboardClip[];
  // The textboard: the title / byline / tagline cards on screen; the lyric cards are the lines.
  titleCards: { id: string; type: string; text: string; startMs: number; endMs: number }[];
  slots: { line: number; text: string; clip: string }[]; // lines that need a clip (picture swap)
  picture: string | null; // the clip set planned ("city"; null: the recipe's)
  props: Omit<LyricVideoProps, "mediaBaseUrl">; // for the preview (served by the storyboard's media route)
};

export type StoryboardClip = {
  name: string; // the clip's file name (clips.json and anchors use it)
  src: string; // the prepared file (the props' shot src: the clip editor plays it)
  thumb: string | null;
  durationMs: number;
  kind: "video" | "photo";
  ranked: boolean; // placed by the story order in clips.json (else by its file name)
  omit: boolean; // set to Omit (Assets / Shape): keeps its place, never shown
  inS: number | null;
  outS: number | null;
  speed: number | null;
  transition: "cut" | "dissolve" | null; // how it comes in (clips.json), null: the app chooses
  canvas: { at: number | null } | null; // chosen for the Spotify Canvas (song.json "canvas"), at that moment
  bestS: number | null; // the best moment used (the clip editor's, else the automatic one)
  bestFrom: "clip editor" | "auto" | null;
  autoBestS: number | null; // the automatic one (the strongest 2 s)
  shots: number; // shots it gets in this video
};

export type StoryboardChoices = {
  platforms: { name: string; label: string; videos: string[] }[]; // plan: the recipe's platforms and video counts
  runs: { folder: string; time: string | null; platforms: { name: string; label: string; videos: string[] }[] }[];
  ready: boolean; // the song has lyrics and a song file
  why: string | null;
  // Picture swap: the clip sets the plan can use (the song's own clips and the shared collections),
  // and the recipe's own set.
  pictures: { songClips: boolean; collections: string[]; recipe: { songClips: boolean; collections: string[] } };
};

const WAVE_BUCKET_MS = 50;

function presets() {
  const file = path.join(REPO_ROOT, "presets", "platforms.json");
  return parsePresets(JSON.parse(readFileSync(file, "utf8")), file);
}

// What the storyboard can show: a plan per platform (the recipe's, else Reels and YouTube), or a past run.
export function storyboardChoices(ws: Workspace, projectId: string): StoryboardChoices {
  const paths = songPathsById(ws, projectId);
  const all = presets();
  const { input } = recipeInputFor(ws, projectId);
  const r = resolveRecipe(input).values;
  const names = (r.platforms.length ? r.platforms : ["reels", "youtube"]).filter((n) => all[n]?.available && all[n].layout !== "canvas");
  const platforms = names.map((n) => {
    const count = r.variations[n] ?? r.variations["*"] ?? all[n].variations;
    return { name: n, label: SHORT_LABELS[n] ?? all[n].label, videos: Array.from({ length: count }, (_, i) => `v${i + 1}`) };
  });
  const runs = songRuns(ws, projectId).map((run) => ({
    folder: run.folder,
    time: run.time,
    platforms: run.platforms.filter((p) => p.name !== "canvas" && p.videos.length).map((p) => ({ name: p.name, label: p.label, videos: p.videos.map((v) => v.name) })),
  })).filter((run) => run.platforms.length);
  const ready = !!paths.audio && existsSync(paths.audio) && existsSync(paths.lyricsTxt);
  const hasOwn = !!paths.clips && existsSync(paths.clips) && readdirSync(paths.clips).some((f) => SOURCE_FILE.test(f));
  return {
    platforms, runs, ready, why: ready ? null : "This song needs its song file and lyrics.txt (Assets tab) first.",
    pictures: { songClips: hasOwn, collections: sharedCollections(ws), recipe: { songClips: hasOwn, collections: songCollections(ws, projectId) } },
  };
}

// The plan of one video, without rendering: the same planner Generate uses (makeVideos, dry run).
// clipSet: the picture swap ("song+wedding", "city"): the same textboard over other clips, this plan only.
export async function storyboardPlan(ws: Workspace, projectId: string, platform: string, video = "v1", clipSet?: string): Promise<StoryboardView> {
  const paths = songPathsById(ws, projectId);
  if (!paths.audio || !existsSync(paths.audio)) throw new Error("This song has no song file yet (Assets tab).");
  const notes: string[] = [];
  const result = await makeVideos({
    workspaceDir: ws.dir,
    song: paths.audio,
    lyrics: paths.lyricsTxt,
    ...(paths.hints && existsSync(paths.hints) ? { hint: paths.hints } : {}),
    platforms: platform,
    ...(clipSet ? { clipSet } : {}),
    dryRun: true,
    frameCheck: false,
    log: () => {},
  });
  const p = result.platforms[0];
  if (p?.error) throw new Error(p.error);
  const plan = p?.plan;
  if (!plan) throw new Error(`No plan for ${platform}.`);
  const v = plan.videos.find((x) => x.spec.name === video) ?? plan.videos[0];
  if (!v) throw new Error(`${p.label} has no video ${video}.`);
  notes.push(...p.warnings);
  // The best moments the planner used (the clip editor's, else the strongest 2 s).
  const clips = new Map<string, StoryClip>(plan.clips.map((c) => [c.path, { name: c.name, thumb: c.thumb, durationMs: c.durationMs, kind: c.kind, bestAtS: c.bestMs === null ? null : c.bestMs / 1000, bestFrom: c.bestFrom, edit: clipEdit(c.durationMs, { in: c.inMs === null ? null : c.inMs / 1000, out: c.outMs === null ? null : c.outMs / 1000, speed: c.speed }) }]));
  const startMs = v.props.audio ? frameMs(v.props.audio.startFrame) : plan.section.start_ms;
  // The props' lyric lines with their numbers (the Lyrics tab's), matched by text and time.
  const numbered = v.props.lyrics.map((l) => {
    const songStart = startMs + frameMs(l.startFrame) + 250;
    const same = plan.lines.filter((x) => x.text === l.text);
    const best = same.reduce<(typeof same)[number] | null>((a, x) => (!a || Math.abs(x.start_ms - songStart) < Math.abs(a.start_ms - songStart) ? x : a), null);
    return { number: best?.number ?? null, text: l.text, isHook: !!l.isHook };
  });
  const auto = await bestMoments(ws.dir, plan.clips.filter((c) => c.kind === "video").map((c) => absPath(ws, c.path)));
  const storyOrder = [...plan.clips].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const canvasChoice = paths.recipe && existsSync(paths.recipe) ? (readRecipe(paths.recipe).canvas ?? null) : null;
  const storyboardClips: StoryboardClip[] = storyOrder.map((c) => ({
    canvas: canvasChoice && canvasChoice.clip.toLowerCase() === c.name.toLowerCase() ? { at: canvasChoice.at ?? null } : null,
    name: c.name, src: c.path, thumb: c.thumb, durationMs: c.durationMs, kind: c.kind, ranked: c.rank !== null, omit: c.omit === true,
    inS: c.inMs === null ? null : c.inMs / 1000, outS: c.outMs === null ? null : c.outMs / 1000, speed: c.speed, transition: c.transition,
    bestS: c.bestMs === null ? null : c.bestMs / 1000, bestFrom: c.bestFrom, autoBestS: c.kind === "video" ? (auto.get(absPath(ws, c.path)) ?? null) : null,
    shots: v.props.shots.filter((s) => s.src === c.path).length,
  }));
  return view(ws, {
    editable: !paths.legacy, storyboardClips, slots: plan.slots, picture: clipSet ?? null,
    source: "plan", run: null, platform: { name: p.name, label: p.label }, video: v.spec.name, videos: plan.videos.map((x) => x.spec.name),
    settings: settingsText(v.spec),
    section: { mode: plan.section.mode, startMs: plan.section.start_ms, endMs: plan.section.end_ms, reason: plan.section.reason },
    props: v.props, startMs, bpm: plan.analysis.bpm, beats: plan.analysis.beats, clips, numbered, anchors: v.anchors, anchorsOutside: plan.anchorsOutside, notes,
    loop: v.loop, loopSuggestions: plan.loopSuggestions ?? [], decisions: v.decisions,
    songFile: paths.audio,
  });
}

// A past run's video: its manifest (exactly what was rendered).
export async function storyboardRun(ws: Workspace, projectId: string, folder: string, platform: string, video = "v1"): Promise<StoryboardView> {
  const paths = songPathsById(ws, projectId);
  if (!/^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(folder)) throw new Error(`No run ${folder}.`);
  const dir = platform === "standard" ? path.join(paths.exports, folder) : path.join(paths.exports, folder, platform);
  const file = path.join(dir, `${video}.manifest.json`);
  if (!existsSync(file)) throw new Error(`No ${video} for ${platform} in the run ${folder}.`);
  const m = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  const moves = readMoves(ws.dir);
  const songFile = absPath(ws, resolveMoved(moves, m.song.file));
  const tempo = (m.settings.tempo as { set?: number } | null | undefined)?.set;
  const analysis = analyzeSong(existsSync(songFile) ? songFile : paths.audio!, { downbeatOffset: m.analysis.downbeat_offset, ...(tempo ? { bpm: tempo } : {}) });
  const thumbOf = (f: string) => ws.db.select({ thumb: clipTable.thumb_path }).from(clipTable).where(eq(clipTable.path, f)).get()?.thumb ?? null;
  const clips = await storyClips(
    ws,
    projectId,
    m.clips.map((c) => ({ src: c.normalised, name: c.name, thumb: thumbOf(c.file), durationMs: 0, kind: /\.(jpe?g|png|webp)$/i.test(c.name) ? ("photo" as const) : ("video" as const), file: absPath(ws, resolveMoved(moves, c.normalised)) })),
  );
  const startMs = m.props.audio ? frameMs(m.props.audio.startFrame) : m.section.start_ms;
  const videos = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"].filter((n) => existsSync(path.join(dir, `${n}.manifest.json`)));
  const used = m.anchors?.used ?? [];
  return view(ws, {
    editable: false, storyboardClips: [], slots: [], picture: m.picture?.label ?? null,
    source: "run", run: folder, platform: { name: platform, label: SHORT_LABELS[platform] ?? m.platform?.preset.label ?? platform }, video, videos,
    settings: `${m.variation.style}, ${m.variation.order}${(m.settings.cut_rate as string) ? `, ${m.settings.cut_rate}` : ""}${m.settings.transitions ? `, ${m.settings.transitions}` : ""}`,
    section: { mode: m.section.mode, startMs: m.section.start_ms, endMs: m.section.end_ms, reason: m.section.reason },
    props: m.props, startMs, bpm: m.analysis.bpm, beats: analysis.beats, clips,
    // Older runs number lines by lyrics.txt row: anchors are matched by their text.
    numbered: m.props.lyrics.map((l) => ({ number: used.find((a) => a.used && a.text === l.text)?.line ?? null, text: l.text, isHook: !!l.isHook })),
    anchors: m.anchors ? { uses: used, conflicts: m.anchors.conflicts, notes: m.anchors.notes, missing: m.anchors.missing } : null,
    anchorsOutside: used.filter((u) => !u.used && u.why === "outside this section").map((u) => ({ line: u.line, text: u.text, clip: u.clip })),
    notes: m.warnings ?? [],
    loop: m.loop && m.loop.checked ? m.loop : null,
    loopSuggestions: [],
    decisions: [(m.settings.length as { text?: string } | null | undefined)?.text, (m.settings.pace as { text?: string } | null | undefined)?.text, (m.settings.transition_plan as { text?: string } | null | undefined)?.text].filter((x): x is string => !!x),
    songFile: existsSync(songFile) ? songFile : paths.audio!,
  });
}

const frameMs = (f: number) => Math.round((f * 1000) / VIDEO.fps);

function settingsText(spec: { style: string; order: string; rate?: string; transitions?: string; pairing?: { name: string } }): string {
  return [spec.style === "simple" ? "Simple" : "Bold", spec.order, spec.rate, spec.transitions ? `anchors ${spec.transitions === "as-set" ? "as set" : `all ${spec.transitions}`}` : null, spec.pairing ? `fonts ${spec.pairing.name}` : null].filter(Boolean).join(", ");
}

async function view(
  ws: Workspace,
  c: {
    source: "plan" | "run"; run: string | null; platform: { name: string; label: string }; video: string; videos: string[]; settings: string;
    section: StoryboardView["section"]; props: Omit<LyricVideoProps, "mediaBaseUrl">; startMs: number; bpm: number; beats: { time_ms: number; is_downbeat: boolean }[];
    clips: Map<string, StoryClip>; numbered: { number: number | null; text: string; isHook: boolean }[];
    anchors: { uses: AnchorUse[]; conflicts: string[]; notes: string[]; missing: string[] } | null; anchorsOutside: StoryboardView["anchorsOutside"]; notes: string[]; songFile: string;
    loop: LoopResult | null; loopSuggestions: LoopSuggestion[]; decisions: string[]; editable: boolean; storyboardClips: StoryboardClip[];
    slots: StoryboardView["slots"]; picture: string | null;
  },
): Promise<StoryboardView> {
  const durationMs = frameMs(c.props.durationInFrames);
  const inVideo = (t: number) => t - c.startMs;
  const beats = c.beats.filter((b) => inVideo(b.time_ms) >= 0 && inVideo(b.time_ms) <= durationMs);
  const shots = storyShots(c.props, c.clips, c.startMs, c.anchors);
  const lines = storyLines(c.props.lyrics, c.numbered, c.anchors?.uses ?? [], c.slots);
  const attached = new Set(shots.flatMap((s) => s.warnings));
  const wave = await songPeaks(ws, c.songFile);
  const buckets = Math.max(1, Math.round(durationMs / WAVE_BUCKET_MS));
  return {
    source: c.source, run: c.run, platform: c.platform, video: c.video, videos: c.videos, settings: c.settings, section: c.section,
    songStartMs: c.startMs,
    durationMs, bpm: c.bpm,
    bars: beats.filter((b) => b.is_downbeat).map((b) => inVideo(b.time_ms)),
    beats: beats.map((b) => inVideo(b.time_ms)),
    waveform: { bucketMs: WAVE_BUCKET_MS, peaks: wave ? peaks(wave.samples, wave.rate, c.startMs, c.startMs + durationMs, buckets) : [] },
    hooks: hookSections(lines),
    lines,
    shots,
    anchorsOutside: c.anchorsOutside,
    anchorWarnings: [...(c.anchors?.missing ?? []), ...(c.anchors?.conflicts ?? []).filter((x) => !attached.has(x))],
    notes: c.notes,
    assessment: predictAssessment(c.loop, c.anchors, shots, lines, c.notes, [...c.decisions, ...(c.loop?.ending?.text ? [c.loop.ending.text] : [])]),
    loop: c.loop ? { ok: c.loop.ok, problems: c.loop.points.filter((p) => !p.ok).map((p) => `${p.point}: ${p.detail}`), lengthS: c.loop.length_s, ending: c.loop.ending?.text ?? null } : null,
    decisions: c.decisions,
    loopSuggestions: c.loopSuggestions.map((x) => ({ lengthS: x.lengthS, end: clockText(x.endMs), line: x.line ? `line ${x.line.number} "${x.line.text}"` : null, fit: x.fit.text })),
    editable: c.editable,
    clips: c.storyboardClips,
    titleCards: storyTitleCards(c.props),
    slots: c.slots,
    picture: c.picture,
    props: c.props,
  };
}

// ---------------------------------------------------------------- caches

// The song decoded once (mono 16 kHz) for its waveform; kept in memory while the studio runs.
const decoded = new Map<string, Promise<{ rate: number; samples: Float32Array } | null>>();
async function songPeaks(_ws: Workspace, songFile: string) {
  const key = `${songFile}|${existsSync(songFile) ? statSync(songFile).mtimeMs : 0}`;
  if (!decoded.has(key)) decoded.set(key, readLoopAudio(songFile));
  return decoded.get(key)!;
}

// A past run's clips: their best moments now (the clip editor's in clips.json, else the strongest 2 s).
async function storyClips(
  ws: Workspace,
  projectId: string,
  clips: { src: string; name: string; thumb: string | null; durationMs: number; kind: "video" | "photo"; file: string }[],
): Promise<Map<string, StoryClip>> {
  const edits = readClipEdits(songPathsById(ws, projectId).root);
  const videos = clips.filter((c) => c.kind === "video");
  const auto = await bestMoments(ws.dir, videos.map((c) => c.file));
  return new Map(clips.map((c) => {
    const own = editOf(edits, c.name).best;
    const bestAtS = c.kind !== "video" ? null : (own ?? auto.get(c.file) ?? null);
    return [c.src, { name: c.name, thumb: c.thumb, durationMs: c.durationMs, kind: c.kind, bestAtS, bestFrom: bestAtS === null ? null : own !== undefined ? "clip editor" : "auto", edit: c.kind === "video" ? clipEdit(c.durationMs, editOf(edits, c.name)) : undefined }];
  }));
}

// The pro assessment of a plan, before rendering: what QA would warn about that the plan already shows
// (the loop, anchors, clips repeated close together, lines flagged for review, slow motion).
function predictAssessment(
  loop: LoopResult | null,
  anchors: { conflicts: string[]; missing: string[] } | null,
  shots: StoryShot[],
  lines: StoryLine[],
  notes: string[],
  decisions: string[],
): Assessment {
  const problems: { check: string; details: string[] }[] = [];
  if (loop && !loop.ok) problems.push({ check: "Loop flows", details: loop.points.filter((p) => !p.ok).map((p) => p.detail) });
  if (anchors && (anchors.conflicts.length || anchors.missing.length)) problems.push({ check: "Story anchors", details: [...anchors.missing, ...anchors.conflicts] });
  const repeats = shots.flatMap((s, i) => {
    const back = [1, 2, 3].find((k) => i - k >= 0 && shots[i - k].clip === s.clip);
    return back ? [`shot ${i + 1} (${clockText(s.startMs)}) repeats ${s.clip} from shot ${i - back + 1}`] : [];
  });
  if (repeats.length) problems.push({ check: "Clips repeated within 3 shots", details: repeats });
  const flagged = notes.flatMap((n) => {
    const m = /^Vocal-start check: line ([\d, ]+) flagged for review/.exec(n);
    return m ? m[1].split(/,\s*/).map(Number) : [];
  });
  const shown = flagged.map((n) => lines.find((l) => l.number === n)).filter((l): l is StoryLine => !!l);
  if (shown.length) problems.push({ check: "Line starts to review", details: shown.map((l) => `line ${l.number} "${l.text}": flagged for review`) });
  return assessVideo({
    problems,
    shots: shots.map((s) => ({ start_s: s.startMs / 1000, speed: s.speed, hold: s.hold, photo: s.kind === "photo" })),
    decisions,
    prediction: true,
  });
}
