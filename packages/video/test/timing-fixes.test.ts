// Step 5g.1b: clean cuts from word timings, hook-first short-form sections, the length rule
// (shorter before longer) and QA WARN on cut lines. Includes a regression case modelled on the
// user's song (106.63 BPM, bars from 0:08.6, lines sung back to back), where sections overshot
// (Reels 38.4 s, Shorts 63.2 s), TikTok cut line 7 and Reels started 8 s before the hook.
import { describe, expect, it } from "vitest";

import {
  autoSection,
  parseLrc,
  runQa,
  sectionCuts,
  sectionWindow,
  startsAfterEnd,
  sungEnd,
  sungStart,
  type Beat,
  type PlatformPreset,
  type SectionLine,
} from "../src";
import { loadPresets } from "../src/node";
import { grid } from "./helpers";

const presets = loadPresets();
const sungAt = (lines: SectionLine[], t: number) => lines.filter((l) => sungStart(l) < t && t < sungEnd(l)).map((l) => l.text);
const isBar = (beats: Beat[], t: number) => beats.some((b) => b.is_downbeat && Math.abs(b.time_ms - t) < 1);

function sectionFor(name: string, lines: SectionLine[], beats: Beat[], durationMs: number) {
  const p: PlatformPreset = presets[name];
  const w = sectionWindow(p)!;
  return autoSection(lines, beats, {
    durationMs,
    minMs: w.minMs,
    maxMs: w.maxMs,
    hardMaxMs: w.hardMaxMs,
    shortestMs: w.shortestMs,
    ...(p.length.mode === "target" ? { targetMs: w.targetMs } : {}),
    anchorMode: p.anchor,
  });
}

describe("line ends from word timings", () => {
  it("the aligned LRC's end tag is where the line's singing stops", () => {
    const lrc = "[00:10.00]<00:10.00>Hold <00:10.40>on <00:11.20>\n[00:12.00]<00:12.00>Next <00:12.50>line\n[00:14.00]\n";
    const [a, b] = parseLrc(lrc);
    expect([a.sung_end_ms, sungEnd(a)]).toEqual([11_200, 11_200]); // not the next stamp (12 s)
    expect(b.sung_end_ms).toBeUndefined(); // no end tag: estimated from the word starts
    expect(sungEnd(b)).toBe(13_000);
    expect(sungStart(b)).toBe(12_000);
  });

  it("a bar after the last word ends and before the next line's first word is a clean cut", () => {
    // 120 BPM (bar every 2 s). Each line's first word comes 0.2 s after a bar and the line is sung
    // until 0.3 s before the next bar: every bar is clean, although the LRC lines touch.
    const beats = grid(120, 400, 0);
    const lines: SectionLine[] = Array.from({ length: 40 }, (_, k) => ({
      text: k === 5 ? "Hold on to me" : `Line ${k + 1}`,
      start_ms: 4000 * k + 200,
      end_ms: 4000 * (k + 1) + 200,
      sung_end_ms: 4000 * (k + 1) - 300,
      words: [{ text: "x", start_ms: 4000 * k + 200 }],
      isHook: k === 5,
    }));
    const s = sectionFor("reels", lines, beats, 160_000);
    expect(s.cuts).toEqual([]);
    expect(s.end_ms - s.start_ms).toBeGreaterThanOrEqual(25_500);
    expect(s.end_ms - s.start_ms).toBeLessThanOrEqual(34_500);
    expect(sungAt(lines, s.end_ms)).toEqual([]);
  });

  it("without word timings, a line lasts until the next one starts (line-start logic)", () => {
    const beats = grid(120, 400, 0);
    const lines: SectionLine[] = Array.from({ length: 40 }, (_, k) => ({
      text: k === 5 ? "Hold on to me" : `Line ${k + 1}`,
      start_ms: 4000 * k + 200,
      end_ms: 4000 * (k + 1) + 200,
      isHook: k === 5,
    }));
    const s = sectionFor("reels", lines, beats, 160_000);
    expect(s.endKind).toBe("cuts-line"); // no gaps at all: every bar is inside a line
    expect(s.cuts.map((c) => c.at)).toContain("end");
  });
});

describe("regression: the user's song (106.63 BPM, bars from 0:08.6)", () => {
  const BAR = (4 * 60_000) / 106.63; // 2250.8 ms
  const first = 8600 - 3 * BAR; // bar 1 a few bars before 0:08.6
  const beats: Beat[] = Array.from({ length: 4 * 110 }, (_, i) => ({
    time_ms: Math.round(first + (i * BAR) / 4),
    strength: i % 4 === 0 ? 1 : 0.5,
    is_downbeat: i % 4 === 0,
  }));
  const bar = (k: number) => 8600 + k * BAR; // bar k counted from 0:08.6
  const texts = [
    "Light on the window",
    "When the night won't let you sleep",
    "Hold on to me", // the hook, sung as a pickup just before the bar at 0:10.85
    "Through the night",
    "We will rise",
    "Into the light",
    "Still burning through the dark",
    "Every step I take",
    "Calling out your name",
    "Hold on to me",
    "Through the night",
    "We will rise",
    "Into the light",
    "Long way home",
    "Under the same sky",
    "Hold on to me",
    "Through the night",
  ];
  // Lines sung back to back: first word 0.15 s after a bar (the hook: 0.05 s before one), last
  // word ending 0.3 s before the next bar; a new line every 2 bars. With the old rule (line lasts
  // until the next stamp, next line counted from 0.25 s early) no bar was clean.
  const lines: SectionLine[] = texts.map((text, i) => {
    const firstWord = i === 0 ? bar(-3) + 150 : i === 1 ? bar(-2) + 150 : i === 2 ? bar(1) - 50 : bar(1 + 2 * (i - 2)) + 150;
    const nextFirst = i === 0 ? bar(-2) + 150 : i === 1 ? bar(1) - 50 : bar(1 + 2 * (i - 1)) + 150;
    const lastWordEnd = i === 1 ? bar(0) - 300 : nextFirst - 450;
    return { text, start_ms: firstWord, end_ms: nextFirst, sung_end_ms: lastWordEnd, words: [{ text: text.split(" ")[0], start_ms: firstWord }], isHook: text === "Hold on to me" };
  });
  const hook = lines[2];

  for (const name of ["reels", "tiktok", "shorts"]) {
    it(`${name}: starts at 0:08.6 (hook within 2.5 s), length within +-15%, no line cut`, () => {
      const s = sectionFor(name, lines, beats, 120_000);
      const w = sectionWindow(presets[name])!;
      expect(s.start_ms).toBe(Math.round(bar(0)));
      expect(sungStart(hook) - s.start_ms).toBeLessThanOrEqual(2500);
      expect(s.end_ms - s.start_ms).toBeGreaterThanOrEqual(w.minMs);
      expect(s.end_ms - s.start_ms).toBeLessThanOrEqual(w.maxMs);
      expect(isBar(beats, s.end_ms)).toBe(true);
      expect(s.cuts).toEqual([]);
      expect(sungAt(lines, s.end_ms)).toEqual([]);
      expect(s.warnings).toEqual([]);
    });
  }

  it('tiktok ends cleanly after line 7 "Still burning through the dark" instead of cutting it', () => {
    const s = sectionFor("tiktok", lines, beats, 120_000);
    expect(s.reason).toContain('line 7 "Still burning through the dark" finishes');
    expect(s.end_ms).toBeGreaterThan(sungEnd(lines[6]));
    expect(s.end_ms).toBeLessThan(sungStart(lines[7]));
  });
});

describe("hook-first sections", () => {
  // 120 BPM; verse lines every 4 s sung for 1.5 s; the hook at 48.5 s.
  const beats = grid(120, 480, 0);
  const lines: SectionLine[] = Array.from({ length: 50 }, (_, k) => ({
    text: k === 12 ? "Hold on to me" : `Verse line ${k + 1}`,
    start_ms: 500 + 4000 * k,
    end_ms: 500 + 4000 * (k + 1),
    sung_end_ms: 2000 + 4000 * k,
    isHook: k === 12,
  }));

  it("never starts more than one bar before the hook, even when the line before is still sung", () => {
    const sung = lines.map((l, k) => (k === 11 ? { ...l, sung_end_ms: 48_400 } : l)); // pre-chorus sung up to the hook
    const s = sectionFor("reels", sung, beats, 240_000);
    expect(s.start_ms).toBeGreaterThanOrEqual(48_500 - 2150);
    expect(s.start_ms).toBeLessThanOrEqual(48_500);
    expect(s.cuts).toEqual([{ at: "start", line: 12, text: "Verse line 12", time_ms: s.start_ms }]);
    expect(s.warnings[0]).toContain('cuts line 12 "Verse line 12" while it is sung');
  });

  it("standard keeps its lead-in rule (may start earlier so the pre-chorus is whole)", () => {
    const sung = lines.map((l, k) => (k === 11 ? { ...l, sung_end_ms: 47_000 } : l));
    const s = sectionFor("standard", sung, beats, 240_000);
    expect(s.start_ms).toBe(44_000); // the bar before line 12 (44.5 s)
  });
});

describe("length rule: within +-15%, else up to 25% shorter, else longer", () => {
  const beats = grid(120, 480, 0);
  // A hook at 10.5 s, then continuous singing except two gaps around a bar: one making a 24 s
  // section (-20%) and one making a 38 s section (+27%); nothing clean between 25.5 and 34.5 s.
  const singing: [number, number][] = [[10_500, 33_800], [34_400, 47_800], [48_300, 80_000]];
  const lines: SectionLine[] = singing.map(([a, b], i) => ({
    text: i === 0 ? "Hold on to me" : `Line ${i + 1}`,
    start_ms: a,
    end_ms: singing[i + 1]?.[0] ?? b + 500,
    sung_end_ms: b,
    isHook: i === 0,
  }));

  it("prefers the nearest clean line end up to 25% shorter over a longer one, and says so", () => {
    const s = sectionFor("reels", lines, beats, 120_000);
    expect(s.start_ms).toBe(10_000);
    expect(s.endKind).toBe("shorter");
    expect(s.end_ms - s.start_ms).toBe(24_000);
    expect(s.reason).toContain("shorter than the target: no clean line end within 25.5 s-34.5 s");
    expect(s.cuts).toEqual([]);
  });

  it("takes a longer clean end only when nothing up to 25% shorter exists", () => {
    const later: SectionLine[] = lines.map((l, i) => (i === 0 ? { ...l, end_ms: 34_400, sung_end_ms: 34_200 } : l));
    // Now the first gap (34.2-34.4 s) has no bar; the next clean bar is 48 s (38 s, +27%).
    const s = sectionFor("reels", later, beats, 120_000);
    expect(s.endKind).toBe("extended");
    expect(s.end_ms - s.start_ms).toBe(38_000);
    expect(s.reason).toContain("longer than the target");
  });
});

describe("QA: a section that cuts a sung line is WARN, never PASS", () => {
  const lines: SectionLine[] = [
    { text: "Light on the window", start_ms: 1000, end_ms: 5000, sung_end_ms: 4500, isHook: false },
    { text: "Still burning through the dark", start_ms: 5000, end_ms: 9000, sung_end_ms: 8500, isHook: false },
  ];

  it("names the cut line at the start or the end", () => {
    expect(sectionCuts(lines, 900, 6000)).toEqual([{ at: "end", line: 2, text: "Still burning through the dark", time_ms: 6000 }]);
    expect(sectionCuts(lines, 2000, 4800)).toEqual([{ at: "start", line: 1, text: "Light on the window", time_ms: 2000 }]);
    expect(sectionCuts(lines, 900, 4800)).toEqual([]);
    const qa = runQa({
      props: { shots: [{ start: 0, duration: 150, src: "a", clipStartFrame: 0, clipDurationFrames: 300, playbackRate: 1, holdLastFrame: false }], lyrics: [], cinematicBars: false, durationInFrames: 150 },
      shotClips: ["a"],
      poolSize: 4,
      lyrics: [],
      frames: null,
      sectionCuts: sectionCuts(lines, 900, 6000),
    });
    expect(qa.status).toBe("WARN");
    expect(qa.checks.find((c) => c.name === "Section start/end")?.details).toEqual([
      'the video ends at 0:06.0 in the song while line 2 "Still burning through the dark" is sung',
    ]);
  });

  it("a line whose first word comes after the end is not shown (it would only flash up)", () => {
    // Line 2 appears at 4.75 s (0.25 s early) but is first sung at 5 s.
    expect(startsAfterEnd(lines, 4800, 250)).toEqual([1]); // would flash up for 0.05 s: hidden
    expect(startsAfterEnd(lines, 4700, 250)).toEqual([]); // not on screen before the end anyway
    expect(startsAfterEnd(lines, 6000, 250)).toEqual([]); // sung inside the video: shown
  });
});
