// Automatic pacing (shot lengths from the song's feel and the clips) and automatic transitions (cuts,
// dissolves, dips to black from the music).
import { describe, expect, it } from "vitest";

import { choosePace, dipOpacity, getCutPoints, planTransitions, songFeel, type PaceLine } from "../src";
import { grid } from "./helpers";

// 8 words over 4 s per line = 2 words/s (a ballad); 14 words over 4 s = 3.5 words/s (driving).
const linesAt = (wordsPerLine: number): PaceLine[] =>
  Array.from({ length: 6 }, (_, i) => ({ text: Array.from({ length: wordsPerLine }, () => "la").join(" "), sungStartMs: i * 6000, sungEndMs: i * 6000 + 4000 }));
const BAR_135 = 1778; // 135 BPM

describe("automatic pacing", () => {
  it("reads the feel from how densely the song is sung, not from the tempo", () => {
    expect(songFeel(linesAt(8))).toEqual({ feel: "calm", wordsPerS: 2 });
    expect(songFeel(linesAt(11)).feel).toBe("medium");
    expect(songFeel(linesAt(14)).feel).toBe("driving");
  });
  it("a calm song with ~5 s clips: 3 bars (5.3 s) on verses, 2 on hooks — never slower than 0.8x", () => {
    const p = choosePace({ lines: linesAt(8), barMs: BAR_135, clipMs: [5200, 5200, 4800, 5600] });
    expect(p).toMatchObject({ feel: "calm", verseBars: 3, hookBars: 2 });
    expect((p.verseBars * BAR_135) / 5200).toBeLessThanOrEqual(1 / 0.8);
    expect(p.text).toBe("Pacing: a calm song (2.0 words/s) and clips of about 5.2 s → 3 bars (5.3 s) on verses, 2 bars (3.6 s) on hooks.");
  });
  it("long clips allow the full calm pace; a driving song cuts every bar", () => {
    expect(choosePace({ lines: linesAt(8), barMs: 2000, clipMs: [12_000, 15_000] })).toMatchObject({ verseBars: 3, hookBars: 2 }); // 6 s, 4 s
    expect(choosePace({ lines: linesAt(8), barMs: 1500, clipMs: [12_000] })).toMatchObject({ verseBars: 4, hookBars: 2 }); // 6 s, 3 s
    expect(choosePace({ lines: linesAt(14), barMs: 2000, clipMs: [12_000] })).toMatchObject({ feel: "driving", verseBars: 1, hookBars: 1 });
  });
  it("very short clips: one bar at least, hooks never longer than verses", () => {
    const p = choosePace({ lines: linesAt(8), barMs: 2000, clipMs: [1200] });
    expect(p).toMatchObject({ verseBars: 1, hookBars: 1 });
  });
  it("the cut plan uses the pace: verse and hook bars, on downbeats, no short last shot", () => {
    const beats = grid(120, 80); // 2 s bars from 0:00.5
    const plan = getCutPoints(beats, { start_ms: 500, end_ms: 36_500 }, { cutRate: "1x", pace: { verseBars: 3, hookBars: 2, minShotMs: 3000 }, hooks: [{ start_ms: 12_250, end_ms: 24_400 }] }); // hooks start on screen (the lead), before the early cut
    const shots = [500, ...plan.cuts.map((c) => c.time_ms), 36_500].map((t, i, a) => (a[i + 1] ?? t) - t).slice(0, -1);
    expect(shots.map((ms) => Math.round(ms / 2000))).toEqual([3, 3, 2, 2, 2, 3, 3]);
  });
});

describe("automatic transitions", () => {
  const hooks = [{ start_ms: 20_000, end_ms: 30_000 }];
  const sung = [{ start_ms: 11_000, end_ms: 18_000 }, { start_ms: 20_000, end_ms: 29_000 }];
  const cuts = [{ shot: 1, songMs: 4_000 }, { shot: 2, songMs: 12_000 }, { shot: 3, songMs: 20_000 }, { shot: 4, songMs: 24_000 }, { shot: 5, songMs: 32_000 }];
  const kinds = (o: Partial<Parameters<typeof planTransitions>[0]>) => [...planTransitions({ style: "auto", feel: "calm", cuts, hooks, sung, barMs: 2000, ...o }).kinds.values()];
  it("a calm song: dissolves in the verses, a dip to black into the chorus, cuts inside it", () => {
    expect(kinds({})).toEqual(["dissolve", "dissolve", "dip", "cut", "dissolve"]);
    expect(planTransitions({ style: "auto", feel: "calm", cuts, hooks, sung, barMs: 2000 }).text).toBe(
      "Transitions: soft dissolves in the verses and quiet passages, cuts on the beat elsewhere, a dip to black into the chorus (a calm song).",
    );
  });
  it("a mid-paced song dissolves only where nobody sings; a driving song cuts", () => {
    expect(kinds({ feel: "medium" })).toEqual(["dissolve", "cut", "dip", "cut", "dissolve"]);
    expect(kinds({ feel: "driving" })).toEqual(["cut", "cut", "cut", "cut", "cut"]);
  });
  it("crisp = cuts, flowing = dissolves outside the hooks; a clip's own choice always wins", () => {
    expect(kinds({ style: "crisp" })).toEqual(["cut", "cut", "cut", "cut", "cut"]);
    expect(kinds({ style: "flowing", feel: "driving" })).toEqual(["dissolve", "dissolve", "dip", "cut", "dissolve"]);
    expect(kinds({ cuts: cuts.map((c) => (c.shot === 2 ? { ...c, fixed: "cut" as const } : c)) })[1]).toBe("cut");
  });
  it("a dip is darkest on the cut", () => {
    expect(dipOpacity(100, [{ frame: 100, frames: 16 }])).toBe(1);
    expect(dipOpacity(104, [{ frame: 100, frames: 16 }])).toBe(0.5);
    expect(dipOpacity(120, [{ frame: 100, frames: 16 }])).toBe(0);
  });
});

describe("pacing prefers normal speed (2 Nov 2026)", () => {
  const BAR_152 = 1579; // 152 BPM
  it("Familiar Strangers: calm, 152 BPM, clips of 5.17 s → 3 bars on verses (4.7 s at normal speed), not 4 bars slowed to 0.82x", () => {
    const p = choosePace({ lines: linesAt(8), barMs: BAR_152, clipMs: [5170, 5170, 5170] });
    expect(p.verseBars).toBe(3);
    expect(p.hookBars).toBeLessThanOrEqual(p.verseBars);
    expect(p.verseBars * BAR_152).toBeLessThanOrEqual(5170);
  });
  it("clips long enough (8 s) or photos only: the same result as before the slow-motion penalty", () => {
    expect(choosePace({ lines: linesAt(8), barMs: BAR_152, clipMs: [8000, 8000] })).toMatchObject({ verseBars: 4, hookBars: 2 });
    expect(choosePace({ lines: linesAt(8), barMs: BAR_152, clipMs: [] })).toMatchObject({ verseBars: 4, hookBars: 2, clipMs: null });
  });
  it("a clip the user slowed counts as longer (its usable length has the speed applied)", () => {
    expect(choosePace({ lines: linesAt(8), barMs: BAR_152, clipMs: [6500, 6500] }).verseBars).toBe(4); // 5.2 s slowed to 0.8x
  });
});
