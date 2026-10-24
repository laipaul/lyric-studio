// Clip assignment: which clip plays in each shot, from where, and at what speed.
//   story   - clips in file-name order (01_, 02_, ...), cycling; a clip shown again continues where
//             it stopped last time.
//   shuffle - seeded random order (mulberry32), avoiding the last 3 clips when the pool allows.
// Pins force a clip onto a shot and override both modes. Never the same clip twice in a row
// (unless two pins ask for it).
import type { CutPlan } from "./cuts";
import { mulberry32, randomInt } from "./prng";

export type ClipInfo = { id: string; duration_ms: number; name?: string; still?: boolean }; // still: a photo (any length)
export type ClipOrder = "story" | "shuffle";

export type Shot = {
  index: number;
  clip_id: string;
  start_frame: number; // on the song timeline
  end_frame: number; // exclusive
  duration_frames: number;
  clip_start_frame: number; // where playback starts inside the clip (clip frames)
  playback_rate: number; // 1 = normal speed, down to MIN_PLAYBACK_RATE (slowed to fit)
  hold_last_frame: boolean; // clip runs out even at MIN_PLAYBACK_RATE: freeze its last frame
  pinned: boolean;
  loop?: boolean; // loop ending: this last shot leads straight into the first one
};

export type AssignOptions = {
  order?: ClipOrder; // default "shuffle"
  pins?: ReadonlyMap<number, string>; // shot index -> clip id
  // Reels: the last shot shows the first clip's frames just before the first shot's, so the video
  // loops seamlessly (pins win over this).
  loopEnding?: boolean;
};

export const MIN_PLAYBACK_RATE = 0.5;
export const RECENT_WINDOW = 3; // shuffle: avoid clips used in the last 3 shots when the pool allows

const byId = (a: ClipInfo, b: ClipInfo) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const byFileName = (a: ClipInfo, b: ClipInfo) =>
  (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { numeric: true, sensitivity: "base" }) || byId(a, b);

export function assignClips(plan: CutPlan, clipsIn: readonly ClipInfo[], seed: number, options: AssignOptions = {}): Shot[] {
  if (!clipsIn.length) throw new Error("no clips to assign");
  const order = options.order ?? "shuffle";
  const pins = options.pins ?? new Map<number, string>();
  // Sorted, so the result depends only on the set of clips (and the seed), not on their order.
  const clips = [...clipsIn].sort(order === "story" ? byFileName : byId);
  const clipById = new Map(clips.map((c) => [c.id, c]));
  for (const id of pins.values()) if (!clipById.has(id)) throw new Error(`pinned clip not in the pool: ${id}`);

  const random = mulberry32(seed);
  const framesOf = (c: ClipInfo) => (c.still ? Number.MAX_SAFE_INTEGER : Math.floor((c.duration_ms * plan.fps) / 1000));
  const bounds = [plan.start_frame, ...plan.cuts.map((c) => c.frame), plan.end_frame];
  const window = Math.min(RECENT_WINDOW, clips.length - 1);
  const recent: string[] = [];
  const resumeAt = new Map<string, number>(); // story: where each clip continues next time
  let storyIndex = 0;
  const shots: Shot[] = [];

  const lastIndex = bounds.length - 2;
  const loop = !!options.loopEnding && lastIndex >= 2 && !pins.has(lastIndex) && clips.length > 1;
  for (let i = 0; i < bounds.length - 1; i++) {
    const length = bounds[i + 1] - bounds[i];
    const previous = recent[recent.length - 1];
    const loopClip = loop && i > 0 ? shots[0].clip_id : undefined;
    // Keep the loop clip out of the shots just before the loop shot (no repeat within 3 shots).
    const avoidLoop = loopClip && i < lastIndex && lastIndex - i <= window ? loopClip : undefined;
    const nextPinned = pins.get(i + 1) ?? (loopClip && i + 1 === lastIndex ? loopClip : undefined);
    const pinnedId = pins.get(i) ?? (loopClip && i === lastIndex ? loopClip : undefined);
    let clip: ClipInfo;

    if (pinnedId) {
      clip = clipById.get(pinnedId)!;
    } else if (order === "story") {
      // Next clip in file-name order; skip one that would repeat the previous shot or the next pin.
      clip = clips[storyIndex % clips.length];
      for (let tries = 0; tries < clips.length && clips.length > 1 && (clip.id === previous || clip.id === nextPinned || clip.id === avoidLoop); tries++) {
        storyIndex += 1;
        clip = clips[storyIndex % clips.length];
      }
      storyIndex += 1;
    } else {
      const blocked = new Set([...(window > 0 ? recent.slice(-window) : []), ...(nextPinned ? [nextPinned] : []), ...(avoidLoop ? [avoidLoop] : [])]);
      let allowed = clips.filter((c) => !blocked.has(c.id));
      if (!allowed.length) allowed = clips.filter((c) => c.id !== previous);
      if (!allowed.length) allowed = clips;
      // Prefer clips that cover the shot at normal speed, then ones that do when slowed down.
      const fitsNormal = allowed.filter((c) => framesOf(c) >= length);
      const fitsSlowed = allowed.filter((c) => framesOf(c) >= Math.ceil(length * MIN_PLAYBACK_RATE));
      const pool = fitsNormal.length ? fitsNormal : fitsSlowed.length ? fitsSlowed : allowed;
      clip = pool[randomInt(random, pool.length - 1)];
    }

    const available = framesOf(clip);
    let clipStart = 0;
    let rate = 1;
    let hold = false;
    let loopShot = false;
    if (loopClip && i === lastIndex) {
      // Continue into the first shot: play the frames right before where shot 1 starts.
      const first = shots[0];
      loopShot = true;
      if (clip.still) {
        clipStart = 0;
      } else if (first.playback_rate === 1 && first.clip_start_frame >= length) {
        clipStart = first.clip_start_frame - length;
      } else if (first.playback_rate === 1 && available >= length + first.duration_frames) {
        first.clip_start_frame = length; // make room before shot 1
        clipStart = 0;
      } else {
        loopShot = false; // the first clip is too short to continue: an ordinary last shot
      }
    }
    if (loopShot) {
      // clip start already set
    } else if (clip.still) {
      clipStart = 0; // photos: any length, the motion is fitted to the shot
    } else if (available >= length) {
      if (order === "story") {
        // Continue where this clip stopped last time; start over when the rest is too short.
        const resume = resumeAt.get(clip.id) ?? 0;
        clipStart = resume + length <= available ? resume : 0;
        resumeAt.set(clip.id, clipStart + length);
      } else {
        clipStart = randomInt(random, available - length);
      }
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
      pinned: !!pins.get(i),
      ...(loopShot ? { loop: true } : {}),
    });
    recent.push(clip.id);
  }
  return shots;
}
