// Transition handles (22 Nov 2026): a dissolve never freezes a frame (src/handles.ts).
import { describe, expect, it } from "vitest";

import { fitHandles, MIN_DISSOLVE_FRAMES, SINGING_CUT_NOTE, type HandleShot } from "../src/handles";

const video = (o: Partial<HandleShot> & { duration: number; clipStartFrame: number; hi: number }): HandleShot => ({
  video: true, playbackRate: 1, holdLastFrame: false, lo: 0, ...o,
});
// Clip frames a fitted shot plays from its start (before + on screen + tail), at its rate.
const end = (s: HandleShot, f: ReturnType<typeof fitHandles>["shots"][number]) =>
  f.clipStartFrame + Math.ceil(((f.dissolve?.before ?? 0) + s.duration + (f.tail ?? 0) - 1) * f.playbackRate - 1e-9) + 1;
const noFreeze = (shots: HandleShot[], fit: ReturnType<typeof fitHandles>) =>
  shots.forEach((s, i) => {
    if (!s.video || s.holdLastFrame) return;
    expect(fit.shots[i].clipStartFrame).toBeGreaterThanOrEqual(s.lo);
    expect(end(s, fit.shots[i])).toBeLessThanOrEqual(s.hi);
  });

describe("fitHandles", () => {
  it("Wedding Day 1 -> 2 -> 3: the mirror clip (0.9 s - its end) no longer runs past its last frame", () => {
    // The Reel as planned: 156-frame clips; shot 2 starts 27 frames in and plays to the very end.
    const shots = [
      video({ duration: 125, clipStartFrame: 31, hi: 156 }), // BeginningClip
      video({ duration: 129, clipStartFrame: 27, hi: 156 }), // Bride Infront of mirror
      video({ duration: 146, clipStartFrame: 10, hi: 156 }), // editorial close-up
    ];
    const fit = fitHandles(shots, new Map([[1, 46], [2, 46]]));
    noFreeze(shots, fit);
    // The dissolves keep (almost) their full length: the clips slide and slow down a little instead of freezing.
    expect((fit.shots[1].dissolve?.before ?? 0) + (fit.shots[1].dissolve?.after ?? 0)).toBe(46);
    expect((fit.shots[2].dissolve?.before ?? 0) + (fit.shots[2].dissolve?.after ?? 0)).toBe(46);
    expect(fit.shots[1].playbackRate).toBeGreaterThanOrEqual(0.9);
    expect(fit.notes.some((n) => n.shot === 1 && /slowed to 9\d%/.test(n.text))).toBe(true);
  });

  it("slides the incoming clip back when it has frames before its in point (same picture on the cut)", () => {
    const shots = [video({ duration: 90, clipStartFrame: 0, hi: 300 }), video({ duration: 90, clipStartFrame: 60, hi: 300 })];
    const fit = fitHandles(shots, new Map([[1, 30]]));
    expect(fit.shots[1].dissolve).toEqual({ before: 15, after: 15 });
    expect(fit.shots[1].clipStartFrame).toBe(45);
    expect(fit.shots[0].tail).toBe(15);
    expect(fit.notes).toEqual([]);
    noFreeze(shots, fit);
  });

  it("never uses frames outside the user's in / out points", () => {
    const shots = [video({ duration: 60, clipStartFrame: 30, lo: 30, hi: 90 }), video({ duration: 60, clipStartFrame: 30, lo: 30, hi: 90 })];
    const fit = fitHandles(shots, new Map([[1, 30]]));
    noFreeze(shots, fit);
    // 60 frames kept, a 60-frame shot: only slowing (at most 10%) gives room.
    const d = fit.shots[1].dissolve!;
    expect(d.before + d.after).toBeLessThan(30);
    expect(fit.notes.some((n) => /shortened/.test(n.text))).toBe(true);
  });

  it("shortens to a hard cut when the clips have no spare frames at all, and never slows a singing clip", () => {
    const shots = [
      video({ duration: 100, clipStartFrame: 0, hi: 100, fixed: true }), // singing
      video({ duration: 100, clipStartFrame: 0, hi: 100, fixed: true }),
    ];
    const fit = fitHandles(shots, new Map([[1, 30]]));
    expect(fit.shots[1].dissolve).toBeUndefined();
    expect(fit.shots[0].tail).toBeUndefined();
    expect(fit.shots.map((s) => s.playbackRate)).toEqual([1, 1]);
    expect(fit.notes[0].text).toMatch(/hard cut/);
    expect(MIN_DISSOLVE_FRAMES).toBeGreaterThan(0);
  });

  it("photos have any length: the dissolve stays whole", () => {
    const shots: HandleShot[] = [
      { video: false, duration: 90, clipStartFrame: 0, playbackRate: 1, holdLastFrame: false, lo: 0, hi: 1 },
      { video: false, duration: 90, clipStartFrame: 0, playbackRate: 1, holdLastFrame: false, lo: 0, hi: 1 },
    ];
    const fit = fitHandles(shots, new Map([[1, 46]]));
    expect(fit.shots[1].dissolve).toEqual({ before: 23, after: 23 });
  });

  it("a chain of short clips: no shot ever plays past its end", () => {
    const shots = Array.from({ length: 8 }, (_, i) => video({ duration: 120 + (i % 3) * 5, clipStartFrame: 10 + i, hi: 156 }));
    const fit = fitHandles(shots, new Map(shots.slice(1).map((_, i) => [i + 1, 46])));
    noFreeze(shots, fit);
    for (const s of fit.shots) expect(s.playbackRate).toBeGreaterThanOrEqual(0.9);
  });
});

// The planner end to end (compose.ts): every dissolve fitted, no shot ever plays past its clip's last frame.
import { composeProps, getCutPoints, type RenderBase } from "../src";
import { grid } from "./helpers";

describe("composeProps: dissolves never freeze a frame", () => {
  const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
  const baseFor = (bpm: number, clipMs: number, edits: { in_ms?: number; out_ms?: number } = {}): RenderBase => {
    const plan = getCutPoints(grid(bpm, 80, 500), { start_ms: 500, end_ms: 40_500 }, { cutRate: "1x" });
    const frames = Math.floor((clipMs * 30) / 1000);
    return {
      plan,
      clips: ["a", "b", "c", "d", "e"].map((n, i) => ({ id: `id-${i}`, name: `${n}.mp4`, duration_ms: clipMs, path: `cache/${n}.mp4`, durationFrames: frames, ...edits })),
      audio: null,
      durationInFrames: plan.end_frame - plan.start_frame,
      lyrics: [],
      styles: { simple: { style, textSize: 64, hookFont: null, fonts: [] }, bold: { style, textSize: 72, hookFont: null, fonts: [] } },
      colour: "#fff",
      cinematicBars: false,
      pins: [],
      beats: grid(bpm, 80, 500),
      transitions: { style: "flowing", feel: "calm", hooks: [], sung: [] },
    } as RenderBase;
  };
  const check = (b: RenderBase) => {
    const { props } = composeProps(b, { seed: 3, style: "simple", order: "story" });
    let dissolves = 0;
    for (const s of props.shots) {
      if (s.dissolve) dissolves++;
      if (s.kind === "photo" || s.holdLastFrame) continue;
      const plays = s.clipStartFrame + Math.ceil(((s.dissolve?.before ?? 0) + s.duration + (s.tail ?? 0) - 1) * s.playbackRate - 1e-9) + 1;
      expect(plays).toBeLessThanOrEqual(s.clipDurationFrames);
      expect(s.playbackRate).toBeGreaterThanOrEqual(0.9 - 1e-9);
    }
    return { props, dissolves };
  };

  it("Wedding Day-like: 116 BPM, 5.2 s clips, shots of two bars, ~1.5 s dissolves", () => {
    const { props, dissolves } = check(baseFor(116, 5_200));
    expect(dissolves).toBeGreaterThan(0);
    // About 1.5 s, in whole beats (3 beats at 116 BPM = 46-47 frames), where the clips allow it.
    const longest = Math.max(...props.shots.map((s) => (s.dissolve ? s.dissolve.before + s.dissolve.after : 0)));
    expect(longest).toBeGreaterThanOrEqual(46);
    expect(longest).toBeLessThanOrEqual(47);
  });

  it("another song: 80 BPM, long clips trimmed by the user (in 1 s, out 6 s): never outside the trim", () => {
    const { props } = check(baseFor(80, 10_000, { in_ms: 1_000, out_ms: 6_000 }));
    for (const s of props.shots) {
      expect(s.clipStartFrame).toBeGreaterThanOrEqual(30);
      expect(s.clipStartFrame + Math.ceil(((s.dissolve?.before ?? 0) + s.duration + (s.tail ?? 0) - 1) * s.playbackRate - 1e-9) + 1).toBeLessThanOrEqual(180);
    }
  });

  describe("a dissolve into a singing take (fadeInBeforeCut)", () => {
    const take = (lead: number, extra: Partial<HandleShot> = {}) =>
      video({ duration: 120, clipStartFrame: lead, lo: 0, hi: 400, fixed: true, fadeInBeforeCut: true, ...extra });
    it("20 lead-in frames, 46 wanted: the take starts 20 frames early at the same speed, the previous shot has no tail", () => {
      const shots = [video({ duration: 150, clipStartFrame: 0, hi: 300 }), take(20)];
      const fit = fitHandles(shots, new Map([[1, 46]]));
      expect(fit.shots[1].dissolve).toEqual({ before: 20, after: 0 }); // min(46, 150/2, 20)
      expect(fit.shots[1].clipStartFrame).toBe(0); // 20 - 20: no slide, same picture on the cut
      expect(fit.shots[1].playbackRate).toBe(1);
      expect(fit.shots[0].tail).toBeUndefined();
      expect(fit.notes).toEqual([]); // shorter than wanted is expected for a take
      noFreeze(shots, fit);
    });
    it("a long lead-in gives the whole wanted dissolve, limited by half the previous shot", () => {
      const fit = fitHandles([video({ duration: 150, clipStartFrame: 0, hi: 300 }), take(100)], new Map([[1, 46]]));
      expect(fit.shots[1].dissolve).toEqual({ before: 46, after: 0 });
      expect(fit.shots[1].clipStartFrame).toBe(54);
      const short = fitHandles([video({ duration: 60, clipStartFrame: 0, hi: 300 }), take(100)], new Map([[1, 46]]));
      expect(short.shots[1].dissolve).toEqual({ before: 30, after: 0 });
    });
    it("3 lead-in frames: a hard cut, with the note", () => {
      const shots = [video({ duration: 150, clipStartFrame: 0, hi: 300 }), take(3)];
      const fit = fitHandles(shots, new Map([[1, 46]]));
      expect(fit.shots[1].dissolve).toBeUndefined();
      expect(fit.shots[1].clipStartFrame).toBe(3);
      expect(fit.notes).toEqual([{ shot: 1, text: SINGING_CUT_NOTE }]);
      expect(SINGING_CUT_NOTE).toBe("a hard cut into this singing take (the take starts right on the line)");
    });
    it("uses only frames after the user's in point; a take that leaves less than 6 stays a cut", () => {
      const shots = [video({ duration: 150, clipStartFrame: 0, hi: 300 }), take(20, { lo: 15, hi: 140 })];
      const fit = fitHandles(shots, new Map([[1, 46]]));
      expect(fit.shots[1].dissolve).toBeUndefined(); // 5 lead-in frames < 6: a cut
      expect(fit.notes[0].text).toBe(SINGING_CUT_NOTE);
    });
  });
});
