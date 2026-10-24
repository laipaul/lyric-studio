import { describe, expect, it } from "vitest";

import { activeLyricLine, applyTextCase, formatLrcTime, layoutLyric, parseLrc } from "../src";
import { layoutForStyle, tooLongLines } from "../src/node";

// Fake font: every character is 0.5 em wide (so 20 px at size 40).
const measure = (text: string, size: number) => text.length * size * 0.5;
const widths = (lines: string[], size: number) => lines.map((l) => measure(l, size));

describe("layoutLyric", () => {
  it("keeps a short line on one line at full size", () => {
    expect(layoutLyric("Short line", 40, 400, measure)).toEqual({ lines: ["Short line"], fontSize: 40, tooLong: false });
  });

  it("wraps onto two balanced lines before shrinking", () => {
    const layout = layoutLyric("one two three four five six seven", 40, 400, measure); // 33 chars = 660 px
    expect(layout.lines).toHaveLength(2);
    expect(layout.fontSize).toBe(40);
    const [a, b] = widths(layout.lines, 40);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(6 * 20); // balanced: no split is better
    expect(Math.max(a, b)).toBeLessThanOrEqual(400);
  });

  it("shrinks by at most 25% to keep two lines", () => {
    const layout = layoutLyric("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii", 40, 400, measure); // best split 19 + 24 chars = 480 px
    expect(layout.lines).toHaveLength(2);
    expect(layout.fontSize).toBeLessThan(40);
    expect(layout.fontSize).toBeGreaterThanOrEqual(30);
    expect(layout.tooLong).toBe(false);
    for (const w of widths(layout.lines, layout.fontSize)) expect(w).toBeLessThanOrEqual(400);
  });

  it("uses three lines only as a last resort, and flags it", () => {
    const layout = layoutLyric("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll", 40, 400, measure);
    expect(layout.lines).toHaveLength(3);
    expect(layout.tooLong).toBe(true);
    expect(layout.fontSize).toBeLessThanOrEqual(30);
    for (const w of widths(layout.lines, layout.fontSize)) expect(w).toBeLessThanOrEqual(400.5);
  });

  it("never produces more than 3 lines, however long the text", () => {
    for (const words of [10, 30, 100, 400]) {
      const text = Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
      const layout = layoutLyric(text, 64, 854, measure);
      expect(layout.lines.length).toBeLessThanOrEqual(3);
      expect(layout.lines.join(" ")).toBe(text); // nothing lost
      for (const w of widths(layout.lines, layout.fontSize)) expect(w).toBeLessThanOrEqual(854.5);
    }
  });

  it("shrinks a single very long word to fit", () => {
    const layout = layoutLyric("Supercalifragilisticexpialidocious", 40, 400, measure);
    expect(layout.lines).toEqual(["Supercalifragilisticexpialidocious"]);
    expect(measure(layout.lines[0], layout.fontSize)).toBeLessThanOrEqual(400.5);
    expect(layout.tooLong).toBe(true);
  });
});

describe("with the real fonts", () => {
  const simple = { name: "Simple", font: "Inter", weight: 600, textCase: "none", effect: "none", animation: "fade" } as const;
  const bold = { name: "Bold", font: "Montserrat", weight: 900, textCase: "upper", effect: "shadow", animation: "pop" } as const;

  it("a deliberately long line wraps to 2 balanced lines and shrinks (Simple)", () => {
    const layout = layoutForStyle("Every single night I keep on dreaming of the summer days", simple, 64);
    expect(layout.lines).toEqual(["Every single night I keep on", "dreaming of the summer days"]);
    expect(layout.fontSize).toBeLessThan(64);
    expect(layout.fontSize).toBeGreaterThanOrEqual(48);
    expect(layout.tooLong).toBe(false);
  });

  it("flags lines that need 3 lines", () => {
    const texts = ["Short line", "Every single night I keep on dreaming of the summer days we lost together"];
    expect(tooLongLines(texts, simple, 64).map((l) => l.text)).toEqual([texts[1]]);
    expect(tooLongLines(["DANCING IN THE MOONLIGHT WITH YOU"], bold, 84)).toEqual([]);
  });
});

describe("lyric timing", () => {
  const lines = [
    { text: "a", startFrame: 10, endFrame: 20 },
    { text: "b", startFrame: 20, endFrame: 35 },
  ];
  it("shows each line exactly from startFrame to endFrame - 1", () => {
    expect(activeLyricLine(lines, 9)).toBeNull();
    expect(activeLyricLine(lines, 10)?.text).toBe("a");
    expect(activeLyricLine(lines, 19)?.text).toBe("a");
    expect(activeLyricLine(lines, 20)?.text).toBe("b");
    expect(activeLyricLine(lines, 34)?.text).toBe("b");
    expect(activeLyricLine(lines, 35)).toBeNull();
  });

  it("parses LRC: lines end at the next stamp, an empty stamp is a pause/end", () => {
    const lrc = "[ar:Life Lyrics]\n[00:01.00]One\n[00:03.50]Two\n[00:06.00]\n[00:08.25]Three\n[00:10.00]\n";
    expect(parseLrc(lrc)).toEqual([
      { text: "One", start_ms: 1000, end_ms: 3500 },
      { text: "Two", start_ms: 3500, end_ms: 6000 },
      { text: "Three", start_ms: 8250, end_ms: 10000 },
    ]);
    expect(parseLrc("[00:01.00]Only\n", 5000)).toEqual([{ text: "Only", start_ms: 1000, end_ms: 5000 }]);
    expect(formatLrcTime(83_456)).toBe("[01:23.46]");
  });

  it("applies the text case", () => {
    expect(applyTextCase("hello world", "upper")).toBe("HELLO WORLD");
    expect(applyTextCase("hello world", "title")).toBe("Hello World");
  });
});
