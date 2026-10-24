import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEAD_MS,
  composeProps,
  getCutPoints,
  lyricFrames,
  matchPinClips,
  parsePins,
  pinsToShots,
  type RenderBase,
} from "../src";
import { grid } from "./helpers";

// 120 BPM, section 0.5 s - 16.5 s, 1x: one shot per bar (2 s = 60 frames).
const plan = getCutPoints(grid(120, 40, 500), { start_ms: 500, end_ms: 16_500 }, { cutRate: "1x" });
const clips = ["03_c.mp4", "01_a.mp4", "02_b.mp4", "10_d.mp4"].map((name, i) => ({
  id: `id-${i}`,
  name,
  duration_ms: 10_000,
  path: `cache/${name}`,
  durationFrames: 300,
}));
const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
const base = (over: Partial<RenderBase> = {}): RenderBase => ({
  plan,
  clips,
  audio: null,
  durationInFrames: plan.end_frame - plan.start_frame,
  lyrics: [
    { text: "Verse line", start_ms: 1_500, end_ms: 4_500, isHook: false },
    { text: "Love is a good thing", start_ms: 4_500, end_ms: 6_000, isHook: true },
    { text: "Another line", start_ms: 9_000, end_ms: 12_000, isHook: false },
    { text: "Love is a good thing", start_ms: 12_000, end_ms: 14_000, isHook: true },
  ],
  styles: {
    simple: { style, textSize: 64, hookFont: null, fonts: [] },
    bold: { style: { ...style, name: "Bold" }, textSize: 72, hookFont: null, fonts: [] },
  },
  colour: "#fff",
  cinematicBars: false,
  pins: [],
  ...over,
});
const frameOf = (ms: number) => Math.round((ms * 30) / 1000) - plan.start_frame;

describe("lyric timing", () => {
  it("lines appear 0.25 s before their stamp by default (and end 0.25 s early, so they never overlap)", () => {
    expect(DEFAULT_LEAD_MS).toBe(250);
    const lines = lyricFrames(base());
    expect(lines[0].startFrame).toBe(frameOf(1_500 - 250));
    expect(lines[0].endFrame).toBe(lines[1].startFrame);
  });

  it("--lead and --lyrics-offset move the lines", () => {
    expect(lyricFrames(base(), 0)[0].startFrame).toBe(frameOf(1_500));
    expect(lyricFrames(base(), 250, -300)[0].startFrame).toBe(frameOf(1_500 - 550));
    expect(lyricFrames(base(), 250, 1_000)[2].startFrame).toBe(frameOf(9_000 + 750));
  });

  it("composeProps clips lines to the section and keeps the hook flag", () => {
    const { props } = composeProps(base(), { seed: 1, style: "simple" });
    expect(props.lyrics.map((l) => [l.text, l.isHook])).toEqual([
      ["Verse line", false],
      ["Love is a good thing", true],
      ["Another line", false],
      ["Love is a good thing", true],
    ]);
    expect(props.lyrics[0].startFrame).toBe(frameOf(1_250));
  });
});

describe("pins", () => {
  const pinFile = "# comment\nLove is a good thing = 10_d.mp4\n\nanother LINE! = 01_a\nbroken line\nVerse line = missing.mp4\n";

  it("parses pins.txt and matches clip names with or without the extension", () => {
    const { rules, warnings } = parsePins(pinFile);
    expect(rules.map((r) => [r.lineNumber, r.text, r.clipName])).toEqual([
      [2, "Love is a good thing", "10_d.mp4"],
      [4, "another LINE!", "01_a"],
      [6, "Verse line", "missing.mp4"],
    ]);
    expect(warnings).toEqual(['pins.txt line 5: expected "lyric line = clip file", got "broken line"']);
    const matched = matchPinClips(rules, clips);
    expect(matched.pins.map((p) => p.clipName)).toEqual(["10_d.mp4", "01_a.mp4"]);
    expect(matched.warnings).toEqual(['pins.txt line 6: clip "missing.mp4" not found in the clips folder']);
  });

  it("forces the clip onto the shot where the line appears, at every occurrence, in both orders", () => {
    const pins = matchPinClips(parsePins(pinFile).rules, clips).pins;
    for (const order of ["story", "shuffle"] as const) {
      for (const seed of [1, 2, 3]) {
        const { props, warnings } = composeProps(base({ pins }), { seed, style: "simple", order });
        expect(warnings).toEqual([]);
        const shotAt = (frame: number) => props.shots.find((s) => frame >= s.start && frame < s.start + s.duration)!;
        for (const line of props.lyrics.filter((l) => l.text === "Love is a good thing")) {
          expect(shotAt(line.startFrame).src).toBe("cache/10_d.mp4");
        }
        expect(shotAt(props.lyrics[2].startFrame).src).toBe("cache/01_a.mp4");
        // Still never the same clip twice in a row.
        props.shots.slice(1).forEach((s, i) => expect(s.src).not.toBe(props.shots[i].src));
      }
    }
  });

  it("warns about lines not found, outside the section, and two pins on one shot", () => {
    const pins = matchPinClips(
      parsePins("Not in the song = 01_a\nVerse line = 02_b\nverse line = 03_c").rules,
      clips,
    ).pins;
    const { warnings } = composeProps(base({ pins }), { seed: 1, style: "simple" });
    expect(warnings).toContain('pins.txt line 1: lyric line "Not in the song" not found in the lyrics');
    expect(warnings.some((w) => /lines 2 and 3 both pin shot 1; using 03_c.mp4/.test(w))).toBe(true);

    const outside = pinsToShots(pins.slice(1, 2), [{ text: "Verse line", startFrame: 9_999, endFrame: 10_100 }], [0, 60, 120]);
    expect(outside.warnings).toEqual(['pins.txt line 2: "Verse line" is outside the section']);
    // Starting before the section but still on screen at its start: pins the first shot.
    const early = pinsToShots(pins.slice(1, 2), [{ text: "Verse line", startFrame: -5, endFrame: 40 }], [0, 60, 120]);
    expect(early.warnings).toEqual([]);
    expect(early.byShot.get(0)).toBe(pins[1].clipId);
    const gone = pinsToShots(pins.slice(1, 2), [{ text: "Verse line", startFrame: -50, endFrame: -1 }], [0, 60, 120]);
    expect(gone.warnings).toEqual(['pins.txt line 2: "Verse line" is outside the section']);
  });

  it("pins follow the lyric timing (a line moved into the next shot pins that shot)", () => {
    const pins = matchPinClips(parsePins("Another line = 10_d").rules, clips).pins;
    // "Another line" at 9.0 s appears at 8.75 s (lead 0.25 s): the shot from ~8.43 s to ~10.43 s.
    // With +2 s offset it appears at 10.75 s: the next shot.
    const early = composeProps(base({ pins }), { seed: 1, style: "simple" }).props;
    const late = composeProps(base({ pins }), { seed: 1, style: "simple", lyricsOffsetMs: 2_000 }).props;
    const shotIndex = (p: typeof early, frame: number) => p.shots.findIndex((s) => frame >= s.start && frame < s.start + s.duration);
    const e = shotIndex(early, early.lyrics[2].startFrame);
    const l = shotIndex(late, late.lyrics[2].startFrame);
    expect(l).toBe(e + 1);
    expect(early.shots[e].src).toBe("cache/10_d.mp4");
    expect(late.shots[l].src).toBe("cache/10_d.mp4");
  });
});
