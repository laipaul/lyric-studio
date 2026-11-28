// The two-layer timeline, Part B1 (28 Nov 2026): the lanes Shape draws, from the planned shots.
import { describe, expect, it } from "vitest";

import { layersOf } from "../src/layers";
import type { StoryShot } from "../src/storyboard";

const shot = (index: number, startMs: number, endMs: number, clip: string, role: StoryShot["role"], inS = 0, line: number | null = null): StoryShot => ({
  index, startMs, endMs, songMs: startMs, clip, thumb: null, kind: "video", inS, outS: inS + (endMs - startMs) / 1000, speed: 1, hold: false,
  anchor: line ? { line, text: "" } : null, role, dissolve: false, dip: false, loop: false, best: false, warnings: [],
});

describe("the lanes", () => {
  // B-roll, the singer (lines 6-7), a cut-away over her, the singer back in time, B-roll, then an empty planned shot.
  const shots = [
    shot(0, 0, 2000, "rings.mp4", "broll"),
    shot(1, 2000, 5000, "bride sings lines 6-7.mp4", "singing", 0.5, 6),
    shot(2, 5000, 6000, "flowers.mp4", "broll"),
    shot(3, 6000, 9000, "bride sings lines 6-7.mp4", "singing", 4.5),
    shot(4, 9000, 11000, "sea.mp4", "broll"),
    shot(5, 11000, 12000, "Shot 7 · no take yet", "empty"),
  ];
  const l = layersOf(shots);
  it("V1: one segment per singing take, the cut-away counted as covered (the singer plays on in time underneath)", () => {
    expect(l.singer).toEqual([{ clip: "bride sings lines 6-7.mp4", thumb: null, fromMs: 2000, toMs: 9000, line: 6, shots: [1, 3], covered: [{ fromMs: 5000, toMs: 6000 }] }]);
  });
  it("V2: every other shot", () => {
    expect(l.broll).toEqual([0, 2, 4, 5]);
  });
  it("what plays: B-roll, the singer or nothing, moment by moment, exactly the shots of the video", () => {
    expect(l.plays.map((p) => [p.fromMs, p.toMs, p.layer])).toEqual([[0, 2000, "broll"], [2000, 5000, "singer"], [5000, 6000, "broll"], [6000, 9000, "singer"], [9000, 11000, "broll"], [11000, 12000, "none"]]);
    for (let i = 1; i < l.plays.length; i++) expect(l.plays[i].fromMs).toBe(l.plays[i - 1].toMs); // no gap, no overlap
  });
  it("the soft changes: into the singer and out of it, at every change between the layers", () => {
    expect(l.fades).toEqual([
      { atMs: 2000, kind: "into-singer" }, { atMs: 5000, kind: "out-of-singer" }, { atMs: 6000, kind: "into-singer" }, { atMs: 9000, kind: "out-of-singer" },
    ]);
  });
  it("the same singing clip later but out of time (another place in the take) is a new segment", () => {
    const again = layersOf([shot(0, 0, 3000, "take.mp4", "singing", 0), shot(1, 3000, 4000, "b.mp4", "broll"), shot(2, 4000, 6000, "take.mp4", "singing", 0)]);
    expect(again.singer.map((s) => [s.fromMs, s.toMs])).toEqual([[0, 3000], [4000, 6000]]);
  });
  it("two singing takes back to back are two segments, with no fade between them", () => {
    const two = layersOf([shot(0, 0, 3000, "a.mp4", "singing"), shot(1, 3000, 6000, "b.mp4", "singing")]);
    expect(two.singer).toHaveLength(2);
    expect(two.fades).toEqual([]);
  });
});
