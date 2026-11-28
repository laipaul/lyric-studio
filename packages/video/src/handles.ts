// Transition handles (22 Nov 2026): a dissolve only ever uses picture the clips really have, so it never freezes a frame.
// A dissolve of D frames into shot k is `before` frames of shot k fading in over the end of shot k-1, and `after`
// frames of shot k-1 still playing under the start of shot k (its `tail`). Both need spare clip frames ("handles"):
// shot k plays `before` frames earlier than its own start, shot k-1 plays `after` frames past its own end.
// What the app does, in this order (the user never tunes any of it; guiding principle):
//   1. it slides a clip's start earlier or later inside the part of the clip the user kept (their in / out points),
//      so the handle fits; the shot's length on screen and the cut on the beat never move;
//   2. if that is not enough, it slows the clip a little (at most 10%, never below 0.75x, never a singing clip), so it covers the dissolve
//      (what Paul does by hand in Canva);
//   3. if the clip still has too few frames, the dissolve is made shorter, down to a hard cut;
//   4. no clip ever plays past its last real frame (or past the user's out point).
// Shots that must not slide: a singing (lip-sync) shot, the loop shot and the shot it loops into, and a shot whose
// clip already runs out by design (holdLastFrame: slowed to the minimum and held). Pure.

export type HandleShot = {
  video: boolean; // false: a photo (any length; its move is fitted to the shot)
  duration: number; // shot frames on screen
  clipStartFrame: number; // clip frame the shot starts on (before any dissolve)
  playbackRate: number;
  holdLastFrame: boolean;
  lo: number; // the first clip frame it may use (the user's in point)
  hi: number; // one past the last clip frame it may use: min(the user's out point, the clip's real length)
  fixed?: boolean; // must not slide (singing, loop)
  // The shot comes right AFTER a singing take (soft exit, 28 Nov 2026): its dissolve lies wholly BEFORE the cut: it starts
  // that many frames early (its own footage before its start, or slid inside the part kept) and fades in over the take's last
  // frames. The take gets no tail and is never touched. Under MIN_FADE_IN_FRAMES it stays a hard cut.
  fadeInBeforeCut?: boolean;
  // A singing take (lip sync) right AFTER another kind of shot (soft entry, 28 Nov 2026): the dissolve lies wholly AFTER the
  // cut. The take is never faded, slid or slowed (it is full from its cut frame, in time with the song); the shot before it
  // plays on past the cut (its `tail`, on top) and dissolves OUT over the take's first frames. Without footage to play on
  // (under MIN_FADE_IN_FRAMES) it stays a hard cut. Use with `fixed`.
  singingIn?: boolean;
};

export type HandleNote = { shot: number; text: string };
// tailOver: the tail lies on top of the next shot (a singing take) and fades out, instead of the next shot fading in over it.
export type FittedShot = { clipStartFrame: number; playbackRate: number; dissolve?: { before: number; after: number }; tail?: number; tailOver?: boolean };

// Below this a dissolve is not worth it: a hard cut.
export const MIN_DISSOLVE_FRAMES = 4;
// A soft entry into / exit out of a singing take needs at least this many frames (0.2 s at 30 fps), else a hard cut.
export const MIN_FADE_IN_FRAMES = 6;
// How long the B-roll dissolves over a singing take's first / last frames: 0.4 s (Paul: about 0.3 to 0.5 s).
export const SOFT_SINGING_FRAMES = 12;
export const SINGING_CUT_NOTE = "a hard cut into this singing take (the clip before it has no footage left to play on)";
export const SINGING_EXIT_CUT_NOTE = "a hard cut out of this singing take (this clip has no footage before its start)";
// The most a clip is slowed to make room for a dissolve (0.9 = 10% slower), and never below this speed.
export const MAX_SLOWDOWN = 0.9;
const MIN_RATE = 0.75; // storyboard.ts CHOPPY_RATE: slower than this a 30 fps clip repeats frames visibly
// A slide smaller than this is not worth a note (a tenth of a second at 30 fps).
const NOTE_SLIDE_FRAMES = 3;

const secs = (frames: number, fps: number) => `${(frames / fps).toFixed(1)} s`;

// `wanted`: per shot index (1-based in the video: shot 0 has no transition in), the dissolve wanted into it, in
// frames (the whole dissolve, about centred on the cut). Returns each shot's fitted start, speed, dissolve and tail,
// and plain notes on what had to change.
export function fitHandles(
  shots: readonly HandleShot[],
  wanted: ReadonlyMap<number, number>,
  fps = 30,
): { shots: FittedShot[]; notes: HandleNote[] } {
  const start = shots.map((s) => s.clipStartFrame);
  const rate = shots.map((s) => s.playbackRate);
  const before = shots.map(() => 0);
  const tail = shots.map(() => 0);
  const notes: HandleNote[] = [];
  const slid = new Map<number, number>(); // shot -> clip frames moved later (+) or earlier (-)
  const slowed = new Set<number>();
  // Clip frames shot i spans for `frames` shot frames (first to last shown, counted the safe way: the last one rounded up).
  const used = (i: number, frames: number) => (frames <= 0 ? 0 : Math.ceil((frames - 1) * rate[i] - 1e-9) + 1);
  // May the app move shot i inside its clip (and slow it a little)?
  // (The planner fits a slowed clip by its own count, start + duration x speed <= its end: still free to move.)
  const free = shots.map((s) => s.video && !s.fixed && !s.holdLastFrame && s.clipStartFrame >= s.lo && s.clipStartFrame + Math.ceil(s.duration * s.playbackRate - 1e-9) <= s.hi);
  // Shot frames of picture shot i has beyond `occupied` shot frames (sliding inside the part kept).
  const span = (i: number, clipFrames: number) => (clipFrames <= 0 ? 0 : Math.floor((clipFrames - 1) / rate[i] + 1e-9) + 1); // shot frames that fit
  const room = (i: number, occupied: number) => Math.max(0, span(i, shots[i].hi - shots[i].lo) - occupied);
  // Slow shot i just enough (at most MAX_SLOWDOWN) to give it `extra` more shot frames beyond `occupied`.
  const slowFor = (i: number, occupied: number, extra: number) => {
    const s = shots[i];
    const floor = Math.max(MIN_RATE, s.playbackRate * MAX_SLOWDOWN); // never into visibly choppy slow motion
    const fit = Math.floor(((s.hi - s.lo - 1) / Math.max(1, occupied + extra - 1)) * 10_000) / 10_000;
    const r = Math.max(floor, fit);
    if (r < rate[i]) {
      rate[i] = r;
      slowed.add(i);
    }
  };

  for (let k = 1; k < shots.length; k++) {
    const want = wanted.get(k) ?? 0;
    if (want <= 0) continue;
    const prev = shots[k - 1];
    const cur = shots[k];
    const p = k - 1;
    // The outgoing shot: picture after what it already plays (its own dissolve in included).
    const exit = !!cur.fadeInBeforeCut;
    const entry = !!cur.singingIn;
    const soft = exit || entry;
    const halfWant = exit ? 0 : entry ? Math.min(want, Math.floor(cur.duration / 2)) : Math.min(Math.floor(want / 2), Math.floor(cur.duration / 2));
    let prevRoom: number;
    if (!prev.video) prevRoom = Infinity;
    else if (free[p]) {
      if (room(p, before[p] + prev.duration) < halfWant) slowFor(p, before[p] + prev.duration, halfWant);
      prevRoom = room(p, before[p] + prev.duration);
    } else prevRoom = prev.holdLastFrame ? 0 : Math.max(0, span(p, prev.hi - start[p]) - before[p] - prev.duration);
    const a0 = Math.max(0, Math.min(halfWant, prevRoom));
    // The incoming shot: picture before (or, sliding, around) what it plays.
    const bWant = entry ? 0 : Math.max(0, Math.min(want - a0, Math.floor(prev.duration / 2)));
    let curRoom: number;
    if (!cur.video) curRoom = Infinity;
    else if (free[k]) {
      if (room(k, cur.duration) < bWant) slowFor(k, cur.duration, bWant);
      curRoom = room(k, cur.duration);
    } else curRoom = cur.holdLastFrame ? 0 : Math.max(0, Math.floor((start[k] - cur.lo) / rate[k]));
    let a = a0;
    let b = Math.min(bWant, curRoom);
    if (a + b < (soft ? MIN_FADE_IN_FRAMES : MIN_DISSOLVE_FRAMES)) {
      a = 0;
      b = 0;
      if (soft) notes.push({ shot: k, text: entry ? SINGING_CUT_NOTE : SINGING_EXIT_CUT_NOTE });
    }
    if (!soft && want - (a + b) > NOTE_SLIDE_FRAMES) {
      notes.push({ shot: k, text: a + b === 0 ? `a hard cut into this clip instead of a ${secs(want, fps)} dissolve (the clips have no spare frames)` : `dissolve into this clip shortened to ${secs(a + b, fps)} (the clips have no more spare frames)` });
    }

    // The outgoing shot plays `a` frames longer: slide it earlier if its end has no room (or its new speed needs it).
    if (prev.video && free[p]) {
      const latest = prev.hi - used(p, before[p] + prev.duration + a);
      if (start[p] > latest) {
        const s = Math.max(prev.lo, latest);
        slid.set(p, (slid.get(p) ?? 0) + s - start[p]);
        start[p] = s;
      }
    }
    tail[p] = a;
    // The incoming shot starts `b` frames early: the same picture on the cut when its clip has the frames before it,
    // else slid as little as possible inside the part the user kept.
    before[k] = b;
    if (cur.video && !cur.holdLastFrame) {
      const target = start[k] - used(k, b);
      const s = free[k] ? Math.max(cur.lo, Math.min(target, cur.hi - used(k, b + cur.duration))) : target;
      if (s !== target) slid.set(k, s - target);
      start[k] = s;
    }
  }

  // Never past the last real frame: a tail the clip cannot fill is cut back (a fixed shot, or rounding).
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (!s.video || s.holdLastFrame) continue;
    const over = start[i] + used(i, before[i] + s.duration + tail[i]) - s.hi;
    if (over > 0 && tail[i] > 0) {
      tail[i] -= Math.min(tail[i], Math.ceil(over / rate[i]));
      const into = shots[i + 1];
      if (into?.singingIn && tail[i] < MIN_FADE_IN_FRAMES) {
        tail[i] = 0;
        notes.push({ shot: i + 1, text: SINGING_CUT_NOTE });
      } else if (i + 1 < shots.length && !notes.some((n) => n.shot === i + 1)) notes.push({ shot: i + 1, text: `dissolve into this clip shortened to ${secs(before[i + 1] + tail[i], fps)} (the clips have no more spare frames)` });
    }
  }

  // One calm line per shot: what was shortened first, then how the clip was fitted.
  const fitted = new Map<number, string[]>();
  const add = (i: number, t: string) => fitted.set(i, [...(fitted.get(i) ?? []), t]);
  for (const i of slowed) add(i, `slowed to ${Math.round((rate[i] / shots[i].playbackRate) * 100)}%`);
  for (const [i, frames] of slid) if (Math.abs(frames) >= NOTE_SLIDE_FRAMES) add(i, `starts ${secs(Math.abs(frames), fps)} ${frames > 0 ? "later" : "earlier"} in the clip`);
  const merged: HandleNote[] = [];
  for (let i = 0; i < shots.length; i++) {
    const short = notes.filter((n) => n.shot === i).map((n) => n.text);
    const parts = fitted.get(i);
    if (!short.length && !parts) continue;
    merged.push({ shot: i, text: [...short, ...(parts ? [`${parts.join(", ")} to fit the dissolve`] : [])].join("; ") });
  }
  const out: FittedShot[] = shots.map((_, i) => ({
    clipStartFrame: start[i],
    playbackRate: rate[i],
    // Into a singing take the shot is never faded: the shot before lies on top and fades out (tailOver).
    ...(i > 0 && !shots[i].singingIn && (before[i] || tail[i - 1]) ? { dissolve: { before: before[i], after: tail[i - 1] } } : {}),
    ...(tail[i] ? { tail: tail[i] } : {}),
    ...(tail[i] && shots[i + 1]?.singingIn ? { tailOver: true } : {}),
  }));
  return { shots: out, notes: merged };
}
