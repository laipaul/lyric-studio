// The song page's Storyboard (stage 1, read-only): a video's cut plan without rendering it (a dry run
// of the planner: makeVideos with dryRun, the same code Generate renders with) or a past run's plan
// (its manifests). Adds the song's waveform (cached), the beats, the clips' thumbnails and best moments
// (the strongest 2 s by motion, colour and contrast, as the Spotify Canvas picks them; cached).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, clip as clipTable, REPO_ROOT, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import type { AnchorUse } from "../anchors";
import { CANVAS, strongestWindows } from "../canvas";
import { VIDEO } from "../config";
import { parsePresets } from "../platform";
import type { LyricVideoProps } from "../props";
import { BEST_WINDOW_S, hookSections, peaks, storyLines, storyShots, type StoryClip, type StoryLine, type StoryShot } from "../storyboard";
import { analyzeSong } from "./analysis";
import { readLoopAudio } from "./audio-check";
import { clipStats } from "./canvas";
import { SHORT_LABELS, songRuns } from "./exports";
import { makeVideos } from "./make";
import type { Manifest } from "./manifest";
import { resolveMoved } from "./media";
import { resolveRecipe } from "./recipe";
import { readMoves, songPathsById } from "./song-folder";
import { recipeInputFor } from "./style";

export type StoryboardView = {
  source: "plan" | "run";
  run: string | null; // the past run's folder
  platform: { name: string; label: string };
  video: string; // "v1"
  videos: string[]; // the platform's videos in this plan / run
  settings: string; // "Simple, story, 1x, dissolve as set" etc.
  section: { mode: string; startMs: number; endMs: number; reason: string };
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
  props: Omit<LyricVideoProps, "mediaBaseUrl">; // for the preview (served by the storyboard's media route)
};

export type StoryboardChoices = {
  platforms: { name: string; label: string; videos: string[] }[]; // plan: the recipe's platforms and video counts
  runs: { folder: string; time: string | null; platforms: { name: string; label: string; videos: string[] }[] }[];
  ready: boolean; // the song has lyrics and a song file
  why: string | null;
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
  return { platforms, runs, ready, why: ready ? null : "This song needs its song file and lyrics.txt (Assets tab) first." };
}

// The plan of one video, without rendering: the same planner Generate uses (makeVideos, dry run).
export async function storyboardPlan(ws: Workspace, projectId: string, platform: string, video = "v1"): Promise<StoryboardView> {
  const paths = songPathsById(ws, projectId);
  if (!paths.audio || !existsSync(paths.audio)) throw new Error("This song has no song file yet (Assets tab).");
  const notes: string[] = [];
  const result = await makeVideos({
    workspaceDir: ws.dir,
    song: paths.audio,
    lyrics: paths.lyricsTxt,
    ...(paths.hints && existsSync(paths.hints) ? { hint: paths.hints } : {}),
    platforms: platform,
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
  const clips = await storyClips(ws, plan.clips.map((c) => ({ src: c.path, name: c.name, thumb: c.thumb, durationMs: c.durationMs, kind: c.kind, file: absPath(ws, c.path) })), v.props.shots.map((s) => s.src));
  const startMs = v.props.audio ? frameMs(v.props.audio.startFrame) : plan.section.start_ms;
  // The props' lyric lines with their numbers (the Lyrics tab's), matched by text and time.
  const numbered = v.props.lyrics.map((l) => {
    const songStart = startMs + frameMs(l.startFrame) + 250;
    const same = plan.lines.filter((x) => x.text === l.text);
    const best = same.reduce<(typeof same)[number] | null>((a, x) => (!a || Math.abs(x.start_ms - songStart) < Math.abs(a.start_ms - songStart) ? x : a), null);
    return { number: best?.number ?? null, text: l.text, isHook: !!l.isHook };
  });
  return view(ws, {
    source: "plan", run: null, platform: { name: p.name, label: p.label }, video: v.spec.name, videos: plan.videos.map((x) => x.spec.name),
    settings: settingsText(v.spec),
    section: { mode: plan.section.mode, startMs: plan.section.start_ms, endMs: plan.section.end_ms, reason: plan.section.reason },
    props: v.props, startMs, bpm: plan.analysis.bpm, beats: plan.analysis.beats, clips, numbered, anchors: v.anchors, anchorsOutside: plan.anchorsOutside, notes,
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
  const analysis = analyzeSong(existsSync(songFile) ? songFile : paths.audio!, { downbeatOffset: m.analysis.downbeat_offset });
  const thumbOf = (f: string) => ws.db.select({ thumb: clipTable.thumb_path }).from(clipTable).where(eq(clipTable.path, f)).get()?.thumb ?? null;
  const clips = await storyClips(
    ws,
    m.clips.map((c) => ({ src: c.normalised, name: c.name, thumb: thumbOf(c.file), durationMs: 0, kind: /\.(jpe?g|png|webp)$/i.test(c.name) ? ("photo" as const) : ("video" as const), file: absPath(ws, resolveMoved(moves, c.normalised)) })),
    m.props.shots.map((s) => s.src),
  );
  const startMs = m.props.audio ? frameMs(m.props.audio.startFrame) : m.section.start_ms;
  const videos = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"].filter((n) => existsSync(path.join(dir, `${n}.manifest.json`)));
  const used = m.anchors?.used ?? [];
  return view(ws, {
    source: "run", run: folder, platform: { name: platform, label: SHORT_LABELS[platform] ?? m.platform?.preset.label ?? platform }, video, videos,
    settings: `${m.variation.style}, ${m.variation.order}${(m.settings.cut_rate as string) ? `, ${m.settings.cut_rate}` : ""}${m.settings.transitions ? `, ${m.settings.transitions}` : ""}`,
    section: { mode: m.section.mode, startMs: m.section.start_ms, endMs: m.section.end_ms, reason: m.section.reason },
    props: m.props, startMs, bpm: m.analysis.bpm, beats: analysis.beats, clips,
    // Older runs number lines by lyrics.txt row: anchors are matched by their text.
    numbered: m.props.lyrics.map((l) => ({ number: used.find((a) => a.used && a.text === l.text)?.line ?? null, text: l.text, isHook: !!l.isHook })),
    anchors: m.anchors ? { uses: used, conflicts: m.anchors.conflicts, notes: m.anchors.notes, missing: m.anchors.missing } : null,
    anchorsOutside: used.filter((u) => !u.used && u.why === "outside this section").map((u) => ({ line: u.line, text: u.text, clip: u.clip })),
    notes: m.warnings ?? [],
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
  },
): Promise<StoryboardView> {
  const durationMs = frameMs(c.props.durationInFrames);
  const inVideo = (t: number) => t - c.startMs;
  const beats = c.beats.filter((b) => inVideo(b.time_ms) >= 0 && inVideo(b.time_ms) <= durationMs);
  const shots = storyShots(c.props, c.clips, c.startMs, c.anchors);
  const lines = storyLines(c.props.lyrics, c.numbered, c.anchors?.uses ?? []);
  const attached = new Set(shots.flatMap((s) => s.warnings));
  const wave = await songPeaks(ws, c.songFile);
  const buckets = Math.max(1, Math.round(durationMs / WAVE_BUCKET_MS));
  return {
    source: c.source, run: c.run, platform: c.platform, video: c.video, videos: c.videos, settings: c.settings, section: c.section,
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

// Each clip's best moment (the strongest 2 s), cached in workspace\cache\best-moments.json by file,
// size and date. A best moment set in the clip editor (stage 2) will win over this one.
async function storyClips(
  ws: Workspace,
  clips: { src: string; name: string; thumb: string | null; durationMs: number; kind: "video" | "photo"; file: string }[],
  used: readonly string[],
): Promise<Map<string, StoryClip>> {
  const cacheFile = path.join(ws.dir, "cache", "best-moments.json");
  let cache: Record<string, number | null> = {};
  try {
    cache = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, number | null>) : {};
  } catch {
    cache = {};
  }
  let changed = false;
  const out = new Map<string, StoryClip>();
  for (const c of clips) {
    let bestAtS: number | null = null;
    if (c.kind === "video" && used.includes(c.src) && existsSync(c.file)) {
      const st = statSync(c.file);
      const key = `${c.file}|${st.size}|${Math.round(st.mtimeMs)}`;
      if (!(key in cache)) {
        try {
          const stats = await clipStats(c.file);
          const best = strongestWindows([{ name: c.name, stats }], BEST_WINDOW_S * CANVAS.sampleFps)[0];
          cache[key] = best ? Math.round((best.startSample / CANVAS.sampleFps) * 10) / 10 : null;
        } catch {
          cache[key] = null;
        }
        changed = true;
      }
      bestAtS = cache[key];
    }
    out.set(c.src, { name: c.name, thumb: c.thumb, durationMs: c.durationMs, kind: c.kind, bestAtS, bestFrom: bestAtS === null ? null : "auto" });
  }
  if (changed) {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache));
  }
  return out;
}
