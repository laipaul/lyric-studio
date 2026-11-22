// "Same look on every platform" (22 Nov 2026): where a theme gives a platform its own look, in plain words.
import { describe, expect, it } from "vitest";

import { differenceLines, platformDifferences, platformsThatDiffer } from "../src/theme-platforms";

const look = { verseFont: "Bitter", hookFont: "Space Mono", verseEffect: "typewriter:15", hookEffect: "karaoke-highlight" };
const labels = { platform: (p: string) => ({ youtube: "YouTube", reels: "Reels" })[p] ?? p, field: (f: string) => ({ verseEffect: "Verse effect", hookFont: "Chorus font" })[f] ?? f, show: (v: unknown) => String(v) };

describe("platformDifferences", () => {
  it("Midnight Highway: YouTube's own verse effect is the one difference", () => {
    const diffs = platformDifferences(look, { youtube: { verseEffect: "cinematic-fade" } });
    expect(diffs).toEqual([{ platform: "youtube", field: "verseEffect", value: "cinematic-fade", base: "typewriter:15" }]);
    expect(platformsThatDiffer(diffs, labels.platform)).toEqual(["YouTube"]);
    expect(differenceLines(diffs, labels)).toEqual(["YouTube: verse effect cinematic-fade (typewriter:15 everywhere else)"]);
  });
  it("a platform value equal to the default look is not a difference; empty means the same everywhere", () => {
    expect(platformDifferences(look, { youtube: { verseEffect: "typewriter:15" }, reels: {} })).toEqual([]);
    expect(platformDifferences(look, {})).toEqual([]);
  });
  it("several fields and platforms: one line per platform, each platform named once", () => {
    const diffs = platformDifferences(look, { youtube: { verseEffect: "glide", hookFont: "Inter" }, reels: { verseEffect: "ink" } });
    expect(platformsThatDiffer(diffs, labels.platform)).toEqual(["YouTube", "Reels"]);
    expect(differenceLines(diffs, labels)).toEqual(["YouTube: verse effect glide (typewriter:15 everywhere else); chorus font Inter (Space Mono everywhere else)", "Reels: verse effect ink (typewriter:15 everywhere else)"]);
  });
});
