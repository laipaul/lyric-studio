import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assessVideo, autoSection, cardBlocks, fitCardBlocks, gridCrop, runQa, type SectionLine, type TextCardProps } from "../src";
import { cardMeasure, checkRecipe, loadFontCatalog, titleCards } from "../src/node";
import type { Textboard } from "../src/textboard";
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
    // Text wraps at its spaces: two words that do not fit on one line make two lines.
    const wrapped = cardBlocks([card({ text: `${"x".repeat(15)} ${"y".repeat(15)}` })], format, measure);
    expect(wrapped[0].box.bottom - wrapped[0].box.top).toBeCloseTo(2 * 80 * 1.2, 5);
    // A single word wider than the frame cannot wrap: its block is wider than the frame (QA names it).
    const wide = cardBlocks([card({ text: "x".repeat(30) })], format, measure);
    expect(wide[0].box.bottom - wide[0].box.top).toBeCloseTo(80 * 1.2, 5);
    expect(wide[0].box.right - wide[0].box.left).toBeGreaterThan(format.width);
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
    expect(a.points[1].action).toContain("shorter title or tagline");
  });
});

// ---------------------------------------------------------------- the layout fits the safe area by itself

describe("title opening: the cards fit the safe area by themselves", () => {
  const catalog = loadFontCatalog(mkdtempSync(path.join(os.tmpdir(), "lyric-title-fit-")));
  const format = { width: 1080, height: 1920 };
  // Instagram Reels (presets/platforms.json): 14% top, 35% bottom, 12% right.
  const safeZone = { top: 0.14, bottom: 0.35, left: 0, right: 0.12 };
  const area = { top: 269, bottom: 1248, centerY: 758 };
  const board = (title: string, tagline = "", titleOverrides: Record<string, unknown> = {}): Textboard => ({
    version: 1,
    roles: {},
    cards: [
      { id: "title", type: "title", text: title, overrides: titleOverrides },
      { id: "byline", type: "byline", text: "Life Lyrics", overrides: {} },
      ...(tagline ? [{ id: "tagline", type: "tagline", text: tagline, overrides: {} }] : []),
    ],
  } as unknown as Textboard);
  const lay = (b: Textboard) =>
    titleCards(b, {
      format, area, fps: 30, durationInFrames: 900, youtube: null,
      titleFont: { family: "Cinzel", weight: 600, letterSpacing: 0.18 }, accent: "#E8A3B5", textScale: 1,
      fontFor: () => null, opening: { untilFrame: 300 }, fit: { safeZone, catalog },
    });
  // QA's own check on those cards: the same blocks and the same safe-zone test.
  const qaOf = (cards: TextCardProps[]) => {
    const blocks = cardBlocks(cards, format, cardMeasure(catalog, cards));
    const base = { props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 900, format, safeZone }, shotClips: [], poolSize: 0, lyrics: [], frames: { black: [], frozen: [] } };
    const qa = runQa({ ...base, titleCards: { blocks, firstLyricFrame: 300, missing: [], grid: gridCrop(format) } } as never);
    return { blocks, qa, safe: qa.checks.find((c) => c.name === "Title cards inside the safe zone")! };
  };

  it("THESE EMPTY ROADS + Life Lyrics + a tagline: inside the safe zone, wrapped and/or shrunk by at most 25%", () => {
    const out = lay(board("These Empty Roads", "A song for the long way home"));
    const title = out.cards.find((c) => c.id === "title")!;
    expect(title.size).toBeGreaterThanOrEqual(Math.round(84 * 0.75));
    expect(title.size < 84 || title.lines?.length === 2).toBe(true);
    if (title.lines) expect(title.lines.join(" ")).toBe("These Empty Roads");
    // The block is limited to the safe area's width, so the composition draws what QA measured.
    expect(title.right).toBeLessThanOrEqual(format.width * (1 - safeZone.right));
    const { safe, blocks } = qaOf(out.cards);
    expect(safe.details).toEqual([]);
    expect(safe.ok).toBe(true);
    expect(blocks).toHaveLength(2); // title + byline, and the tagline
  });

  it("a short title keeps its size and its place (nothing is touched)", () => {
    const plain = lay({ ...board("Home"), cards: board("Home").cards });
    const title = plain.cards.find((c) => c.id === "title")!;
    expect(title.size).toBe(84);
    expect(title.lines).toBeUndefined();
    expect(title.left).toBeUndefined();
    expect(plain.cards.find((c) => c.id === "byline")!.size).toBe(Math.round(84 * 0.45));
    expect(qaOf(plain.cards).safe.ok).toBe(true);
  });

  it("the user's own card size is the starting size and is fitted (shrunk) rather than left outside", () => {
    const out = lay(board("These Empty Roads", "", { size: 1.5 }));
    const title = out.cards.find((c) => c.id === "title")!;
    expect(title.size).toBeLessThan(Math.round(84 * 1.5));
    expect(title.size).toBeGreaterThanOrEqual(Math.round(84 * 1.5 * 0.75));
    expect(qaOf(out.cards).safe.ok).toBe(true);
  });

  it("a block that would reach under the platform's buttons is moved up inside the safe area", () => {
    const low = titleCards(board("Home"), {
      format, area, fps: 30, durationInFrames: 900, youtube: null,
      titleFont: { family: "Cinzel", weight: 600, letterSpacing: 0.18 }, accent: "#fff", textScale: 1,
      fontFor: (style) => (style ? null : null), opening: { untilFrame: 300 }, fit: { safeZone, catalog },
    });
    const moved = fitCardBlocks(low.cards.map((c) => ({ ...c, centerY: undefined, top: 1200 })), { format, safeZone, measure: cardMeasure(catalog, low.cards) });
    const blocks = cardBlocks(moved, format, cardMeasure(catalog, moved));
    expect(blocks[0].box.bottom).toBeLessThanOrEqual(format.height * (1 - safeZone.bottom));
  });

  it("an impossibly long title still fails QA, and the assessment asks for a creative fix", () => {
    const out = lay(board(`The${"Endless".repeat(8)}Road`));
    const { safe, qa } = qaOf(out.cards);
    expect(safe.ok).toBe(false);
    const a = assessVideo({ problems: [{ check: safe.name, details: safe.details }] });
    expect(a.verdict).toBe("not-ready");
    const point = a.points[0];
    expect(point.code).toBe("title-safe");
    expect(point.action).toContain("shorter title or tagline");
    expect(point.action.toLowerCase()).not.toContain("smaller size");
    expect(qa.checks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- a part of the song that starts on a sung line

describe("title opening: the first lyric comes within 2.5 s", () => {
  const catalog = loadFontCatalog(mkdtempSync(path.join(os.tmpdir(), "lyric-title-short-")));
  const format = { width: 1080, height: 1920 };
  const safeZone = { top: 0.14, bottom: 0.35, left: 0, right: 0.12 };
  const area = { top: 269, bottom: 1248, centerY: 758 };
  const board = { version: 1, roles: {}, cards: [
    { id: "title", type: "title", text: "Let My Love Carry You", overrides: {} },
    { id: "byline", type: "byline", text: "Life Lyrics", overrides: {} },
    { id: "tagline", type: "tagline", text: "Let My Love Carry You by Life Lyrics", overrides: {} },
  ] } as unknown as Textboard;
  const lay = (untilFrame: number, lyricBox: { left: number; top: number; right: number; bottom: number } | null) =>
    titleCards(board, {
      format, area, fps: 30, durationInFrames: 900, youtube: null,
      titleFont: { family: "Cinzel", weight: 600, letterSpacing: 0.18 }, accent: "#E8A3B5", textScale: 1,
      fontFor: () => null, opening: { untilFrame, lyricBox }, fit: { safeZone, catalog },
    });
  const end = (o: ReturnType<typeof lay>, id: string) => o.cards.find((c) => c.id === id)!.endFrame;

  it("the first line 0.5 s in, in the middle of the frame: title, byline and tagline stay 2.5 s (clear of the line)", () => {
    const line = { left: 100, right: 900, top: 880, bottom: 1000 }; // between the title block and the tagline
    const out = lay(15, line);
    expect(out.notes).toEqual([]);
    for (const id of ["title", "byline", "tagline"]) expect(end(out, id)).toBeGreaterThanOrEqual(75);
  });

  it("the line sits on the title: it is shown alone for the lead-in and a note names the creative fix", () => {
    const first = lay(300, null).cards.find((c) => c.id === "title")!;
    const onTitle = { left: 0, right: 1080, top: 280, bottom: (first.centerY ?? first.top ?? 500) + 300 }; // from the top of the safe area: no room above
    const out = lay(15, onTitle);
    expect(end(out, "title")).toBe(15);
    expect(out.notes.some((n) => n.startsWith("No room for the title before the first line") && n.includes("2 bars earlier") && n.includes("Automatic"))).toBe(true);
  });

  it("the line sits on the title with room above it: the title moves up above the line and stays 2.5 s, no note", () => {
    const line = { left: 100, right: 980, top: 600, bottom: 900 }; // two lines on the upper third's place
    const before = lay(300, null).cards.find((c) => c.id === "title")!;
    const out = lay(15, line);
    expect(out.notes).toEqual([]);
    for (const id of ["title", "byline"]) expect(end(out, id)).toBeGreaterThanOrEqual(75);
    const blocks = cardBlocks(out.cards, format, cardMeasure(catalog, out.cards));
    const tb = blocks.find((b) => b.ids.includes("title"))!;
    expect(tb.box.bottom).toBeLessThan(line.top);
    expect(tb.box.top).toBeGreaterThanOrEqual(format.height * safeZone.top - 1);
    expect(out.cards.find((c) => c.id === "title")!.top).toBeLessThan((before.centerY ?? 640) - 20);
    expect(end(out, "tagline")).toBeGreaterThanOrEqual(75);
    // QA: the moved block is clear of the first line.
    const qa = runQa({ props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 900 }, shotClips: [], poolSize: 0, frames: { black: [], frozen: [] }, lyrics: [{ number: 1, text: "x", confidence: null, lines: 2, box: line }], titleCards: { blocks, firstLyricFrame: 15, missing: [], grid: null } } as never);
    expect(qa.checks.find((c) => c.name === "Title cards clear of the first lyric")?.ok).toBe(true);
  });

  it("the line sits on the tagline: the tagline moves down below it", () => {
    const line = { left: 100, right: 980, top: 1090, bottom: 1130 };
    const out = lay(15, line);
    expect(out.notes).toEqual([]);
    expect(end(out, "tagline")).toBeGreaterThanOrEqual(75);
    const tag = cardBlocks(out.cards, format, cardMeasure(catalog, out.cards)).find((b) => b.ids.includes("tagline"))!;
    expect(tag.box.top).toBeGreaterThan(line.bottom);
    expect(tag.box.bottom).toBeLessThanOrEqual(format.height * (1 - safeZone.bottom));
  });

  it("a lead-in of 2.5 s or more is unchanged (gone as the line fades in)", () => {
    const out = lay(100, { left: 0, right: 1080, top: 0, bottom: 1920 });
    expect(out.notes).toEqual([]);
    expect(end(out, "title")).toBe(100);
  });

  it("QA: a block clear of the first line may stay past its start", () => {
    const base = { props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 240 }, shotClips: [], poolSize: 0, frames: { black: [], frozen: [] } };
    const blocks = [{ ids: ["title"], text: "T", box: { left: 200, right: 880, top: 300, bottom: 420 }, endFrame: 75 }];
    const lyric = (top: number) => [{ number: 1, text: "x", confidence: null, lines: 1, box: { left: 100, right: 980, top, bottom: top + 100 } }];
    const clear = runQa({ ...base, lyrics: lyric(700), titleCards: { blocks, firstLyricFrame: 15, missing: [], grid: null } } as never);
    expect(clear.checks.find((c) => c.name === "Title cards clear of the first lyric")?.ok).toBe(true);
    const hit = runQa({ ...base, lyrics: lyric(350), titleCards: { blocks, firstLyricFrame: 15, missing: [], grid: null } } as never);
    expect(hit.checks.find((c) => c.name === "Title cards clear of the first lyric")?.ok).toBe(false);
  });
});
