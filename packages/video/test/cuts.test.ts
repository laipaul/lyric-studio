import { describe, expect, it } from "vitest";

import { applyDownbeatOffset, barPosition, getCutPoints, gridBeatsFor, type CutPlan } from "../src";
import { frameOf, grid } from "./helpers";

// 120 BPM: one beat = 500 ms = 15 frames, one bar = 2 s = 60 frames.
const beats = grid(120, 64); // 32 s, downbeats at 0.5 s, 2.5 s, 4.5 s, ...
const section = { start_ms: 0, end_ms: 30_000 };

const shotLengths = (plan: CutPlan) => {
  const bounds = [plan.start_frame, ...plan.cuts.map((c) => c.frame), plan.end_frame];
  return bounds.slice(1).map((b, i) => b - bounds[i]);
};

describe("cut rate", () => {
  it("1x cuts on every downbeat, earlyCutFrames before it", () => {
    for (const early of [0, 2, 4]) {
      const plan = getCutPoints(beats, section, { cutRate: "1x", earlyCutFrames: early });
      expect(plan.cuts.length).toBeGreaterThan(10);
      for (const c of plan.cuts) {
        expect(beats[c.beat_index].is_downbeat).toBe(true);
        expect(c.beat_in_bar).toBe(1);
        expect(c.frame).toBe(frameOf(c.beat_time_ms) - early);
      }
    }
  });

  it("defaults to cutting 2 frames early", () => {
    const plan = getCutPoints(beats, section, { cutRate: "1x" });
    for (const c of plan.cuts) expect(c.frame).toBe(frameOf(c.beat_time_ms) - 2);
  });

  it("2x doubles the cuts (every half bar), 0.5x halves them (every 2 bars)", () => {
    const one = getCutPoints(beats, section, { cutRate: "1x" }).cuts;
    const two = getCutPoints(beats, section, { cutRate: "2x" }).cuts;
    const half = getCutPoints(beats, section, { cutRate: "0.5x" }).cuts;
    expect(two.length).toBeGreaterThanOrEqual(2 * one.length - 1);
    expect(two.length).toBeLessThanOrEqual(2 * one.length + 1);
    expect(half.length).toBeGreaterThanOrEqual(Math.floor(one.length / 2) - 1);
    expect(half.length).toBeLessThanOrEqual(Math.ceil(one.length / 2));
    expect(new Set(two.map((c) => c.beat_in_bar))).toEqual(new Set([1, 3]));
    // 0.5x: every other bar, counted from the first bar of the section
    const bars = half.map((c) => c.bar);
    bars.slice(1).forEach((b, i) => expect(b - bars[i]).toBe(2));
  });

  it("rejects earlyCutFrames outside 0-4", () => {
    expect(() => getCutPoints(beats, section, { cutRate: "1x", earlyCutFrames: 5 })).toThrow();
  });
});

describe("energy", () => {
  it("low energy halves the cuts, high doubles them", () => {
    const medium = getCutPoints(beats, { ...section, energy: "medium" }, { cutRate: "1x" }).cuts;
    const low = getCutPoints(beats, { ...section, energy: "low" }, { cutRate: "1x" }).cuts;
    const high = getCutPoints(beats, { ...section, energy: "high" }, { cutRate: "1x" }).cuts;
    expect(low.length).toBeGreaterThanOrEqual(Math.floor(medium.length / 2) - 1);
    expect(low.length).toBeLessThanOrEqual(Math.ceil(medium.length / 2));
    expect(high.length).toBeGreaterThanOrEqual(2 * medium.length - 1);
  });

  it("maps rate + energy to beats per cut", () => {
    expect(gridBeatsFor("1x", "medium")).toBe(4);
    expect(gridBeatsFor("1x", "low")).toBe(8);
    expect(gridBeatsFor("2x", "high")).toBe(1);
    expect(gridBeatsFor("0.5x", "low")).toBe(16);
  });
});

describe("downbeat offset", () => {
  it("shifts bar 1 by N beats", () => {
    const shifted = applyDownbeatOffset(beats, 1);
    expect(shifted.findIndex((b) => b.is_downbeat)).toBe(1);
    const starts = shifted.flatMap((b, i) => (b.is_downbeat ? [i] : []));
    starts.slice(1).forEach((s, i) => expect(s - starts[i]).toBe(4));
    expect(applyDownbeatOffset(beats, 3).findIndex((b) => b.is_downbeat)).toBe(3);
    expect(applyDownbeatOffset(beats, 0)).toEqual(beats);
    // Offsets wrap within a bar: detected phase 3 + offset 2 = phase 1
    expect(applyDownbeatOffset(grid(120, 16, 500, 3), 2).findIndex((b) => b.is_downbeat)).toBe(1);
    expect(() => applyDownbeatOffset(beats, 4)).toThrow();
  });

  it("moves the cuts to the shifted bar starts", () => {
    for (const offset of [1, 2, 3]) {
      const plan = getCutPoints(beats, section, { cutRate: "1x", downbeatOffset: offset });
      for (const c of plan.cuts) {
        expect(c.beat_index % 4).toBe(offset);
        expect(c.beat_in_bar).toBe(1);
      }
    }
  });

  it("numbers bars from the first downbeat", () => {
    const pickup = grid(120, 12, 500, 2);
    expect(barPosition(pickup, 0)).toEqual({ bar: 0, beatInBar: 3 });
    expect(barPosition(pickup, 2)).toEqual({ bar: 1, beatInBar: 1 });
    expect(barPosition(pickup, 7)).toEqual({ bar: 2, beatInBar: 2 });
  });
});

describe("minimum shot length", () => {
  it("is respected for every rate and energy", () => {
    for (const bpm of [90, 120, 128, 160, 174]) {
      const b = grid(bpm, 120);
      for (const cutRate of ["0.5x", "1x", "2x"] as const) {
        for (const energy of ["low", "medium", "high"] as const) {
          const plan = getCutPoints(b, { start_ms: 1_234, end_ms: 40_000, energy }, { cutRate });
          for (const len of shotLengths(plan)) expect(len).toBeGreaterThanOrEqual(24);
        }
      }
    }
  });

  it("steps to a coarser regular grid: thinned cuts are evenly spaced in beats", () => {
    // 160 BPM, 2x + high = every beat (375 ms) is too short; every 2 beats (750 ms) too;
    // every 4 beats (1.5 s) is the first grid that fits.
    const fast = grid(160, 200);
    const plan = getCutPoints(fast, { start_ms: 0, end_ms: 60_000, energy: "high" }, { cutRate: "2x" });
    expect(plan.requested_grid_beats).toBe(1);
    expect(plan.grid_beats).toBe(4);
    const steps = plan.cuts.slice(1).map((c, i) => c.beat_index - plan.cuts[i].beat_index);
    expect(new Set(steps)).toEqual(new Set([4]));

    // 128 BPM every beat (469 ms) -> every 2 beats (938 ms)
    const plan128 = getCutPoints(grid(128, 200), { start_ms: 0, end_ms: 60_000, energy: "high" }, { cutRate: "2x" });
    expect(plan128.grid_beats).toBe(2);
    const steps128 = plan128.cuts.slice(1).map((c, i) => c.beat_index - plan128.cuts[i].beat_index);
    expect(new Set(steps128)).toEqual(new Set([2]));
  });

  it("drops a cut too close to the section edges without breaking the grid", () => {
    // Section starts 200 ms before a downbeat and ends 300 ms after one.
    const plan = getCutPoints(beats, { start_ms: 2_300, end_ms: 20_800 }, { cutRate: "1x" });
    expect(plan.cuts[0].beat_time_ms).toBe(4_500);
    expect(plan.cuts[plan.cuts.length - 1].beat_time_ms).toBe(18_500);
    for (const len of shotLengths(plan)) expect(len).toBeGreaterThanOrEqual(24);
  });
});

describe("lyric lines", () => {
  const lines = [
    { start_ms: 1_000, end_ms: 4_200 },
    { start_ms: 5_100, end_ms: 9_900 },
    { start_ms: 10_400, end_ms: 13_000 },
    { start_ms: 14_200, end_ms: 21_700 },
    { start_ms: 22_500, end_ms: 26_000 },
  ];
  const inside = (ms: number) => lines.some((l) => ms > l.start_ms && ms < l.end_ms);

  it("holdOnLyricLines never cuts inside a line", () => {
    for (const cutRate of ["0.5x", "1x", "2x"] as const) {
      for (const energy of ["low", "medium", "high"] as const) {
        const plan = getCutPoints(beats, { ...section, energy }, { cutRate, holdOnLyricLines: true, lyricLines: lines });
        expect(plan.cuts.length).toBeGreaterThan(0);
        for (const c of plan.cuts) expect(inside(c.time_ms)).toBe(false);
        for (const len of shotLengths(plan)) expect(len).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it("without hold, the same rate does cut inside lines (so the test above means something)", () => {
    const plan = getCutPoints(beats, section, { cutRate: "2x" });
    expect(plan.cuts.some((c) => inside(c.time_ms))).toBe(true);
  });

  it("cut rate Off: one cut per line start, snapped to the nearest beat", () => {
    const plan = getCutPoints(beats, section, { cutRate: "off", lyricLines: lines });
    expect(plan.grid_beats).toBeNull();
    expect(plan.cuts.map((c) => c.beat_time_ms)).toEqual([1_000, 5_000, 10_500, 14_000, 22_500]);
    for (const c of plan.cuts) expect(c.frame).toBe(frameOf(c.beat_time_ms) - 2);
  });
});
