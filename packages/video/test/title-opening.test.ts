import { describe, expect, it } from "vitest";

import { assessVideo, autoSection, cardBlocks, gridCrop, runQa, type SectionLine } from "../src";
import { checkRecipe } from "../src/node";
import { grid } from "./helpers";

// 120 BPM: a bar every 2 s. A hook ("Hold on to me") sung at 40.5 s, the line before it ends at 37.0 s.
const beats = grid(120, 480, 0);
function song(): SectionLine[] {
  return Array.from({ length: 40 }, (_, i) => {
    const text = i === 10 || i === 20 ? "Hold on to me" : `Verse line ${i + 1}`;
    const start = 500 + i * 4000;
    return { text, start_ms: start, end_ms: start + 4000, sung_end_ms: start + 500, isHook: text === "Hold on to me" };
  });
}

describe("title opening: room before the hook", () => {
  it("starts up to 2 bars before the hook line (one bar without the title opening)", () => {
    const plain = autoSection(song(), beats, { durationMs: 200_000, anchorMode: "hook-first" });
    const titled = autoSection(song(), beats, { durationMs: 200_000, anchorMode: "hook-first", titleLead: true });
    expect(plain.start_ms).toBe(40_000);
    expect(titled.start_ms).toBe(38_000);
  });

  it("keeps one bar when two bars would be longer than 5 s (slow songs)", () => {
    const slow = grid(60, 240, 0); // a bar every 4 s
    const ls = song();
    const s = autoSection(ls, slow, { durationMs: 200_000, anchorMode: "hook-first", titleLead: true });
    expect(40_500 - s.start_ms).toBeLessThanOrEqual(4_500);
  });
});

describe("title opening: geometry and QA", () => {
  const format = { width: 1080, height: 1920 };
  const card = (over: Partial<Parameters<typeof cardBlocks>[0][number]>) => ({
    id: "title",
    type: "title" as const,
    text: "Love Is A Good Thing",
    size: 80,
    stackOn: undefined as string | undefined,
    top: undefined as number | undefined,
    centerY: 640,
    letterSpacing: 0.1,
    upper: true,
    startFrame: 0,
    endFrame: 90,
    ...over,
  });
  const measure = (c: { text: string; size: number }) => c.text.length * c.size * 0.6;

  it("stacks the byline under the title and wraps wide text", () => {
    const blocks = cardBlocks([card({}), card({ id: "byline", type: "byline", text: "Life Lyrics", size: 36, stackOn: "title", centerY: undefined })], format, measure);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].ids).toEqual(["title", "byline"]);
    // Title wraps (20 chars x 48 px = 960 px fits: one line) + byline one line + gap.
    expect(blocks[0].box.bottom - blocks[0].box.top).toBeCloseTo(80 * 1.2 + 36 * 1.2 + 20, 5);
    const wide = cardBlocks([card({ text: "x".repeat(30) })], format, measure);
    expect(wide[0].box.bottom - wide[0].box.top).toBeCloseTo(2 * 80 * 1.2, 5);
  });

  it("the profile grid shows the centred 3:4 area", () => {
    expect(gridCrop(format)).toEqual({ top: 240, bottom: 1680 });
  });

  it("QA: overlap with the first lyric, the grid and missing characters", () => {
    const box = { left: 100, top: 180, right: 980, bottom: 300 };
    const base = { props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 240 }, shotClips: [], poolSize: 0, lyrics: [], frames: { black: [], frozen: [] } };
    const qa = runQa({ ...base, titleCards: { blocks: [{ ids: ["title"], text: "Title", box, endFrame: 120 }], firstLyricFrame: 100, missing: ["語"], grid: gridCrop(format) } } as never);
    const by = (n: string) => qa.checks.find((c) => c.name === n);
    expect(by("Title cards inside the profile grid (3:4)")?.ok).toBe(false);
    expect(by("Title cards clear of the first lyric")?.ok).toBe(false);
    expect(by("Title characters")?.ok).toBe(false);
    expect(by("Title cards inside the safe zone")?.ok).toBe(false);
    const fine = runQa({ ...base, titleCards: { blocks: [{ ids: ["title"], text: "Title", box: { left: 200, right: 880, top: 400, bottom: 520 }, endFrame: 90 }], firstLyricFrame: 100, missing: [], grid: gridCrop(format) } } as never);
    expect(fine.checks.filter((c) => c.name.startsWith("Title") && !c.ok)).toEqual([]);
  });
});

describe("title opening: recipe and assessment", () => {
  it("titleOpening (on / off, per platform) and tagline are checked", () => {
    expect(checkRecipe({ titleOpening: "on", tagline: "A song for the road", perPlatform: { tiktok: { titleOpening: "off" } } }).problems).toEqual([]);
    const bad = checkRecipe({ titleOpening: "yes", tagline: 5 } as never).problems;
    expect(bad.some((p) => p.startsWith("titleOpening"))).toBe(true);
    expect(bad.some((p) => p.startsWith("tagline"))).toBe(true);
  });
  it("title-card warnings become plain points with a creative action", () => {
    const a = assessVideo({ problems: [{ check: "Title characters", details: ["no font draws 語 (they would show as boxes)"] }, { check: "Title cards inside the profile grid (3:4)", details: ['"Title" reaches above the 3:4 area'] }] });
    expect(a.verdict).toBe("not-ready");
    expect(a.points[0]).toMatchObject({ code: "title-glyphs", major: true });
    expect(a.points[0].text).toContain("語");
    expect(a.points[1]).toMatchObject({ code: "title-grid", major: false });
    expect(a.points[1].action).toContain("card editor");
  });
});
