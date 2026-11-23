import { describe, expect, it } from "vitest";

import { autoSection, finishedBeforeStart, mostRepeatedBlock, sungEnd, type SectionLine } from "../src";
import { grid } from "./helpers";

// 120 BPM: a beat every 500 ms, a bar (downbeat) every 2 s at 0, 2, 4, ... s; 4 minutes.
const beats = grid(120, 480, 0);
const durationMs = 240_000;
const isDownbeat = (ms: number) => beats.some((b) => b.is_downbeat && b.time_ms === ms);

// A line every 4 s from `firstMs`, each sung for `sungMs`.
function lines(texts: string[], firstMs: number, sungMs = 3000, hooks: string[] = []): SectionLine[] {
  return texts.map((text, i) => ({
    text,
    start_ms: firstMs + i * 4000,
    end_ms: firstMs + (i + 1) * 4000,
    sung_end_ms: firstMs + i * 4000 + sungMs,
    isHook: hooks.includes(text),
  }));
}

// Verse lines with a chorus whose first line (only) is the hook, at lines 11 and 21.
function songWithHooks(sungMs = 3000): SectionLine[] {
  const texts = Array.from({ length: 60 }, (_, k) => `Verse line ${k + 1}`);
  for (const k of [10, 20, 40]) {
    texts[k] = "Hold on to me";
    texts[k + 1] = "Through the night";
  }
  return lines(texts, 500, sungMs, ["Hold on to me"]);
}

const singingAt = (ls: SectionLine[], t: number, leadMs = 250) => ls.filter((l) => l.start_ms - leadMs < t && t < sungEnd(l));

describe("auto section", () => {
  it("starts one bar before the first hook line (a single marked line per chorus is enough)", () => {
    const ls = songWithHooks(1200); // the line before the hook is sung 36.5-37.7 s, before the lead-in bar
    const s = autoSection(ls, beats, { durationMs });
    expect(s.anchor).toEqual({ kind: "hook", line: 11 });
    // The hook is sung at 40.5 s, in the bar starting at 40 s: one bar before that is 38 s.
    expect(s.start_ms).toBe(38_000);
    expect(s.reason).toContain('one bar before the first hook line (line 11, "Hold on to me")');
    expect(s.warnings).toEqual([]);
  });

  it("never starts mid-line: if the pre-chorus is still sung in the lead-in bar, starts before it", () => {
    const ls = songWithHooks(3000); // line 10 is sung 36.5-39.5 s, through the bar at 38 s
    const s = autoSection(ls, beats, { durationMs });
    expect(s.start_ms).toBe(36_000); // the bar before line 10 appears (36.25 s)
    expect(singingAt(ls, s.start_ms)).toEqual([]);
    expect(s.reason).toContain('moved back to the bar before line 10 "Verse line 10" so it is not cut');
    expect(s.warnings).toEqual([]);
  });

  it("continuous singing: keeps the 1-bar lead-in and warns which line it cuts", () => {
    const ls = Array.from({ length: 30 }, (_, k) => ({
      text: k === 10 ? "Hold on to me" : `Line ${k + 1}`,
      start_ms: 4000 * k - 300,
      end_ms: 4000 * k + 3700,
      sung_end_ms: 4000 * k + 3600,
      isHook: k === 10,
    }));
    const s = autoSection(ls, beats, { durationMs });
    expect(s.start_ms).toBe(38_000);
    expect(s.warnings[0]).toBe('The section start (0:38.0) cuts line 10 "Line 10" while it is sung; choose a section with --section.');
  });

  it("the lead-in bar also works when the hook starts just before the bar (pickup)", () => {
    const ls = songWithHooks(1200).map((l) => ({ ...l, start_ms: l.start_ms - 800, sung_end_ms: l.sung_end_ms! - 800 }));
    const s = autoSection(ls, beats, { durationMs });
    const hook = ls[10];
    expect(hook.start_ms).toBe(39_700);
    expect(isDownbeat(s.start_ms)).toBe(true);
    expect(s.start_ms).toBe(38_000); // about one bar before; the hook is not on screen before the start
    expect(s.start_ms).toBeLessThanOrEqual(hook.start_ms - 250);
  });

  it("ends 45-60 s later on the first bar after a chorus line finishes, never mid-line", () => {
    const ls = songWithHooks();
    const s = autoSection(ls, beats, { durationMs });
    const length = s.end_ms - s.start_ms;
    expect(length).toBeGreaterThanOrEqual(45_000);
    expect(length).toBeLessThanOrEqual(60_000);
    expect(isDownbeat(s.end_ms)).toBe(true);
    expect(singingAt(ls, s.end_ms)).toEqual([]);
    // Chorus 2 (lines 21-22) is sung to 87.5 s: the first bar after its LAST line is 88 s (never
    // between the chorus lines, 1 Nov 2026).
    expect(s.endKind).toBe("chorus-line");
    expect(s.start_ms).toBe(36_000); // see "never starts mid-line"
    expect(s.end_ms).toBe(88_000);
    expect(s.reason).toContain('the first bar after chorus line 22 "Through the night" finishes');
    expect(s.reason).toContain("52.0 s");
  });

  it("prefers a chorus line end, else the latest line end inside the window", () => {
    // Only one chorus: no chorus line ends 45-60 s after the start.
    const texts = Array.from({ length: 60 }, (_, k) => (k === 10 ? "Hold on to me" : `Verse line ${k + 1}`));
    const ls = lines(texts, 500, 3000, ["Hold on to me"]);
    const s = autoSection(ls, beats, { durationMs });
    expect(s.endKind).toBe("line");
    expect(s.end_ms - s.start_ms).toBe(60_000); // start 36 s; free bars after lines at 84, 88, 92, 96 s
    expect(singingAt(ls, s.end_ms)).toEqual([]);
  });

  it("goes up to 65 s rather than cutting a line", () => {
    // Lines start just before each bar (pickup), so no bar start is free until a gap at 80-82 s.
    const texts = Array.from({ length: 60 }, (_, k) => (k === 5 ? "Hold on to me" : `Line ${k + 1}`));
    const ls = texts.map((text, k) => {
      const start = k < 20 ? 4000 * k - 300 : 4000 * k + 3200; // gap between line 20 (ends 79.6 s) and 21 (83.2 s)
      return { text, start_ms: start, end_ms: start + 3900, sung_end_ms: start + 3900, isHook: k === 5 };
    });
    const s = autoSection(ls, beats, { durationMs });
    expect(s.start_ms).toBe(18_000); // hook at 19.7 s
    expect(s.endKind).toBe("extended");
    expect(s.end_ms).toBe(80_000);
    expect(s.end_ms - s.start_ms).toBe(62_000);
    expect(singingAt(ls, s.end_ms)).toEqual([]);
    expect(s.reason).toContain("no bar within 45.0 s-60.0 s without cutting a line; extended");
    expect(s.warnings).toEqual(['The section start (0:18.0) cuts line 5 "Line 5" while it is sung; choose a section with --section.']);
  });

  it("if even 65 s is not enough, ends near 60 s and warns which line is cut", () => {
    const ls = Array.from({ length: 60 }, (_, k) => ({
      text: k === 5 ? "Hold on to me" : `Line ${k + 1}`,
      start_ms: 4000 * k - 300,
      end_ms: 4000 * k + 3700,
      sung_end_ms: 4000 * k + 3600,
      isHook: k === 5,
    }));
    const s = autoSection(ls, beats, { durationMs });
    expect(s.endKind).toBe("cuts-line");
    expect(s.end_ms - s.start_ms).toBe(60_000);
    expect(s.warnings.find((w) => w.startsWith("The section end"))).toMatch(/^The section end \(1:18\.0\) cuts line 20 "Line 20"/);
  });

  it("without hooks, starts at the first occurrence of the most repeated block of lines", () => {
    const verse = (n: number) => [`Verse ${n} a`, `Verse ${n} b`, `Verse ${n} c`, `Verse ${n} d`];
    const chorus = ["We run", "We fall", "We rise again", "Into the light"];
    const ls = lines([...verse(1), ...chorus, ...verse(2), ...chorus, "Bridge", ...chorus, ...verse(3)], 500);
    const s = autoSection(ls, beats, { durationMs });
    expect(s.anchor).toEqual({ kind: "repeat", line: 5 });
    expect(s.start_ms).toBe(12_000); // line 5 at 16.5 s; line 4 is sung 12.5-15.5 s, so the bar before it
    expect(s.reason).toContain("no hook lines; first of the most repeated block: 4 lines, 3 times");
    expect(s.endKind).toBe("chorus-line"); // a chorus-block line ends inside the window
    expect(singingAt(ls, s.end_ms)).toEqual([]);
  });

  it("finds the most repeated block (length x occurrences, earliest first)", () => {
    expect(mostRepeatedBlock(["a", "b", "c", "a", "b", "c", "d", "a", "b", "c"])).toEqual({ starts: [0, 3, 7], length: 3 });
    expect(mostRepeatedBlock(["A!", "x", "a", "y"])).toEqual({ starts: [0, 2], length: 1 }); // punctuation/case ignored
    expect(mostRepeatedBlock(["a", "b", "c"])).toBeNull();
  });

  it("no hooks and no repeats: starts one bar before the first line", () => {
    const ls = lines(Array.from({ length: 40 }, (_, k) => `Line ${k + 1}`), 10_500);
    const s = autoSection(ls, beats, { durationMs });
    expect(s.anchor.kind).toBe("first-line");
    expect(s.start_ms).toBe(8_000);
  });

  it("a song ending less than 45 s after the start ends with the song", () => {
    const ls = songWithHooks().slice(0, 15);
    const s = autoSection(ls, beats, { durationMs: 70_000 });
    expect(s.endKind).toBe("song-end");
    expect([s.start_ms, s.end_ms]).toEqual([36_000, 70_000]);
  });

  it("sung end: the aligner's end, else last word start + a typical word, else the end stamp", () => {
    const base = { text: "a b c", start_ms: 1000, end_ms: 5000, isHook: false };
    expect(sungEnd({ ...base, sung_end_ms: 3200 })).toBe(3200);
    const words = [{ text: "a", start_ms: 1000 }, { text: "b", start_ms: 1400 }, { text: "c", start_ms: 1800 }];
    expect(sungEnd({ ...base, words })).toBe(2200);
    expect(sungEnd(base)).toBe(5000);
  });

  it("a finished line still on screen at the start is not shown; a line still being sung is", () => {
    // Line 1 is sung 10.0-11.2 s but stays on screen until line 2 (14 s, minus the 0.25 s lead).
    const ls = lines(["First", "Second", "Third"], 10_000, 1200);
    expect(finishedBeforeStart(ls, 12_000, 250)).toEqual([0]); // 12 s: line 1 is only lingering
    expect(finishedBeforeStart(ls, 11_000, 250)).toEqual([]); // 11 s: line 1 is still being sung
    expect(finishedBeforeStart(ls, 9_800, 250)).toEqual([]); // line 1 appears at 9.75 s: within 0.1 s, shown
    expect(finishedBeforeStart(ls, 12_000, 250, 2500)).toEqual([]); // offset +2.5 s: line 1 appears at 12.25 s, after the start
  });

  it("finishes the phrase: never after a comma line or between chorus lines, longer rather than cut (Here With Me, 1 Nov 2026)", () => {
    const texts = [
      "The rain still whispers on the glass,", "I watch the hours slowly pass.", "Your voice still lives inside the air,", "I close my eyes — you’re almost there.",
      "The city hums, the lights still glow,", "But in my heart, you never go.", "You walk beside each breath I take,", "A love the silence couldn’t break.",
      "You’re here with me — in every sound,", "In dreams that lift me off the ground.", "I feel your warmth, though I can’t see,", "You’re gone, but still — you’re here with me.",
      "Your sweater’s hanging by the door,", "I can’t let go, not anymore.", "The world has changed, the stars have too,", "But every one still points to you.",
      "You’re here with me — in every sound,", "In dreams that lift me off the ground.", "I feel your warmth, though I can’t see,", "You’re gone, but still — you’re here with me.",
      "Maybe love was never meant to fade,", "Just carried softly through the shade.", "If hearts can meet beyond what’s real,", "Then I still know the way you feel.",
    ];
    const ls = lines(texts, 500, 3000, ["You’re here with me — in every sound,"]); // only the hook line is marked
    const target = 44_000;
    const s = autoSection(ls, beats, { durationMs, targetMs: target, minMs: target * 0.95, maxMs: target * 1.05, shortestMs: target * 0.75, hardMaxMs: target * 1.3, anchorMode: "hook-first" });
    expect(s.start_ms).toBe(32_000);
    // Line 19 ("…can’t see,") ends inside the window (76 s) but the sentence and the chorus go on: the
    // end waits for line 20, the chorus's last line (sung to 79.5 s), on the next bar.
    expect(s.end_ms).toBe(80_000);
    expect(s.endKind).toBe("extended");
    expect(s.reason).toContain('line 20 "You’re gone, but still — you’re here with me."');
  });

  it("a Mini film starts one bar before its story's first shot, not at the hook (23 Nov 2026)", () => {
    const ls = songWithHooks(1200);
    const hook = autoSection(ls, beats, { durationMs, anchorMode: "hook-first" });
    expect(hook.anchor.kind).toBe("hook");
    const film = autoSection(ls, beats, { durationMs, anchorMode: "hook-first", storyStartLine: 3 });
    expect(film.anchor).toEqual({ kind: "story", line: 3 });
    // Line 3 appears at 8.25 s (8.5 s - lead): one bar before it, 6 s.
    expect(film.start_ms).toBe(6_000);
    expect(film.reason).toContain("the story's first shot (line 3");
    // Shot 1 on line 1 (sung at 0.5 s): from the song's start.
    expect(autoSection(ls, beats, { durationMs, anchorMode: "hook-first", storyStartLine: 1 }).start_ms).toBe(0);
    // Intro shots first (0): from the song's very start.
    const intro = autoSection(ls, beats, { durationMs, anchorMode: "hook-first", storyStartLine: 0 });
    expect([intro.start_ms, intro.anchor.kind]).toEqual([0, "story"]);
    expect(intro.reason).toContain("the intro");
    // A line that does not exist: the hook as usual.
    expect(autoSection(ls, beats, { durationMs, anchorMode: "hook-first", storyStartLine: 99 }).anchor.kind).toBe("hook");
  });
});
