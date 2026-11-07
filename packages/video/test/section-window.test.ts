// The Shape page's soundtrack window: the video as a window on the whole song.
import { describe, expect, it } from "vitest";

import { cleanEnds, linesCut, sectionText, snapWindow } from "../src";

// A bar every 2 s from 0.5 s; lines sung 10.2-13.4, 14.5-17.0 (the next starts at 18.6), 18.6-21.9.
const downbeats = Array.from({ length: 60 }, (_, i) => 500 + i * 2000);
const lines = [
  { number: 1, startMs: 10_200, sungEndMs: 13_400 },
  { number: 2, startMs: 14_500, sungEndMs: 17_000 },
  { number: 3, startMs: 18_600, sungEndMs: 21_900 },
];
const ends = cleanEnds(lines, downbeats);
const music = { durationMs: 120_000, downbeats, cleanEnds: ends };

describe("soundtrack window", () => {
  it("clean ends: the first bar after a line is sung, before the next one starts", () => {
    expect(ends).toEqual([14_500, 18_500, 22_500]);
  });
  it("the start snaps to a bar, the end to a clean end within reach (else a bar); Alt: exactly there", () => {
    expect(snapWindow({ startMs: 9_100, endMs: 18_000 }, music)).toEqual({ startMs: 8_500, endMs: 18_500, clean: true });
    expect(snapWindow({ startMs: 9_100, endMs: 40_000 }, music)).toEqual({ startMs: 8_500, endMs: 40_500, clean: false });
    expect(snapWindow({ startMs: 9_100, endMs: 18_000 }, music, true)).toEqual({ startMs: 9_100, endMs: 18_000, clean: false });
  });
  it("never shorter than 3 s, never past the song", () => {
    expect(snapWindow({ startMs: 10_400, endMs: 10_900 }, music, true)).toEqual({ startMs: 10_400, endMs: 13_400, clean: false });
    expect(snapWindow({ startMs: 100_000, endMs: 130_000 }, music, true).endMs).toBe(120_000);
  });
  it("as song.json and Make read it; the lines a window cuts", () => {
    expect(sectionText(36_100, 80_000)).toBe("0:36.10-1:20.00");
    expect(linesCut(lines, 12_000, 18_500)).toEqual([1]);
    expect(linesCut(lines, 8_500, 18_500)).toEqual([]);
  });
});
