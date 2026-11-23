// The shot grid (23 Nov 2026): the whole song cut into shot moments on the music; the shot list against it.
import { describe, expect, it } from "vitest";

import { gridText, shotGrid, slotSpans, TAKE, timingNotes, type GridLine } from "../src/shot-grid";
import { nameSections } from "../src/sections";

// 120 BPM: a bar is 2 s. A 14 s intro, lines of 4 s, one long line of 12 s, a 10 s instrumental, a 6 s ending.
const L = (number: number, startMs: number, endMs: number): GridLine => ({ number, text: `Line ${number}`, startMs, endMs });
const lines: GridLine[] = [L(1, 14_000, 17_500), L(2, 18_000, 21_500), L(3, 22_000, 33_000), L(4, 34_000, 37_000), L(5, 47_000, 50_000)];
const duration = 56_000;

describe("shot grid", () => {
  const grid = shotGrid(lines, duration, { bpm: 120, sections: nameSections([{ line: 1, kind: "verse" }, { line: 4, kind: "chorus" }], 5) });

  it("covers the whole song, 0:00 to the end, without gaps", () => {
    expect(grid[0].startMs).toBe(0);
    expect(grid.at(-1)!.endMs).toBe(duration);
    for (let i = 1; i < grid.length; i++) expect(grid[i].startMs).toBe(grid[i - 1].endMs);
    expect(grid.map((g) => g.number)).toEqual(grid.map((_, i) => i + 1));
  });

  it("no shot is longer than one take (8 s) or a flash (2 s); a long moment is split on the bars", () => {
    for (const g of grid) {
      expect(g.endMs - g.startMs).toBeLessThanOrEqual(TAKE.maxMs);
      expect(g.endMs - g.startMs).toBeGreaterThanOrEqual(TAKE.minMs);
    }
    // The 14 s intro: 3 parts (about 5 s), cut on bars (2 s).
    const intro = grid.filter((g) => g.kind === "intro");
    expect(intro.map((g) => [g.startMs, g.endMs])).toEqual([[0, 4000], [4000, 10_000], [10_000, 14_000]]);
    expect(intro.every((g) => g.section === "Intro" && g.line === null)).toBe(true);
    // Line 3 (22-34 s, 12 s): two parts; the first starts on the line, the second follows it (no line).
    const three = grid.filter((g) => g.lines.includes(3));
    expect(three.map((g) => [g.line, g.part, g.parts])).toEqual([[3, 1, 2], [null, 2, 2]]);
  });

  it("names the sections, the instrumental break and the ending", () => {
    expect(grid.find((g) => g.line === 1)?.section).toBe("Verse"); // one verse: no number
    expect(grid.find((g) => g.line === 4)?.section).toBe("Chorus");
    expect(grid.some((g) => g.kind === "break" && g.section === "Instrumental" && g.startMs === 37_000)).toBe(true);
    expect(grid.at(-1)!.kind).toBe("ending");
  });

  it("a line too short for a shot joins the next one (lines a-b)", () => {
    const short = shotGrid([L(1, 0, 900), L(2, 1000, 4500), L(3, 5000, 9000)], 9000);
    expect(short[0].lines).toEqual([1, 2]);
    expect(short[0].line).toBe(1);
  });

  it("the brief's lines: id, time, length, section, line", () => {
    const text = gridText(grid, lines);
    expect(text[0]).toMatch(/^- \*\*s01\*\* · 0:00\.0–0:0\d\.\d · \d\.\d s · Intro \(part 1 of 3\)$/);
    expect(text.find((t) => t.includes(`line 1: "Line 1"`))).toContain("Verse");
    expect(text.find((t) => t.includes("part 2 of 2"))).toContain("no line: follows the shot before");
  });

  it("the song without timed lines: no grid", () => {
    expect(shotGrid([{ number: 1, text: "x", startMs: null, endMs: null }], duration)).toEqual([]);
  });
});

describe("a shot list against the song", () => {
  // One intro shot, a shot per line, a shot without a line after line 3.
  const slots = [
    { id: "s01", line: null },
    { id: "s02", line: 1 },
    { id: "s03", line: 2 },
    { id: "s04", line: 3 },
    { id: "s05", line: null },
    { id: "s06", line: 4 },
    { id: "s07", line: 5 },
  ];

  it("each shot's time: from its line to the next shot on a line; shots without a line share the time before them", () => {
    const spans = slotSpans(slots, lines, duration);
    expect(spans.get("s01")).toEqual({ startMs: 0, endMs: 14_000 });
    expect(spans.get("s04")).toEqual({ startMs: 22_000, endMs: 28_000 });
    expect(spans.get("s05")).toEqual({ startMs: 28_000, endMs: 34_000 });
    expect(spans.get("s07")).toEqual({ startMs: 47_000, endMs: 56_000 });
  });

  it("warns, in plain words, about a shot longer than one take and how to fix it", () => {
    const notes = timingNotes(slots, lines, duration);
    expect(notes.map((n) => n.slot)).toEqual(["s01", "s06", "s07"]);
    expect(notes[0].text).toMatch(/lasts 14\.0 s \(the intro\): one take is about 5 s\. Extend its take to 14\.0 s, or add 2 shots after it/);
    expect(notes[1].text).toContain("line 4");
  });
});
