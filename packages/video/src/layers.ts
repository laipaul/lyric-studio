// The two-layer timeline, Part B1 (28 Nov 2026): what Shape draws in its lanes, worked out from the planned shots (the
// same plan the video is made from, so the lanes always match the video).
//   V1 Singer  one segment per singing take on its lines: from its first singing shot to its last one, the cut-aways in
//              between counted as covered moments (the singer plays on underneath, in time, and comes back).
//   V2 B-roll  every other shot (story clips, cut-aways, a Mini film's planned shots).
//   What plays the layer the viewer sees at each moment: B-roll, the singer, or nothing (an empty planned shot), and
//              the soft changes between them (the B-roll fades out over the singer's first 0.4 s, in over its last).
// Pure.
import type { StoryShot } from "./storyboard";

export type SingerLane = { clip: string; thumb: string | null; fromMs: number; toMs: number; line: number | null; shots: number[]; covered: { fromMs: number; toMs: number }[] };
export type PlaySpan = { fromMs: number; toMs: number; layer: "broll" | "singer" | "none"; shot: number };
export type Layers = { singer: SingerLane[]; broll: number[]; plays: PlaySpan[]; fades: { atMs: number; kind: "into-singer" | "out-of-singer" }[] };

export const SOFT_CHANGE_MS = 400; // compose.ts: SOFT_SINGING_FRAMES (12) at 30 fps
const CONTINUITY_MS = 120; // the singer's clip time and the video time move together (in time), within a few frames

// Two singing shots of the same clip are one segment when the clip plays on in time between them (a cut-away).
const continues = (a: StoryShot, b: StoryShot) => a.clip === b.clip && Math.abs((b.inS - a.inS) * 1000 - (b.startMs - a.startMs)) <= CONTINUITY_MS;

export function layersOf(shots: readonly StoryShot[]): Layers {
  const sorted = [...shots].sort((a, b) => a.startMs - b.startMs);
  const singer: SingerLane[] = [];
  const broll: number[] = [];
  const plays: PlaySpan[] = [];
  for (const s of sorted) {
    plays.push({ fromMs: s.startMs, toMs: s.endMs, layer: s.role === "singing" ? "singer" : s.role === "broll" ? "broll" : "none", shot: s.index });
    if (s.role !== "singing") {
      broll.push(s.index);
      continue;
    }
    const last = singer.at(-1);
    const prev = last ? sorted.find((x) => x.index === last.shots.at(-1)) : undefined;
    if (last && prev && continues(prev, s)) {
      // The shots between them were B-roll over the singer (cut-aways).
      for (const b of sorted) if (b.role !== "singing" && b.startMs >= last.toMs - 1 && b.endMs <= s.startMs + 1) last.covered.push({ fromMs: b.startMs, toMs: b.endMs });
      last.toMs = s.endMs;
      last.shots.push(s.index);
    } else singer.push({ clip: s.clip, thumb: s.thumb, fromMs: s.startMs, toMs: s.endMs, line: s.anchor?.line ?? null, shots: [s.index], covered: [] });
  }
  // The soft changes: every change from B-roll (or nothing) into the singer, and back.
  const fades: Layers["fades"] = [];
  for (let i = 1; i < plays.length; i++) {
    const a = plays[i - 1].layer;
    const b = plays[i].layer;
    if (a !== "singer" && b === "singer") fades.push({ atMs: plays[i].fromMs, kind: "into-singer" });
    if (a === "singer" && b !== "singer") fades.push({ atMs: plays[i].fromMs, kind: "out-of-singer" });
  }
  return { singer, broll, plays, fades };
}
