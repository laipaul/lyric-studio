// Lyric effects (Step 5j): smooth (no jumps beyond the easing), readable at the stamp, words on the
// voice, pauses clear the screen, deterministic.
import os from "node:os";

import { describe, expect, it } from "vitest";

import {
  EFFECTS,
  EFFECT_NAMES,
  GAP_FADE_FRAMES,
  GLIDE_LIFT_PX,
  INTENSITIES,
  NEXT_OPACITY,
  SOFT_BLUR_MAX_PX,
  checkEffectChoice,
  effectExtents,
  lyricFrames,
  lyricScene,
  parseEffectChoice,
  rawLyric,
  sceneTimeline,
  type EffectChoice,
  type RenderBase,
  type SceneLine,
  type SceneOptions,
} from "../src";
import { DEFAULT_LYRIC_AREA } from "../src";
import { loadFontCatalog, measureLyrics, resolveFace } from "../src/node";

const FPS = 30;
const LEAD = 8;
// Four lines, 3 s apart; three words each, 10 frames apart from the stamp; then a pause.
function lines(spacing = 90, withWords = true): SceneLine[] {
  return [0, 1, 2, 3].map((k) => {
    const start = 30 + spacing * k;
    const stamp = start + LEAD;
    return {
      startFrame: start,
      endFrame: k < 3 ? start + spacing : start + 400,
      stampFrame: stamp,
      sungEndFrame: stamp + 30,
      isHook: k === 2,
      ...(withWords ? { words: ["one", "two", "three"].map((t, w) => ({ text: t, startFrame: stamp + 10 * w, endFrame: stamp + 10 * (w + 1) })) } : {}),
    };
  });
}
const DURATION = 30 + 90 * 3 + 400 + 60; // the last line leaves before the end
const options = (verse: EffectChoice, hook: EffectChoice = verse, over: Partial<SceneOptions> = {}): SceneOptions => ({
  fps: FPS,
  durationInFrames: DURATION,
  verse,
  hook,
  showNext: true,
  nextScale: 0.55,
  gapPx: 22,
  height: (i) => (i === 1 ? 2 : 1) * 64 * 1.15, // line 2 wraps onto two lines
  wordCount: () => 3,
  ...over,
});

type Sample = { opacity: number; y: number; x: number; scale: number; blur: number; words: { opacity: number; accent: number; y: number }[] | null };
function track(ls: SceneLine[], o: SceneOptions): Map<number, Sample>[] {
  const t = sceneTimeline(ls, o);
  const out: Map<number, Sample>[] = [];
  for (let f = 0; f < o.durationInFrames; f++) {
    out.push(new Map(lyricScene(t, f).map((item) => [item.index, { ...item.look, words: item.words?.map((w) => ({ opacity: w.opacity, accent: w.accent, y: w.y })) ?? null }])));
  }
  return out;
}

const ALL = EFFECTS.flatMap((e) => INTENSITIES.map((intensity) => ({ name: e.name, intensity })));

describe("lyric effects registry", () => {
  it("has the 8 effects, glide first (the default)", () => {
    expect(EFFECTS.map((e) => e.name)).toEqual(["glide", "cinematic-fade", "soft-blur", "dreamy-glow", "word-reveal", "karaoke-highlight", "floating", "typewriter"]);
    expect(EFFECTS.filter((e) => e.unit === "word").map((e) => e.name)).toEqual(["word-reveal", "karaoke-highlight", "typewriter"]);
    expect(EFFECTS.map((e) => e.name)).toEqual([...EFFECT_NAMES]); // the settings checks know every module
  });

  it("parses name[:intensity] and JSON choices, with clear messages", () => {
    expect(parseEffectChoice("glide")).toEqual({ name: "glide", intensity: "balanced" });
    expect(parseEffectChoice("Soft-Blur:expressive")).toEqual({ name: "soft-blur", intensity: "expressive" });
    expect(() => parseEffectChoice("wobble", "--line-effect")).toThrow(/--line-effect: unknown effect "wobble". Known: glide, cinematic-fade/);
    expect(() => parseEffectChoice("glide:loud")).toThrow(/intensity must be subtle, balanced or expressive/);
    expect(checkEffectChoice({ name: "floating", intensity: "subtle", durationMs: 800 }, "motion.verseEffect")).toEqual({ name: "floating", intensity: "subtle", durationMs: 800 });
    expect(() => checkEffectChoice({ name: "glide", durationMs: 5 }, "x")).toThrow(/durationMs must be 100-2000/);
    expect(() => checkEffectChoice({ name: "glide", easing: "bouncy" }, "x")).toThrow(/easing must be/);
  });
});

describe("no frame-to-frame jumps beyond the easing", () => {
  it.each(ALL)("$name ($intensity)", ({ name, intensity }) => {
    const choice: EffectChoice = { name, intensity: intensity as EffectChoice["intensity"] };
    for (const show of [true, false]) {
      const frames = track(lines(), options(choice, choice, { showNext: show }));
      for (let f = 1; f < frames.length; f++) {
        for (const i of new Set([...frames[f - 1].keys(), ...frames[f].keys()])) {
          const a = frames[f - 1].get(i);
          const b = frames[f].get(i);
          const where = `${name} ${intensity} line ${i} frame ${f}`;
          // Appearing and disappearing are fades too: never from/to more than a quarter at once.
          expect(Math.abs((b?.opacity ?? 0) - (a?.opacity ?? 0)), where).toBeLessThanOrEqual(0.25);
          if (!a || !b) continue;
          expect(Math.abs(b.y - a.y), `${where} y`).toBeLessThanOrEqual(30);
          expect(Math.abs(b.x - a.x), `${where} x`).toBeLessThanOrEqual(2);
          expect(Math.abs(b.scale - a.scale), `${where} scale`).toBeLessThanOrEqual(0.06);
          expect(Math.abs(b.blur - a.blur), `${where} blur`).toBeLessThanOrEqual(1);
          for (const [k, w] of (b.words ?? []).entries()) {
            const v = a.words?.[k];
            if (!v) continue;
            expect(Math.abs(w.opacity - v.opacity), `${where} word ${k}`).toBeLessThanOrEqual(0.5);
            expect(Math.abs(w.accent - v.accent), `${where} word ${k} accent`).toBeLessThanOrEqual(0.5);
          }
        }
      }
    }
  });

  it("soft-blur never blurs more than ~4 px", () => {
    for (const intensity of INTENSITIES) {
      const frames = track(lines(), options({ name: "soft-blur", intensity }));
      const most = Math.max(...frames.flatMap((m) => [...m.values()].map((s) => s.blur)));
      expect(most).toBeGreaterThan(0.5);
      expect(most).toBeLessThanOrEqual(SOFT_BLUR_MAX_PX);
    }
  });
});

describe("the active line is fully readable at its timestamp", () => {
  it.each(ALL)("$name ($intensity)", ({ name, intensity }) => {
    const choice: EffectChoice = { name, intensity: intensity as EffectChoice["intensity"] };
    for (const spacing of [90, 30, 14]) { // relaxed, fast and very fast lines
      const ls = lines(spacing);
      const frames = track(ls, options(choice));
      for (const [i, l] of ls.entries()) {
        for (const f of [l.startFrame, l.stampFrame!]) {
          const s = frames[f].get(i);
          const where = `${name} spacing ${spacing} line ${i} frame ${f}`;
          expect(s, where).toBeDefined();
          expect(s!.opacity, where).toBe(1);
          expect(s!.blur, where).toBe(0);
          expect(Math.abs(s!.scale - 1), where).toBeLessThan(0.001);
          expect(Math.abs(s!.y), where).toBeLessThanOrEqual(11); // floating sways a few px
          if (name !== "floating") expect(s!.y, where).toBe(0);
          // Its first word is readable when the line is sung.
          if (f === l.stampFrame && s!.words) expect(s!.words[0].opacity, where).toBe(1);
        }
      }
    }
  });
});

describe("glide", () => {
  const ls = lines();
  const frames = track(ls, options({ name: "glide", intensity: "balanced" }));
  it("the next line waits small and faded underneath, then rises into place, settled 0.25 s before its stamp", () => {
    const waiting = frames[ls[1].startFrame + 30].get(2)!; // line 3 waits under line 2
    expect(waiting.opacity).toBeCloseTo(NEXT_OPACITY, 5);
    expect(waiting.scale).toBe(0.55);
    expect(waiting.y).toBeCloseTo((2 * 64 * 1.15) / 2 + 22 + (0.55 * 64 * 1.15) / 2, 5);
    const settled = frames[ls[2].startFrame].get(2)!;
    expect([settled.y, settled.scale, settled.opacity]).toEqual([0, 1, 1]);
    expect(ls[2].stampFrame! - ls[2].startFrame).toBe(8); // = the 0.25 s lead
  });

  it("the old line moves up ~40 px and fades out; the following line fades in below", () => {
    const start = ls[2].startFrame - 15; // the 500 ms transition
    const mid = frames[start + 7];
    expect(mid.get(1)!.y).toBeLessThan(-10);
    expect(mid.get(1)!.y).toBeGreaterThan(-GLIDE_LIFT_PX);
    expect(frames[ls[2].startFrame - 1].get(1)?.opacity ?? 0).toBeLessThan(0.05);
    expect(frames[ls[2].startFrame].get(1)).toBeUndefined(); // gone when the new line is settled
    expect(frames[start].get(3)).toBeUndefined(); // the following line is not there yet...
    expect(frames[ls[2].startFrame].get(3)!.opacity).toBeCloseTo(NEXT_OPACITY, 5); // ...and is now
  });

  it("showNextLine off: the next line is not shown before its turn", () => {
    const off = track(ls, options({ name: "glide", intensity: "balanced" }, undefined, { showNext: false }));
    expect(off[ls[1].startFrame + 20].get(2)).toBeUndefined();
    expect(off[ls[2].startFrame].get(2)!.opacity).toBe(1);
  });
});

describe("word effects follow the word timings", () => {
  const ls = lines();
  it("karaoke-highlight: the word being sung is in the accent colour, only then", () => {
    const frames = track(ls, options({ name: "karaoke-highlight", intensity: "balanced" }));
    for (const [i, l] of ls.entries()) {
      for (const [k, w] of l.words!.entries()) {
        for (let f = w.startFrame; f <= w.endFrame; f++) expect(frames[f].get(i)!.words![k].accent, `line ${i} word ${k} frame ${f}`).toBe(1);
        expect(frames[w.startFrame - 3].get(i)?.words?.[k].accent ?? 0).toBe(0);
        expect(frames[w.endFrame + 5].get(i)?.words?.[k].accent ?? 0).toBe(0);
      }
    }
  });

  it("word-reveal and typewriter: each word complete on its own word time, not before its reveal", () => {
    for (const name of ["word-reveal", "typewriter"]) {
      const t = sceneTimeline(ls, options({ name, intensity: "expressive" }));
      for (const [i, l] of ls.entries()) {
        for (const [k, w] of l.words!.entries()) {
          const at = lyricScene(t, w.startFrame).find((s) => s.index === i)!.words![k];
          expect(name === "typewriter" ? at.chars : at.opacity, `${name} line ${i} word ${k}`).toBe(1);
          const before = lyricScene(t, w.startFrame - 7).find((s) => s.index === i)?.words?.[k];
          if (before) expect(name === "typewriter" ? before.chars : before.opacity, `${name} line ${i} word ${k} early`).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("without word timings the words are spread from the line's stamp", () => {
    const plain = lines(90, false);
    const t = sceneTimeline(plain, options({ name: "karaoke-highlight", intensity: "balanced" }));
    const s = plain[0].stampFrame!;
    expect(lyricScene(t, s).find((x) => x.index === 0)!.words!.map((w) => w.accent)).toEqual([1, 0, 0]);
    expect(lyricScene(t, s + 15).find((x) => x.index === 0)!.words!.map((w) => w.accent)).toEqual([0, 1, 0]); // sung end at +30: 10 frames a word
  });
});

describe("instrumental gaps", () => {
  const base = (lyrics: RenderBase["lyrics"]): RenderBase =>
    ({ plan: { start_frame: 0 }, lyrics, durationInFrames: 900 }) as unknown as RenderBase;
  const line = (text: string, start: number, end: number, sungEnd: number) =>
    rawLyric({ text, start_ms: start, end_ms: end, isHook: false, words: [{ text: text.split(" ")[0], start_ms: start }, { text: text.split(" ")[1], start_ms: start + 400 }], sung_end_ms: sungEnd });

  it("the last line before a pause leaves 1 s after its last word (0.4 s fade); close lines are not cut", () => {
    const raw = [line("first line", 1000, 9000, 2000), line("second line", 9000, 10_500, 9800), line("third line", 10_500, 14_000, 11_000)];
    const ls = lyricFrames(base(raw), 250, 0, true);
    expect(ls[0].endFrame).toBe(Math.round(((2000 + 1000 + 400) * 30) / 1000)); // sung end + 1 s + fade
    expect(ls[0].sungEndFrame).toBe(60);
    expect(ls[0].words).toEqual([{ text: "first", startFrame: 30, endFrame: 42 }, { text: "line", startFrame: 42, endFrame: 60 }]);
    expect(ls[1].endFrame).toBe(Math.round(((10_500 - 250) * 30) / 1000)); // the next line follows closely: kept
    // Without effects nothing changes (older manifests render as before).
    expect(lyricFrames(base(raw), 250, 0, false)[0]).toEqual({ text: "first line", startFrame: 23, endFrame: 263, isHook: false });

    for (const e of EFFECTS) {
      const t = sceneTimeline(ls, options({ name: e.name, intensity: "balanced" }, undefined, { durationInFrames: 600 }));
      // Fading from 1 s after the last word...
      expect(lyricScene(t, ls[0].endFrame - GAP_FADE_FRAMES - 1).some((s) => s.index === 0), e.name).toBe(true);
      // ...and the screen is clear until the next line starts to come in.
      for (let f = ls[0].endFrame; f < t.enterStart[1]; f++) expect(lyricScene(t, f), `${e.name} frame ${f}`).toEqual([]);
    }
  });

  it("a gap longer than gapHideS shows nothing (no waiting next line); the next line fades in gapLeadInS before its first word", () => {
    const gap = { hideMs: 3_000, leadInMs: 1_000 };
    // An intro of 12 s, then a line; an 8 s solo; then a line 2 s after the previous one (a short gap).
    const raw = [line("first line", 12_000, 20_000, 13_000), line("after solo", 21_000, 23_200, 22_000), line("short gap", 24_000, 30_000, 25_000)];
    const ls = lyricFrames(base(raw), 250, 0, true, gap);
    const frame = (ms: number) => Math.round((ms * 30) / 1000);
    expect(ls[0].enterFrame).toBe(frame(11_000)); // the intro: fades in 1 s before its first word
    expect(ls[1].enterFrame).toBe(frame(20_000)); // after the 8 s solo
    expect(ls[2].enterFrame).toBeUndefined(); // 2 s gap: the usual timing
    expect(ls[0].endFrame).toBe(frame(13_000 + 1_400)); // cleared 1 s after the last word (0.4 s fade)
    // Older manifests (no gap setting): unchanged.
    expect(lyricFrames(base(raw), 250, 0, true).map((l) => l.enterFrame)).toEqual([undefined, undefined, undefined]);

    for (const e of EFFECTS) {
      const t = sceneTimeline(ls, options({ name: e.name, intensity: "balanced" }, undefined, { durationInFrames: 1_000 }));
      // The intro and the solo: nothing at all on screen, not even the waiting next line.
      for (let f = 0; f < frame(11_000); f++) expect(lyricScene(t, f), `${e.name} intro frame ${f}`).toEqual([]);
      for (let f = ls[0].endFrame; f < frame(20_000); f++) expect(lyricScene(t, f), `${e.name} solo frame ${f}`).toEqual([]);
      // Fading in during the lead-in, settled at its usual time (0.25 s before the stamp).
      const mid = lyricScene(t, frame(11_400)).find((x) => x.index === 0);
      expect(mid && mid.look.opacity > 0 && mid.look.opacity < 1, e.name).toBe(true);
      expect(lyricScene(t, ls[0].startFrame).find((x) => x.index === 0)?.look.opacity, e.name).toBeCloseTo(1, 5);
    }
  });
});

describe("deterministic", () => {
  it("the same inputs give the same scene; floating sways differently per line", () => {
    for (const e of EFFECTS) {
      const o = options({ name: e.name, intensity: "expressive" });
      expect(JSON.stringify(track(lines(), o).map((m) => [...m]))).toBe(JSON.stringify(track(lines(), o).map((m) => [...m])));
    }
    const f = track(lines(), options({ name: "floating", intensity: "balanced" }));
    expect(f[160].get(1)!.y).not.toBeCloseTo(f[250].get(2)!.y, 3);
  });

  it("safe-zone extents come from each effect's own motion", () => {
    const g = effectExtents({ name: "glide", intensity: "balanced" }, { name: "glide", intensity: "balanced" }, FPS);
    expect(g.up).toBeGreaterThanOrEqual(GLIDE_LIFT_PX);
    const c = effectExtents({ name: "cinematic-fade", intensity: "expressive" }, { name: "glide", intensity: "balanced" }, FPS);
    expect(c.maxScale).toBeCloseTo(1.06, 5);
    const k = effectExtents({ name: "karaoke-highlight", intensity: "balanced" }, { name: "floating", intensity: "balanced" }, FPS);
    expect(k.side).toBeGreaterThan(0); // the hook floats like the verses
  });
});

describe("QA safe-zone measurement with effects", () => {
  it("the box covers the effect's movement and the next line waiting underneath", () => {
    const catalog = loadFontCatalog(os.tmpdir());
    const face = resolveFace(catalog, "Inter", 600);
    const lyrics = [
      { text: "First line", startFrame: 0, endFrame: 60, number: 1, confidence: null },
      { text: "Second line comes next", startFrame: 60, endFrame: 120, number: 2, confidence: null },
    ];
    const fonts = { main: face, hook: null, textCase: "none" as const, textSize: 64, animation: "fade", area: DEFAULT_LYRIC_AREA };
    const plain = measureLyrics(lyrics, fonts)[0].box;
    const glide = { verse: { name: "glide", intensity: "balanced" as const }, hook: { name: "glide", intensity: "balanced" as const }, accent: "#E8A3B5" };
    const withNext = measureLyrics(lyrics, { ...fonts, effects: glide, nextLine: true, nextScale: 0.55 })[0].box;
    const noNext = measureLyrics(lyrics, { ...fonts, effects: glide, nextLine: false })[0].box;
    expect(noNext.top).toBeLessThanOrEqual(plain.top - GLIDE_LIFT_PX); // moves up while leaving
    expect(withNext.bottom).toBeGreaterThan(noNext.bottom); // the waiting next line
    expect(withNext.bottom).toBeGreaterThan(plain.bottom + 64 * 0.35 + 64 * 1.15 * 0.55 - 1);
    // The last line has nothing waiting under it.
    expect(measureLyrics(lyrics, { ...fonts, effects: glide, nextLine: true })[1].box.bottom).toBe(measureLyrics(lyrics, { ...fonts, effects: glide, nextLine: false })[1].box.bottom);
  });
});
