import { describe, expect, it } from "vitest";

import { luminance, paletteFromPixels, suggestThemeColours } from "./cover-palette";

// A picture as RGBA pixels: `n` pixels of each colour.
const picture = (...parts: [number, number, number, number][]) => parts.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat());

describe("cover palette", () => {
  it("finds the main colours, the biggest first, without near-black, near-white or near-duplicates", () => {
    const px = picture([200, 40, 90, 300], [30, 60, 140, 200], [240, 200, 120, 100], [5, 5, 5, 500], [250, 250, 250, 400], [202, 42, 92, 50]);
    const p = paletteFromPixels(px);
    expect(p.length).toBe(3);
    expect(p[0]).toMatch(/^#C[89A-F]/); // the pink
    expect(p.some((c) => c === "#050505" || c === "#FAFAFA")).toBe(false);
  });
  it("gives at most five colours", () => {
    const px = picture([200, 0, 0, 10], [0, 200, 0, 10], [0, 0, 200, 10], [200, 200, 0, 10], [0, 200, 200, 10], [200, 0, 200, 10], [120, 60, 30, 10]);
    expect(paletteFromPixels(px).length).toBe(5);
  });
  it("suggests a readable lyric colour and a lively accent", () => {
    const s = suggestThemeColours(["#1E3C8C", "#C8285A", "#F0C878"])!;
    expect(luminance(s.textColour)).toBeGreaterThanOrEqual(0.75);
    expect(s.accentColour).toBe("#C8285A");
    expect(suggestThemeColours([])).toBeNull();
  });
  it("lifts a too dark accent so it shows on a dark picture", () => {
    const s = suggestThemeColours(["#20102A", "#301040"])!;
    expect(luminance(s.accentColour)).toBeGreaterThan(0.1);
  });
});
