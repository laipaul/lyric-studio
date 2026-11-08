// The Shape timeline's pro edits (7 Nov 2026, asked by the user: "a world class tool like the pros do"):
//   roll  drag the cut between two shots: one gets longer, the other shorter, nothing else moves (the music
//         is fixed, so a ripple would push every later cut off its place);
//   slip  drag inside a shot: it keeps its place and length, another part of its clip plays in it.
// Stored in the song's clips.json on the SONG's timeline (seconds), so every video covering that moment
// (Reels, TikTok, Shorts, YouTube) gets them:
//   "cuts":  [{ "from": 47.8, "to": 48.3 }]                 the planned cut at 0:47.8 moves to 0:48.3
//                                                          (snapped to the beat; "free": true = exactly there)
//   "slips": [{ "at": 48.3, "clip": "06_rings.mp4", "in": 1.4 }]  the shot starting at 0:48.3 plays
//                                                          06_rings.mp4 from 1.4 s
// The planner applies the cut moves to its automatic cuts, then the slips (a story anchor on the same shot
// wins). An edit whose cut or shot is no longer there (another section, the tempo changed) is left aside.
// Pure, so the planner, the studio and the tests share it.
import type { Beat } from "./beats";
import { cutPointAt, type CutPlan, type CutPoint } from "./cuts";

export type CutMove = { from: number; to: number; free?: true };
export type Slip = { at: number; clip: string; in: number };
export type TimelineEdits = { cuts: CutMove[]; slips: Slip[] };

export const MATCH_MS = 200; // a stored cut / shot start matches a planned one this close (frame rounding, early cuts)
export const MIN_ROLL_SHOT_MS = 400; // a roll never makes a shot shorter than this

const sec = (ms: number) => Math.round(ms / 10) / 100; // seconds with 2 decimals, as stored

// The nearest beat to `ms` (song time), or null without beats.
export function nearestBeat(beats: readonly Beat[], ms: number): { index: number; time_ms: number } | null {
  let best: { index: number; time_ms: number } | null = null;
  beats.forEach((b, index) => {
    if (!best || Math.abs(b.time_ms - ms) < Math.abs(best.time_ms - ms)) best = { index, time_ms: b.time_ms };
  });
  return best;
}

// Where a cut lands for a move to `toMs`: on the nearest beat (as the planner cuts: a couple of frames early),
// or exactly there when free.
export function cutAtMs(beats: readonly Beat[], toMs: number, fps: number, free = false): CutPoint | null {
  const beat = nearestBeat(beats, toMs);
  if (!beat) return null;
  if (!free) return cutPointAt(beats, beat.index, fps);
  const snapped = cutPointAt(beats, beat.index, fps);
  const frame = Math.round((toMs * fps) / 1000);
  return { ...snapped, frame, time_ms: Math.round((frame * 1000) / fps) };
}

// The plan with the user's cut moves applied: each move takes the planned cut nearest its `from` (within
// MATCH_MS) to its `to`, between the neighbouring cuts (never closer than MIN_ROLL_SHOT_MS). Returns the
// plan and the song times (ms) of the cuts the user placed.
export function applyCutMoves(plan: CutPlan, beats: readonly Beat[], moves: readonly CutMove[]): { plan: CutPlan; moved: number[] } {
  if (!moves.length || !beats.length) return { plan, moved: [] };
  const fps = plan.fps;
  const ms = (frame: number) => (frame * 1000) / fps;
  const cuts = [...plan.cuts];
  const moved: number[] = [];
  for (const m of moves) {
    let j = -1;
    for (let k = 0; k < cuts.length; k++) if (Math.abs(cuts[k].time_ms - m.from * 1000) <= MATCH_MS && (j < 0 || Math.abs(cuts[k].time_ms - m.from * 1000) < Math.abs(cuts[j].time_ms - m.from * 1000))) j = k;
    if (j < 0) continue; // that cut is not in this plan (another section, or the plan changed)
    const to = cutAtMs(beats, m.to * 1000, fps, m.free === true);
    if (!to) continue;
    const lo = ms(j > 0 ? cuts[j - 1].frame : plan.start_frame) + MIN_ROLL_SHOT_MS;
    const hi = ms(j < cuts.length - 1 ? cuts[j + 1].frame : plan.end_frame) - MIN_ROLL_SHOT_MS;
    if (ms(to.frame) < lo || ms(to.frame) > hi) continue; // would cross or crush a neighbour
    cuts[j] = to;
    moved.push(to.time_ms);
  }
  return { plan: { ...plan, cuts }, moved };
}

// The slip for a shot starting at `startMs` (song time) whose clip is `clip`, if the user set one.
export function slipFor(slips: readonly Slip[], startMs: number, clip?: string): Slip | undefined {
  return slips.find((s) => Math.abs(s.at * 1000 - startMs) <= MATCH_MS && (clip === undefined || s.clip.toLowerCase() === clip.toLowerCase()));
}

// ---- Edits made with the mouse (the studio) ----
export type EditShot = { startMs: number; endMs: number; clip: string; kind: "video" | "photo"; inS: number; speed: number; clipInS: number; clipOutS: number }; // song times; the clip's usable part

// A roll of the cut between `left` and `right` from `fromMs` to `toMs` (song time): the cut move, plus the
// slips that keep what the viewer sees around the cut: the left shot still starts on the same frame (it just
// plays longer or shorter), the right shot still ENDS on the same frame (it starts earlier or later in its clip).
export function rollEdit(left: EditShot, right: EditShot, fromMs: number, toMs: number, free = false): { move: CutMove; slips: Slip[] } {
  const slips: Slip[] = [];
  if (left.kind === "video") slips.push({ at: sec(left.startMs), clip: left.clip, in: sec(left.inS * 1000) });
  if (right.kind === "video") {
    const shift = ((toMs - fromMs) / 1000) * right.speed; // later cut: the right shot starts later in its clip
    const inS = Math.min(Math.max(right.clipInS, right.inS + shift), right.clipOutS);
    slips.push({ at: sec(toMs), clip: right.clip, in: sec(inS * 1000) });
  }
  return { move: { from: sec(fromMs), to: sec(toMs), ...(free ? { free: true as const } : {}) }, slips };
}

// A slip of `shot` by `deltaMs` of mouse travel (right = earlier frames come into view, as in Premiere):
// the clip start moves the other way, kept inside the clip's usable part so the shot never runs out.
export function slipEdit(shot: EditShot, deltaMs: number): Slip {
  const needS = ((shot.endMs - shot.startMs) / 1000) * shot.speed;
  const max = Math.max(shot.clipInS, shot.clipOutS - needS);
  const inS = Math.min(Math.max(shot.clipInS, shot.inS - (deltaMs / 1000) * shot.speed), max);
  return { at: sec(shot.startMs), clip: shot.clip, in: sec(inS * 1000) };
}

// Merge a roll or slip into the stored edits: a cut already moved is moved again (one entry, from its first
// place); a slip replaces the one on the same shot (and a roll drops the slip that sat on the old cut).
export function mergeTimeline(t: TimelineEdits, e: { move?: CutMove; slips?: Slip[] }): TimelineEdits {
  let cuts = [...t.cuts];
  let slips = [...t.slips];
  if (e.move) {
    const near = (a: number, b: number) => Math.abs(a - b) * 1000 <= MATCH_MS;
    const prior = cuts.find((c) => near(c.to, e.move!.from));
    cuts = cuts.filter((c) => c !== prior);
    const from = prior ? prior.from : e.move.from;
    if (!near(from, e.move.to) || e.move.free) cuts.push({ ...e.move, from }); // back where it was: no move left
    slips = slips.filter((s) => !near(s.at, e.move!.from));
  }
  for (const s of e.slips ?? []) {
    slips = slips.filter((x) => !(Math.abs(x.at - s.at) * 1000 <= MATCH_MS));
    slips.push(s);
  }
  return { cuts, slips };
}

// "↺ automatic" on a shot (song times): its slip and the moves of the cuts at its start and end are dropped.
export function resetShot(t: TimelineEdits, startMs: number, endMs: number): TimelineEdits {
  const near = (s: number, ms: number) => Math.abs(s * 1000 - ms) <= MATCH_MS;
  return {
    cuts: t.cuts.filter((c) => !near(c.to, startMs) && !near(c.to, endMs)),
    slips: t.slips.filter((s) => !near(s.at, startMs)),
  };
}

// Where a dragged cut snaps while the mouse is still down (the studio's roll handle). `beatsMs` are the video's beat
// times, `fromMs` the cut's own place. Nearest beat as before, with two additions so a small drag is not lost:
// less than a quarter beat from where it started stays exactly there (the readout says +0.00 s), and once past a
// quarter beat it goes to the next beat in the drag direction, never back to the beat it came from.
// Alt (free): the frame under the pointer.
export function snapRollMs(rawMs: number, fromMs: number, beatsMs: readonly number[], free: boolean, fps = 30): number {
  const frame = 1000 / fps;
  if (free || !beatsMs.length) return Math.round(rawMs / frame) * frame;
  const b = [...beatsMs].sort((x, y) => x - y);
  const nearestIdx = (ms: number) => b.reduce((best, t, i) => (Math.abs(t - ms) < Math.abs(b[best] - ms) ? i : best), 0);
  const dir = rawMs >= fromMs ? 1 : -1;
  const origin = nearestIdx(fromMs);
  const next = b[origin + dir];
  const toward = (rawMs - fromMs) * dir;
  if (next === undefined) return b[nearestIdx(rawMs)];
  const period = Math.abs(next - b[origin]);
  if (toward < period / 4) return fromMs;
  const near = nearestIdx(rawMs);
  return (near - origin) * dir <= 0 ? next : b[near];
}

// A clip lifted on the Shape timeline and dropped onto another shot (8 Nov 2026): the two clips swap places in the
// story order, so A plays where B played and B where A played; the cuts stay where they are (the music is fixed).
// Anchors follow their clips: a lyric line anchored on A is anchored on B, and the other way round. Doing it twice
// gives everything back (Undo is the same swap). Names compare without case; anything else is unchanged.
export function swapInStory<A extends { clip: string }>(order: readonly string[], anchors: readonly A[], a: string, b: string): { order: string[]; anchors: A[] } {
  const is = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  const spelt = (n: string) => order.find((x) => is(x, n)) ?? n; // the names as the order spells them
  const [sa, sb] = [spelt(a), spelt(b)];
  const other = (n: string) => (is(n, a) ? sb : is(n, b) ? sa : n);
  return {
    order: order.map(other),
    anchors: anchors.map((x) => (is(x.clip, a) || is(x.clip, b) ? { ...x, clip: other(x.clip) } : x)),
  };
}
