// The Textboard (the song's text layer): cards from the song, per-card overrides, sync after lyrics
// changes (never silently dropped), round-trip through textboard.json, templates without the words
// applied to a song with another number of lines, and each card's look in the props.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyTemplate, checkTextboard, defaultCards, previewCard, setCardOverrides, syncBoard, textCardLook, toTemplate, withCard,
  type LyricLineProps, type SongText, type Textboard,
} from "../src";
import { lyricsLines, readTextboard, writeTextboard } from "../src/node";

const song: SongText = {
  title: "A Heart For Two", artist: "Life Lyrics", ep: "Home",
  lines: lyricsLines("Verse one here\n\n* Hold on to me\nThrough the night\nHold on to me\n"),
};

describe("cards", () => {
  it("title, byline, tagline and every lyric line (numbered as the Lyrics tab, hooks by marker and by words)", () => {
    const cards = defaultCards(song);
    expect(cards.map((c) => [c.id, c.type, c.text, c.isHook ?? false])).toEqual([
      ["title", "title", "A Heart For Two", false],
      ["byline", "byline", "Life Lyrics", false],
      ["tagline", "tagline", "", false], // the song's own tagline (song.json), never the EP
      ["line-1", "lyric", "Verse one here", false],
      ["line-2", "lyric", "Hold on to me", true],
      ["line-3", "lyric", "Through the night", false],
      ["line-4", "lyric", "Hold on to me", true],
    ]);
  });

  it("round-trip: textboard.json keeps the order, the overrides and the roles; bad values are refused", () => {
    let board: Textboard = { template: null, roles: { hook: { size: 1.2 } }, cards: defaultCards(song) };
    board = setCardOverrides(board, "line-3", { position: "upper", size: 1.4, hold: 2, effect: "soft-blur:subtle" });
    board = setCardOverrides(board, "title", { text: "A Heart for Two (acoustic)", show: true, position: "centre" });
    const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-textboard-"));
    writeTextboard(dir, board);
    expect(readTextboard(dir)).toEqual(board);
    const file = JSON.parse(readFileSync(path.join(dir, "textboard.json"), "utf8"));
    expect(file.cards.filter((c: { overrides?: unknown }) => c.overrides).map((c: { id: string }) => c.id)).toEqual(["title", "line-3"]); // only what differs
    rmSync(dir, { recursive: true, force: true });
    expect(() => setCardOverrides(board, "line-3", { size: 5 })).toThrow(/size must be 0.5-2/);
    expect(() => setCardOverrides(board, "line-3", { effect: "spin" })).toThrow(/unknown effect "spin"/);
    expect(checkTextboard({ cards: [{ type: "lyric", line: 0 }], roles: { chorus: {} } }).problems).toEqual(["roles.chorus: unknown role (known: title, byline, tagline, verse, hook)", "cards[0].line must be the line's number (1, 2, ...)"]);
  });

  it("after a lyrics change a card keeps its look when its words stay (also on a new number); lost words are listed", () => {
    let board: Textboard = { template: null, roles: {}, cards: defaultCards(song) };
    board = setCardOverrides(board, "line-3", { size: 1.5 });
    board = setCardOverrides(board, "line-1", { position: "lower" });
    const changed: SongText = { ...song, lines: lyricsLines("New first line\nVerse two here\n* Hold on to me\nThrough the night\nHold on to me\n") };
    const { board: synced, orphans } = syncBoard(board, changed);
    expect(synced.cards.find((c) => c.text === "Through the night")).toMatchObject({ id: "line-4", line: 4, overrides: { size: 1.5 } });
    expect(orphans.map((o) => [o.id, o.text])).toEqual([["line-1", "Verse one here"]]);
  });
});

describe("templates", () => {
  it("the design without the words; applied to a song with another number of lines it uses that song's text", () => {
    let board: Textboard = { template: null, roles: { hook: { size: 1.25, effect: "dreamy-glow" }, title: { hold: 5 } }, cards: defaultCards(song) };
    board = setCardOverrides(board, "title", { text: "Not to be copied", position: "centre", size: 1.3, show: true });
    board = setCardOverrides(board, "line-2", { size: 2 });
    const { template, left } = toTemplate(board, "Cinematic", "Life Lyrics", new Date("2026-10-28T10:00:00Z"));
    expect(left).toBe(1); // the change on line 2 belongs to these words
    expect(JSON.stringify(template)).not.toContain("Not to be copied");
    expect(JSON.stringify(template)).not.toContain("Hold on to me");
    expect(template).toMatchObject({ name: "Cinematic", artist: "Life Lyrics", roles: { hook: { size: 1.25, effect: "dreamy-glow" } }, opening: { title: { position: "centre", size: 1.3, show: true } } });

    const other: SongText = { title: "Love Is A Good Thing", artist: "Life Lyrics", ep: null, lines: lyricsLines("One\nTwo\n* Love is a good thing\nThree\nFour\nLove is a good thing\nFive\n") };
    const applied = applyTemplate(template, other, null);
    expect(applied.template).toBe("Cinematic");
    expect(applied.cards.filter((c) => c.type === "lyric")).toHaveLength(7);
    expect(applied.cards.find((c) => c.id === "title")).toMatchObject({ text: "Love Is A Good Thing", overrides: { position: "centre", size: 1.3, show: true } });
    expect(applied.cards.find((c) => c.id === "tagline")?.text).toBe(""); // no EP
    expect(applied.cards.filter((c) => c.isHook).map((c) => c.line)).toEqual([3, 6]);
    expect(applied.cards.filter((c) => c.type === "lyric").every((c) => !Object.keys(c.overrides).length)).toBe(true);
    // A song's own title text stays when a template is applied again.
    const own = setCardOverrides(applied, "title", { text: "LOVE" });
    expect(applyTemplate(template, other, own).cards.find((c) => c.id === "title")?.overrides.text).toBe("LOVE");
  });
});

describe("a card's look in the props", () => {
  const line: LyricLineProps = { text: "Through the night", startFrame: 100, endFrame: 160, stampFrame: 108, sungEndFrame: 140 };
  const area = { top: 192, bottom: 1536, centerY: 797 };

  it("position inside the lyric area, size, effect, hold (never into the next line); the preview changes it again", () => {
    const c = withCard(line, { id: "line-3", style: { position: "upper", size: 1.4, hold: 3, effect: "soft-blur:subtle" } }, { area, nextStartFrame: 200, durationInFrames: 900 });
    expect(c.card).toEqual({ id: "line-3", effect: { name: "soft-blur", intensity: "subtle" }, scale: 1.4, centerY: 595, position: "upper", baseEndFrame: 160 });
    expect(c.endFrame).toBe(200); // 140 + 90 frames, stopped at the next line
    expect(withCard(line, { id: "x", style: {} }, { area, nextStartFrame: 200, durationInFrames: 900 })).toEqual({ ...line, card: { id: "x" } });
    const [p] = previewCard([c], "line-3", { hold: 1 }, { area, durationInFrames: 900 });
    expect([p.endFrame, p.card]).toEqual([170, { id: "line-3", baseEndFrame: 160 }]);
    const [back] = previewCard([p], "line-3", {}, { area, durationInFrames: 900 });
    expect(back.endFrame).toBe(160);
  });

  it("title cards: without an effect they fade out over their last second (as the YouTube title did); with one they come in", () => {
    expect(textCardLook({ startFrame: 0, endFrame: 120, effect: null }, 0, 30)?.opacity).toBe(1);
    expect(textCardLook({ startFrame: 0, endFrame: 120, effect: null }, 105, 30)?.opacity).toBeCloseTo(0.5);
    expect(textCardLook({ startFrame: 0, endFrame: 120, effect: null }, 120, 30)).toBeNull();
    const fade = { startFrame: 30, endFrame: 150, effect: { name: "cinematic-fade", intensity: "balanced" as const } };
    expect(textCardLook(fade, 29, 30)).toBeNull();
    expect(textCardLook(fade, 31, 30)!.opacity).toBeLessThan(0.3);
    expect(textCardLook(fade, 90, 30)!.opacity).toBeCloseTo(1);
  });
});
