import { describe, expect, it } from "vitest";

import { markHookInLrc, normalizeLyric, parseLrc, shiftLrc } from "../src";

describe("normalizeLyric (matching for pins and hooks)", () => {
  it("ignores case, punctuation, extra spaces and the hook marker", () => {
    expect(normalizeLyric("  Love is a GOOD thing!! ")).toBe("love is a good thing");
    expect(normalizeLyric("* Love,  is a good thing")).toBe("love is a good thing");
    expect(normalizeLyric("Don’t stop")).toBe(normalizeLyric("don't stop"));
    expect(normalizeLyric("Été")).not.toBe(normalizeLyric("ete")); // accents matter
  });
});

describe("hooks in LRC", () => {
  const lrc = [
    "[00:10.00]Verse line",
    "[00:14.00]* Hope is a good thing",
    "[00:18.00]Another line",
    "[00:22.00]Hope is a good thing!",
    "[00:26.00]hope is a GOOD thing",
    "[00:30.00]",
  ].join("\n");

  it('reads "* " after the time stamp and marks every repeat of that line', () => {
    const lines = parseLrc(lrc);
    expect(lines.map((l) => [l.text, l.isHook])).toEqual([
      ["Verse line", false],
      ["Hope is a good thing", true],
      ["Another line", false],
      ["Hope is a good thing!", true],
      ["hope is a GOOD thing", true],
    ]);
  });

  it("lrc:hook marks a line and all its repeats, once", () => {
    const plain = lrc.replace("* ", "");
    const { content, matched } = markHookInLrc(plain, "HOPE is a good thing");
    expect(matched).toBe(3);
    expect(content.split("\n").filter((l) => l.includes("]* ")).length).toBe(3);
    expect(markHookInLrc(content, "hope is a good thing").content).toBe(content); // idempotent
    expect(markHookInLrc(plain, "not in the song").matched).toBe(0);
    expect(parseLrc(content).filter((l) => l.isHook)).toHaveLength(3);
  });
});

describe("lrc:shift", () => {
  it("moves every stamp, never below 0, leaving tags and text alone", () => {
    const lrc = "[ar:Life Lyrics]\n[re:tap]\n[00:00.20]First\n[01:02.50]Second\n[00:05.00][00:40.00]Twice\n[01:10.00]\n";
    expect(shiftLrc(lrc, -300)).toBe("[ar:Life Lyrics]\n[re:tap]\n[00:00.00]First\n[01:02.20]Second\n[00:04.70][00:39.70]Twice\n[01:09.70]\n");
    expect(shiftLrc(lrc, 1500)).toContain("[01:04.00]Second");
    expect(shiftLrc(shiftLrc(lrc, 250), -250)).toBe(lrc.replace("[00:00.20]", "[00:00.20]"));
  });
});

describe("enhanced LRC (word tags from pnpm align)", () => {
  const lrc = "[00:14.00]* <00:14.00>Hope <00:14.42>is <00:14.60>a <00:14.71>good <00:15.02>thing\n[00:17.00]\n";

  it("reads the line text without word tags and keeps the word timings", () => {
    const [line] = parseLrc(lrc);
    expect(line.text).toBe("Hope is a good thing");
    expect(line.isHook).toBe(true);
    expect(line.words?.map((w) => [w.text, w.start_ms])).toEqual([
      ["Hope", 14_000],
      ["is", 14_420],
      ["a", 14_600],
      ["good", 14_710],
      ["thing", 15_020],
    ]);
  });

  it("lrc:shift moves the word tags too, and lrc:hook ignores them when matching", () => {
    expect(shiftLrc(lrc, -500)).toBe("[00:13.50]* <00:13.50>Hope <00:13.92>is <00:14.10>a <00:14.21>good <00:14.52>thing\n[00:16.50]\n");
    const plain = lrc.replace("* ", "");
    const { content, matched } = markHookInLrc(plain, "hope is a good thing");
    expect(matched).toBe(1);
    expect(content.startsWith("[00:14.00]* <00:14.00>Hope")).toBe(true);
  });
});
