// Seeded clip assignment: which clip plays in each shot, from where, and at what speed.
import type { CutPlan } from "./cuts";
import { mulberry32, randomInt } from "./prng";

export type ClipInfo = { id: string; duration_ms: number };

export type Shot = {
  index: number;
  clip_id: string;
  start_frame: number; // on the song timeline
  end_frame: number; // exclusive
  duration_frames: number;
  clip_start_frame: number; // where playback starts inside the clip (clip frames)
  playback_rate: number; // 1 = normal speed, down to MIN_PLAYBACK_RATE (slowed to fit)
  hold_last_frame: boolean; // clip runs out even at MIN_PLAYBACK_RATE: freeze its last frame
};

export const MIN_PLAYBACK_RATE = 0.5;
export const RECENT_WINDOW = 3; // avoid clips used in the last 3 shots when the pool allows

export function assignClips(plan: CutPlan, clipsIn: readonly ClipInfo[], seed: number): Shot[] {
  if (!clipsIn.length) throw new Error("no clips to assign");
  // Sorted by id so the result depends only on the seed and the set of clips, not their order.
  const clips = [...clipsIn].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const random = mulberry32(seed);
  const clipFrames = (c: ClipInfo) => Math.floor((c.duration_ms * plan.fps) / 1000);

  const bounds = [plan.start_frame, ...plan.cuts.map((c) => c.frame), plan.end_frame];
  const window = Math.min(RECENT_WINDOW, clips.length - 1);
  const recent: string[] = [];
  const shots: Shot[] = [];

  for (let i = 0; i < bounds.length - 1; i++) {
    const length = bounds[i + 1] - bounds[i];
    const blocked = window > 0 ? recent.slice(-window) : [];
    const allowed = clips.filter((c) => !blocked.includes(c.id));
    // Prefer clips that cover the shot at normal speed, then ones that do when slowed down.
    const fitsNormal = allowed.filter((c) => clipFrames(c) >= length);
    const fitsSlowed = allowed.filter((c) => clipFrames(c) >= Math.ceil(length * MIN_PLAYBACK_RATE));
    const pool = fitsNormal.length ? fitsNormal : fitsSlowed.length ? fitsSlowed : allowed;
    const clip = pool[randomInt(random, pool.length - 1)];
    const available = clipFrames(clip);

    let clipStart = 0;
    let rate = 1;
    let hold = false;
    if (available >= length) {
      clipStart = randomInt(random, available - length);
    } else if (available >= Math.ceil(length * MIN_PLAYBACK_RATE)) {
      // Slow down just enough for the clip to fill the shot (rounded down so it never overruns).
      rate = Math.floor((available / length) * 10_000) / 10_000;
    } else {
      rate = MIN_PLAYBACK_RATE;
      hold = true;
    }

    shots.push({
      index: i,
      clip_id: clip.id,
      start_frame: bounds[i],
      end_frame: bounds[i + 1],
      duration_frames: length,
      clip_start_frame: clipStart,
      playback_rate: rate,
      hold_last_frame: hold,
    });
    recent.push(clip.id);
  }
  return shots;
}
