// B-roll inserts (27 Nov 2026, Paul: "build it": Shape's "B-roll here" → Insert at playhead): a clip shown over a stretch of
// the edit (song time), like a pro's cut-away. The insert's start and end snap to the beat (the app's job), or to a cut
// already there when one is close; the cuts it covers go; a singing shot is never covered this way (its own cut-away,
// the take's "hide", keeps the lips in time). After the insert the shot it interrupted plays on (compose.ts).
// Pure.
import type { Beat } from "./beats";
import { cutPointAt, type CutPlan, type CutPoint } from "./cuts";

export type ResolvedInsert = { fromMs: number; toMs: number; clipId: string; clipName: string }; // song ms
export type InsertPlan = { plan: CutPlan; shots: Map<number, ResolvedInsert>; notes: string[] }; // shots: the insert's first frame (song frames) → it

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;

export function planInserts(
  plan: CutPlan,
  beats: readonly Beat[],
  inserts: readonly ResolvedInsert[],
  protect: readonly { from: number; to: number }[], // song frames of singing shots
  o: { early?: number; minShotFrames?: number } = {},
): InsertPlan {
  const fps = plan.fps;
  const early = o.early ?? 2;
  const minShot = o.minShotFrames ?? Math.ceil(0.8 * fps);
  const beatCuts = beats.map((_, i) => cutPointAt(beats, i, fps, early)).filter((c) => c.frame > plan.start_frame && c.frame < plan.end_frame);
  const notes: string[] = [];
  const shots = new Map<number, ResolvedInsert>();
  let cuts: CutPoint[] = [...plan.cuts];
  const placed: { from: number; to: number }[] = [];
  const nearest = (frame: number, list: readonly CutPoint[]) => list.reduce<CutPoint | null>((best, c) => (!best || Math.abs(c.frame - frame) < Math.abs(best.frame - frame) ? c : best), null);
  for (const ins of [...inserts].sort((a, b) => a.fromMs - b.fromMs)) {
    const from = Math.round((ins.fromMs * fps) / 1000);
    const to = Math.round((ins.toMs * fps) / 1000);
    const when = `${clock(ins.fromMs)}–${clock(ins.toMs)}`;
    if (to <= plan.start_frame || from >= plan.end_frame || to <= from) {
      notes.push(`B-roll ${ins.clipName} at ${when} is outside this video`);
      continue;
    }
    // The start: a cut already there when close (the insert replaces the shot's start), else the nearest beat.
    const existing = nearest(from, cuts);
    const startFrame = from <= plan.start_frame + minShot ? plan.start_frame : existing && Math.abs(existing.frame - from) < minShot ? existing.frame : (nearest(from, beatCuts)?.frame ?? from);
    const endCut = to >= plan.end_frame - minShot ? null : (() => {
      const e = nearest(to, cuts);
      if (e && Math.abs(e.frame - to) < minShot && e.frame >= startFrame + minShot) return e;
      return nearest(to, beatCuts.filter((c) => c.frame >= startFrame + minShot)) ?? null;
    })();
    const endFrame = endCut?.frame ?? plan.end_frame;
    if (protect.some((p) => startFrame < p.to && endFrame > p.from)) {
      notes.push(`B-roll ${ins.clipName} at ${when} is over a singing shot: use Cut away to B-roll there (the singer comes back in time)`);
      continue;
    }
    if (placed.some((r) => startFrame < r.to && endFrame > r.from)) {
      notes.push(`B-roll ${ins.clipName} at ${when} overlaps another B-roll insert: left out`);
      continue;
    }
    const startCut = startFrame === plan.start_frame ? null : (cuts.find((c) => c.frame === startFrame) ?? beatCuts.find((c) => c.frame === startFrame) ?? null);
    // The cuts it covers go.
    cuts = cuts.filter((c) => c.frame <= startFrame || c.frame >= endFrame);
    if (startCut && !cuts.some((c) => c.frame === startFrame)) cuts.push(startCut);
    if (endCut && !cuts.some((c) => c.frame === endFrame)) cuts.push(endCut);
    cuts.sort((a, b) => a.frame - b.frame);
    shots.set(startFrame, ins);
    placed.push({ from: startFrame, to: endFrame });
  }
  return { plan: { ...plan, cuts }, shots, notes };
}
