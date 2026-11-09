// Theme v2 step 2b part 2: the stacked line shape, build up and the bigger final chorus (src/line-shape.ts),
// one test per rule in docs/theme-rules.md (LIN-01 .. LIN-06).
import { describe, expect, it } from "vitest";

import {
  breathsOf,
  buildRows,
  BUILD_ROW_FRAMES,
  DEFAULT_LYRIC_AREA,
  FINAL_HOOK_SCALE,
  FINAL_PHRASE_SCALE,
  finalHookScales,
  isGlueWord,
  layoutLyric,
  lineScale,
  lyricBox,
  patchLook,
  runQa,
  stackLyric,
  STACK_MAX_ROWS,
  STACK_MAX_WORDS,
  type LyricVideoProps,
  type QaInput,
} from "../src";
import { withFinalHook } from "../src/node";

// Every character 0.5 em wide: a row's width is its characters x size / 2.
const measure = (t: string, size: number) => t.length * size * 0.5;
const words = (rows: string[]) => rows.map((r) => r.split(" "));

describe("stacked line shape", () => {
  it("LIN-01: 2-4 rows of 1-3 words, never padded; one or two words stay on one row", () => {
    expect(stackLyric("Hold me", 64, 800, measure).rows).toEqual(["Hold me"]);
    expect(stackLyric("Tonight", 64, 800, measure).rows).toEqual(["Tonight"]);
    for (const text of ["Stay with me tonight", "Hold me close until the light", "I walked the shore alone and the sea was calling me home"]) {
      const { rows } = stackLyric(text, 64, 800, measure);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.length).toBeLessThanOrEqual(STACK_MAX_ROWS);
      for (const r of words(rows)) expect(r.length).toBeLessThanOrEqual(STACK_MAX_WORDS);
      expect(rows.join(" ")).toBe(text); // every word, in order
    }
    // Never padded to four: a short line takes two rows.
    expect(stackLyric("Here with me now", 64, 800, measure).rows.length).toBe(2);
  });

  it("LIN-02: a break goes where the singer breathes", () => {
    const text = "I need you here with me";
    const noBreath = stackLyric(text, 64, 800, measure).rows;
    // A breath after "you" (word 2): the first row ends there.
    const breaths = [false, false, true, false, false, false];
    const withBreath = stackLyric(text, 64, 800, measure, 0.75, breaths).rows;
    expect(withBreath[0]).toBe("I need you");
    expect(withBreath.join(" ")).toBe(text);
    expect(noBreath.join(" ")).toBe(text);
  });

  it("LIN-03: never one word alone on the last row when the line has 3 words or more", () => {
    for (const text of ["Stay with me tonight", "Under the summer rain", "You and I forever", "Carry me home tonight now"]) {
      const { rows } = stackLyric(text, 64, 800, measure);
      expect(words(rows).at(-1)!.length, text).toBeGreaterThan(1);
    }
  });

  it("LIN-04: never a break right after a small word (the, my, to, le, la, mon ...)", () => {
    for (const text of ["Hold me close until the light", "Walking on the edge of my dream", "Je t'attends sous la pluie ce soir", "Tu es mon soleil et ma lune"]) {
      const { rows } = stackLyric(text, 64, 800, measure);
      for (const r of words(rows).slice(0, -1)) expect(isGlueWord(r.at(-1)!), `${text}: "${rows.join(" / ")}"`).toBe(false);
    }
    expect(isGlueWord("The")).toBe(true);
    expect(isGlueWord("l'")).toBe(true);
    expect(isGlueWord("light")).toBe(false);
  });

  it("LIN-01: rows fit the width; the size shrinks only when a row would not fit", () => {
    const wide = stackLyric("Stay with me tonight", 64, 800, measure);
    expect(wide.fontSize).toBe(64);
    const narrow = stackLyric("Extraordinarily wonderful", 64, 400, measure); // 15 chars x 32 px = 480 > 400
    expect(narrow.rows).toEqual(["Extraordinarily", "wonderful"]);
    expect(Math.max(...narrow.rows.map((r) => measure(r, narrow.fontSize)))).toBeLessThanOrEqual(400);
    expect(narrow.fontSize).toBeLessThan(64);
  });

  it("a line too long for four rows of three words is marked too long (split it in the lyrics)", () => {
    const long = stackLyric("one two three four five six seven eight nine ten eleven twelve thirteen", 64, 900, measure);
    expect(long.rows.length).toBe(STACK_MAX_ROWS);
    expect(long.tooLong).toBe(true);
  });

  it("is deterministic and is what layoutLyric gives for the stacked shape", () => {
    const a = layoutLyric("Hold me close until the light", 64, 800, measure, 0.75, { shape: "stacked" });
    const b = layoutLyric("Hold me close until the light", 64, 800, measure, 0.75, { shape: "stacked" });
    expect(a).toEqual(b);
    expect(a.lines).toEqual(stackLyric("Hold me close until the light", 64, 800, measure).rows);
    // Without the shape: today's subtitle layout, unchanged.
    expect(layoutLyric("Hold me close until the light", 64, 2000, measure).lines).toEqual(["Hold me close until the light"]);
  });

  it("breaths come from the aligned words only when they are the words on screen", () => {
    const w = [
      { startFrame: 0, endFrame: 10 },
      { startFrame: 12, endFrame: 20 },
      { startFrame: 26, endFrame: 30 }, // 6 frames = 0.2 s after the word before: a breath
    ];
    expect(breathsOf(w, 3, 30)).toEqual([false, true, false]);
    expect(breathsOf(w, 4, 30)).toBeUndefined();
    expect(breathsOf(undefined, 3, 30)).toBeUndefined();
  });
});

describe("build up (lineBuild build)", () => {
  it("LIN-05: each row appears as its first word comes on screen and stays", () => {
    // Rows of 2 + 2 words; the third word is sung at frame 40, the lead is 8 frames: on screen at 32.
    const rows = [2, 2];
    const starts = [10, 20, 40, 50];
    expect(buildRows(rows, starts, 0, 8)).toEqual([1, 0]);
    expect(buildRows(rows, starts, 32 - BUILD_ROW_FRAMES, 8)[1]).toBe(0);
    expect(buildRows(rows, starts, 32 - BUILD_ROW_FRAMES / 2, 8)[1]).toBeCloseTo(0.5);
    expect(buildRows(rows, starts, 32, 8)).toEqual([1, 1]);
    expect(buildRows(rows, starts, 500, 8)).toEqual([1, 1]); // stays until the line itself leaves
  });
});

describe("bigger final chorus (finalHook on)", () => {
  const line = (isHook: boolean) => ({ text: "x", startFrame: 0, endFrame: 10, ...(isHook ? { isHook: true } : {}) });

  it("LIN-06: the video's last chorus x1.3, its last line x1.5", () => {
    const lines = [line(false), line(true), line(true), line(false), line(true), line(true), line(true)];
    const scales = finalHookScales(lines);
    expect([...scales.entries()]).toEqual([
      [4, FINAL_HOOK_SCALE],
      [5, FINAL_HOOK_SCALE],
      [6, FINAL_PHRASE_SCALE],
    ]);
    // A verse after the last chorus: the chorus before it is still the last one.
    expect([...finalHookScales([...lines, line(false)]).keys()]).toEqual([4, 5, 6]);
    expect(finalHookScales([line(false), line(false)]).size).toBe(0);
  });

  it("the planner sets the sizes; a size set on a card still wins", () => {
    const lyrics = withFinalHook([line(false), line(true), line(true)]);
    expect(lyrics.map((l) => l.scale)).toEqual([undefined, FINAL_HOOK_SCALE, FINAL_PHRASE_SCALE]);
    expect(lineScale(lyrics[2])).toBe(FINAL_PHRASE_SCALE);
    expect(lineScale({ ...lyrics[2], card: { scale: 0.9 } })).toBe(0.9);
    expect(lineScale(lyrics[0], 1.3)).toBe(1); // a verse
  });
});

describe("Shape viewer patch and QA", () => {
  const props = {
    lyrics: [
      { text: "a", startFrame: 0, endFrame: 10 },
      { text: "b", startFrame: 10, endFrame: 20, isHook: true },
    ],
    lyricEffects: { verse: { name: "typewriter", intensity: "balanced" }, hook: { name: "typewriter", intensity: "balanced" }, accent: "#E8A3B5" },
  } as unknown as LyricVideoProps;

  it("the viewer shows the three choices at once, and takes them back", () => {
    const on = patchLook(props, { lineShape: "stacked", lineBuild: "build", finalHook: "on" });
    expect(on.lyricEffects?.lineShape).toBe("stacked");
    expect(on.lyricEffects?.lineBuild).toBe("build");
    expect(on.lyrics.map((l) => l.scale)).toEqual([undefined, FINAL_PHRASE_SCALE]);
    const off = patchLook(on, { lineShape: "subtitle", lineBuild: "replace", finalHook: "off" });
    expect(off.lyricEffects?.lineShape).toBeUndefined();
    expect(off.lyricEffects?.lineBuild).toBeUndefined();
    expect(off.lyrics.map((l) => l.scale)).toEqual([undefined, undefined]);
  });

  it("QA: up to four rows is fine for the stacked shape, more than two lines is not for subtitles", () => {
    const base: QaInput = {
      props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 240 },
      shotClips: [],
      poolSize: 1,
      lyrics: [{ number: 1, text: "Stay with me tonight", confidence: 0.9, lines: 3, box: lyricBox(3, 64, 400, 1, DEFAULT_LYRIC_AREA) }],
      frames: null,
    } as unknown as QaInput;
    const check = (input: QaInput) => runQa(input).checks.find((c) => c.name === "Lyric lines over 2 lines")!;
    expect(check(base).ok).toBe(false);
    expect(check({ ...base, props: { ...base.props, lyricEffects: { ...props.lyricEffects!, lineShape: "stacked" } } }).ok).toBe(true);
  });
});
