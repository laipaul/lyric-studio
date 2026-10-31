// Directional effects and Dissolve (31 Oct 2026): word rise, slide in from left / right, slide down, dissolve.
import { describe, expect, it } from "vitest";

import { lyricEffect, lyricScene, previewLyrics, lookPreviewDuration, sceneTimeline } from "../src";
import { dustLetter, SLIDE_PX } from "../src/effects/slides";

describe("slides", () => {
  it("come in from their side and are in place when fully shown", () => {
    const left = lyricEffect("slide-left")!.enter!(0, 1);
    const right = lyricEffect("slide-right")!.enter!(0, 1);
    const down = lyricEffect("slide-down")!.enter!(0, 1);
    expect(left.x).toBe(-SLIDE_PX);
    expect(right.x).toBe(SLIDE_PX);
    expect(down.y).toBeLessThan(0); // from above
    for (const n of ["slide-left", "slide-right", "slide-down"]) {
      const l = lyricEffect(n)!.enter!(1, 1);
      expect([l.opacity, Math.abs(l.x ?? 0), Math.abs(l.y ?? 0)]).toEqual([1, 0, 0]);
    }
  });
  it("word rise: a word is hidden and low before its time, in place on it", () => {
    const e = lyricEffect("word-rise")!;
    const w = { startFrame: 100, endFrame: 110 };
    expect(e.word!(80, w, 1, 30)).toMatchObject({ opacity: 0 });
    expect(e.word!(80, w, 1, 30).y).toBeGreaterThan(40);
    expect(e.word!(100, w, 1, 30)).toMatchObject({ opacity: 1, y: 0 });
  });
});

describe("dissolve", () => {
  it("letters stay whole at rest and drift up, blur and fade into thin air, left to right", () => {
    expect(dustLetter(3, 10, 0)).toEqual({ x: 0, y: 0, blur: 0, opacity: 1 });
    const first = dustLetter(0, 10, 0.4);
    const last = dustLetter(9, 10, 0.4);
    expect(first.opacity).toBeLessThan(last.opacity); // the first letters go first
    expect(first.y).toBeLessThan(0); // upwards
    const gone = dustLetter(9, 10, 1);
    expect(gone.opacity).toBe(0);
    expect(gone.blur).toBeGreaterThan(5);
    expect(dustLetter(4, 10, 0.7)).toEqual(dustLetter(4, 10, 0.7)); // deterministic
    expect(lyricEffect("dissolve")!.exit!(1, 1)).toMatchObject({ opacity: 0, dust: 1 });
  });
});

describe("effects that work on the way out (Dissolve, Spread)", () => {
  it("leave over their whole duration before a pause, and the one-line preview shows them leaving", () => {
    for (const name of ["dissolve", "spread"]) {
      const lyrics = previewLyrics(["You had a heart for two"]);
      const t = sceneTimeline(lyrics.map((l) => ({ ...l })), { fps: 30, durationInFrames: lookPreviewDuration(1), verse: { name, intensity: "balanced" }, hook: { name, intensity: "balanced" }, showNext: false, nextScale: 0.55, gapPx: 22, height: () => 70, wordCount: () => 6 });
      const leaving = Array.from({ length: lookPreviewDuration(1) }, (_, f) => lyricScene(t, f).find((x) => x.role === "leaving")).filter(Boolean);
      expect(leaving.length, name).toBeGreaterThanOrEqual(30); // >= 1 s of leaving (not the 0.4 s gap fade)
      if (name === "dissolve") expect(Math.max(...leaving.map((x) => x!.look.dust ?? 0))).toBeGreaterThan(0.9);
      else expect(Math.max(...leaving.map((x) => x!.look.spacing ?? 0))).toBeGreaterThan(0.2);
    }
  });
});

describe("the Strength slider", () => {
  it('"glide:70" is a strength; 50 % is balanced, 100 % twice that; old names still work', async () => {
    const { parseEffectChoice, choiceText, strengthAmount, intensityStrength, AMOUNT, resolveEffect } = await import("../src");
    expect(parseEffectChoice("glide:70")).toEqual({ name: "glide", intensity: "balanced", strength: 70 });
    expect(choiceText(parseEffectChoice("glide:70"))).toBe("glide:70");
    expect(() => parseEffectChoice("glide:150")).toThrow();
    expect(strengthAmount(50)).toBe(AMOUNT.balanced);
    expect(strengthAmount(100)).toBe(2 * AMOUNT.balanced);
    expect(intensityStrength("balanced")).toBe(50);
    expect(resolveEffect(parseEffectChoice("glide:100"), 30).amount).toBeCloseTo(2.6, 5);
    expect(resolveEffect(parseEffectChoice("glide:expressive"), 30).amount).toBe(AMOUNT.expressive);
  });
});
