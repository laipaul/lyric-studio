// Cut points: where the video switches to the next clip, derived from the beats of a section.
import { BEATS_PER_BAR, applyDownbeatOffset, barPosition, type Beat } from "./beats";
import { VIDEO } from "./config";

export type CutRate = "0.5x" | "1x" | "2x" | "off";
export type Energy = "low" | "medium" | "high";

export type CutSection = { start_ms: number; end_ms: number; energy?: Energy };
export type LyricTiming = { start_ms: number | null; end_ms: number | null };

// Shot length in bars (overrides the cut rate), or "story": 2 bars on hooks, 4 on verses and
// instrumentals, never shorter than 3 s (a storytelling pace: ~12-20 shots in 90 s).
export type ShotLength = 1 | 2 | 4 | 8 | "story";
export const SHOT_LENGTHS: readonly ShotLength[] = [1, 2, 4, 8, "story"];
export const STORY_BARS = { hook: 2, verse: 4 } as const;
export const STORY_MIN_SHOT_MS = 3000;

export type CutOptions = {
  cutRate: CutRate;
  shotLength?: ShotLength; // set: replaces the cut rate
  // Automatic pacing (src/pace.ts): like "story" with the app's own bars and minimum (replaces both).
  pace?: { hookBars: number; verseBars: number; minShotMs: number };
  hooks?: readonly { start_ms: number; end_ms: number }[]; // "story": the hook (chorus) stretches, song time
  earlyCutFrames?: number; // 0-4, default 2: cut this many frames before the beat
  downbeatOffset?: number; // 0-3, default 0: shift which beat is bar 1
  holdOnLyricLines?: boolean; // never cut inside a lyric line
  // Story pace / automatic pacing: a new shot starts on the bar at each of these times (an instrumental's
  // story sentences start with a new clip), when that leaves no shot under the minimum.
  cutAtMs?: readonly number[];
  lyricLines?: readonly LyricTiming[]; // needed for cutRate "off" and holdOnLyricLines
  minShotMs?: number; // default 800
  fps?: number; // default 30
};

export type CutPoint = {
  frame: number; // first frame of the new shot (song timeline)
  time_ms: number; // frame converted back to ms
  beat_index: number; // index into the song's beats
  beat_time_ms: number; // the beat this cut belongs to
  bar: number; // 1-based bar of that beat (0 = before bar 1)
  beat_in_bar: number; // 1-4
};

export type CutPlan = {
  start_frame: number; // first frame of the section
  end_frame: number; // frame where the section ends (exclusive)
  fps: number;
  cuts: CutPoint[];
  // Beats between cuts: requested by rate + energy, and actually used after min-shot thinning.
  // null for cutRate "off" (cuts follow lyric lines, not a grid).
  requested_grid_beats: number | null;
  grid_beats: number | null;
};

export const DEFAULT_EARLY_CUT_FRAMES = 2;
export const MIN_SHOT_MS = 800;

// Regular grids, from every beat to every 8 bars.
const GRID_LADDER = [1, 2, 4, 8, 16, 32];
const RATE_GRID_BEATS: Record<Exclude<CutRate, "off">, number> = { "0.5x": 8, "1x": 4, "2x": 2 };
// Low energy = half as many cuts (twice the beats per cut); high = twice as many.
const ENERGY_FACTOR: Record<Energy, number> = { low: 2, medium: 1, high: 0.5 };

const toFrame = (ms: number, fps: number) => Math.round((ms * fps) / 1000);
const toMs = (frame: number, fps: number) => Math.round((frame * 1000) / fps);

export function gridBeatsFor(cutRate: Exclude<CutRate, "off">, energy: Energy = "medium"): number {
  const beats = RATE_GRID_BEATS[cutRate] * ENERGY_FACTOR[energy];
  return Math.min(GRID_LADDER[GRID_LADDER.length - 1], Math.max(GRID_LADDER[0], beats));
}

export function getCutPoints(beatsIn: readonly Beat[], section: CutSection, options: CutOptions): CutPlan {
  const fps = options.fps ?? VIDEO.fps;
  const early = options.earlyCutFrames ?? DEFAULT_EARLY_CUT_FRAMES;
  if (!Number.isInteger(early) || early < 0 || early > 4) throw new Error("earlyCutFrames must be 0-4");
  if (section.end_ms <= section.start_ms) throw new Error("section end must be after its start");
  const minShotFrames = Math.ceil(((options.minShotMs ?? MIN_SHOT_MS) * fps) / 1000);
  const lines = (options.lyricLines ?? []).filter(
    (l): l is { start_ms: number; end_ms: number } => l.start_ms != null && l.end_ms != null,
  );

  const beats = applyDownbeatOffset(beatsIn, options.downbeatOffset ?? 0);
  const startFrame = toFrame(section.start_ms, fps);
  const endFrame = toFrame(section.end_ms, fps);

  const cutAt = (index: number): CutPoint => cutPointAt(beats, index, fps, early);
  // A cut must leave room for a shot on both sides inside the section.
  const insideSection = (c: CutPoint) => c.frame > startFrame && c.frame < endFrame;

  let cuts: CutPoint[];
  let requested: number | null = null;
  let used: number | null = null;

  if (options.shotLength === "story" || options.pace) {
    // Story pace: from each cut, 2 bars on a hook, 4 elsewhere (more when that is under 3 s), on downbeats.
    // Automatic pacing: the same with the app's bars and minimum.
    const pace = options.pace ?? { hookBars: STORY_BARS.hook, verseBars: STORY_BARS.verse, minShotMs: STORY_MIN_SHOT_MS };
    const minStory = Math.max(minShotFrames, Math.ceil((pace.minShotMs * fps) / 1000));
    const downbeats = beats.map((_, i) => i).filter((i) => beats[i].is_downbeat).map(cutAt).filter(insideSection);
    const inHook = (frame: number) => (options.hooks ?? []).some((h) => frame >= toFrame(h.start_ms, fps) && frame < toFrame(h.end_ms, fps));
    // Forced cuts: the downbeat at (or just before) each time, inside the section.
    const forced = (options.cutAtMs ?? [])
      .map((ms) => downbeats.filter((c) => c.beat_time_ms <= ms + 1).pop())
      .filter((c): c is CutPoint => !!c && c.frame - startFrame >= minShotFrames && endFrame - c.frame >= minShotFrames);
    cuts = [];
    let from = startFrame;
    for (;;) {
      const ahead = downbeats.filter((c) => c.frame > from);
      let bars = inHook(from) ? pace.hookBars : pace.verseBars;
      while (ahead[bars - 1] && ahead[bars - 1].frame - from < minStory) bars += 1;
      let next = ahead[bars - 1];
      const must = forced.find((c) => c.frame > from && (!next || c.frame <= next.frame));
      if (must && must.frame - from >= minShotFrames) next = must;
      else if (must && cuts.length && next && must.frame - from < minShotFrames) {
        // Just after the last cut: move that cut onto the forced bar instead.
        cuts[cuts.length - 1] = must;
        from = must.frame;
        continue;
      }
      if (!next || endFrame - next.frame < minStory) {
        // The rest stays one shot (never a short last one), unless a forced cut is still to come.
        const later = forced.find((c) => c.frame > from);
        if (later && later.frame - from >= minShotFrames) {
          cuts.push(later);
          from = later.frame;
          continue;
        }
        break;
      }
      cuts.push(next);
      from = next.frame;
    }
    requested = null;
    used = null;
  } else if (options.shotLength) {
    // A fixed shot length in bars (energy: low doubles it, high halves it).
    const grid = Math.min(GRID_LADDER[GRID_LADDER.length - 1], Math.max(1, options.shotLength * 4 * ENERGY_FACTOR[section.energy ?? "medium"]));
    // Counted from the bar the section starts on (a section snapped to a downbeat: its first shot is full).
    const anchor = beats.findIndex((b) => b.is_downbeat && toFrame(b.time_ms, fps) >= startFrame - early);
    cuts = anchor < 0 ? [] : beats.map((_, i) => i).filter((i) => i > anchor && (i - anchor) % grid === 0).map(cutAt).filter(insideSection);
    cuts = trimEdges(cuts, startFrame, endFrame, minShotFrames);
    requested = grid;
    used = grid;
  } else if (options.cutRate === "off") {
    // One cut per lyric line start, snapped to the nearest beat.
    cuts = dedupe(
      lines
        .map((l) => nearestBeat(beats, l.start_ms))
        .filter((i): i is number => i !== null)
        .map(cutAt)
        .filter(insideSection),
    );
    cuts = dropShortShots(cuts, startFrame, endFrame, minShotFrames);
  } else {
    requested = gridBeatsFor(options.cutRate, section.energy);
    // Grid anchored on the first bar start inside the section, so "every 2 bars" follows the section's phrases.
    const anchor = beats.findIndex((b) => b.is_downbeat && toFrame(b.time_ms, fps) - early > startFrame);
    const gridCuts = (grid: number) =>
      anchor < 0
        ? []
        : beats
            .map((_, i) => i)
            .filter((i) => i >= anchor ? (i - anchor) % grid === 0 : (anchor - i) % grid === 0)
            .map(cutAt)
            .filter(insideSection);

    // Too-short shots: step to the next coarser regular grid instead of dropping single cuts,
    // so the rhythm stays even (every beat -> every 2 beats -> every bar ...).
    let step = GRID_LADDER.indexOf(requested);
    cuts = gridCuts(GRID_LADDER[step]);
    while (step < GRID_LADDER.length - 1 && minGap(cuts) < minShotFrames) {
      step += 1;
      cuts = gridCuts(GRID_LADDER[step]);
    }
    used = GRID_LADDER[step];
    // A short first or last shot (section edge close to a cut) is merged into its neighbour;
    // that keeps the remaining cuts on the same even grid.
    cuts = trimEdges(cuts, startFrame, endFrame, minShotFrames);
  }

  if (options.holdOnLyricLines && lines.length) {
    cuts = holdOnLines(cuts, lines, beats, cutAt, insideSection, fps);
    // Moving cuts to line starts can bring two cuts close together; keep the minimum shot length.
    cuts = dropShortShots(cuts, startFrame, endFrame, minShotFrames);
  }

  return { start_frame: startFrame, end_frame: endFrame, fps, cuts, requested_grid_beats: requested, grid_beats: used };
}

// The cut for beat `index`: `early` frames before the beat (beats with the downbeat offset applied).
export function cutPointAt(beats: readonly Beat[], index: number, fps: number = VIDEO.fps, early: number = DEFAULT_EARLY_CUT_FRAMES): CutPoint {
  const frame = toFrame(beats[index].time_ms, fps) - early;
  const { bar, beatInBar } = barPosition(beats, index);
  return { frame, time_ms: toMs(frame, fps), beat_index: index, beat_time_ms: beats[index].time_ms, bar, beat_in_bar: beatInBar };
}

function nearestBeat(beats: readonly Beat[], ms: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < beats.length; i++) {
    if (best === null || Math.abs(beats[i].time_ms - ms) < Math.abs(beats[best].time_ms - ms)) best = i;
  }
  return best;
}

function dedupe(cuts: CutPoint[]): CutPoint[] {
  const sorted = [...cuts].sort((a, b) => a.frame - b.frame);
  return sorted.filter((c, i) => i === 0 || c.frame !== sorted[i - 1].frame);
}

function minGap(cuts: readonly CutPoint[]): number {
  let gap = Infinity;
  for (let i = 1; i < cuts.length; i++) gap = Math.min(gap, cuts[i].frame - cuts[i - 1].frame);
  return gap;
}

function trimEdges(cuts: CutPoint[], startFrame: number, endFrame: number, minShot: number): CutPoint[] {
  const out = [...cuts];
  if (out.length && out[0].frame - startFrame < minShot) out.shift();
  if (out.length && endFrame - out[out.length - 1].frame < minShot) out.pop();
  return out;
}

// Keeps cuts in order, dropping any that would make a shot shorter than minShot.
function dropShortShots(cuts: CutPoint[], startFrame: number, endFrame: number, minShot: number): CutPoint[] {
  const out: CutPoint[] = [];
  let previous = startFrame;
  for (const c of cuts) {
    if (c.frame - previous >= minShot) {
      out.push(c);
      previous = c.frame;
    }
  }
  while (out.length && endFrame - out[out.length - 1].frame < minShot) out.pop();
  return out;
}

// No cut inside a lyric line: a cut that falls inside a line moves to the next line start
// (snapped to the nearest beat). Cuts exactly on a line start are fine.
function holdOnLines(
  cuts: CutPoint[],
  lines: readonly { start_ms: number; end_ms: number }[],
  beats: readonly Beat[],
  cutAt: (index: number) => CutPoint,
  insideSection: (c: CutPoint) => boolean,
  fps: number,
): CutPoint[] {
  const sortedLines = [...lines].sort((a, b) => a.start_ms - b.start_ms);
  const insideLine = (c: CutPoint) => {
    const ms = (c.frame * 1000) / fps;
    return sortedLines.some((l) => ms > l.start_ms && ms < l.end_ms);
  };
  const moved = cuts.map((c) => {
    if (!insideLine(c)) return c;
    const ms = (c.frame * 1000) / fps;
    const next = sortedLines.find((l) => l.start_ms >= ms);
    const index = next ? nearestBeat(beats, next.start_ms) : null;
    return index === null ? null : cutAt(index);
  });
  return dedupe(moved.filter((c): c is CutPoint => c !== null && insideSection(c) && !insideLine(c)));
}
