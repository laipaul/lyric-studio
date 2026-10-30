// The effects from the user's Canva finishing touches: the letter-by-letter typewriter (steady, never behind
// the singer, a cursor, a pace from the intensity, erase on the way out, typed title cards), Spread
// (letters open up, never wider than the laid-out line) and Breathe (a slow swell, on the downbeats).
import { describe, expect, it } from "vitest";

import { BREATHE_MAX_SCALE, breatheScale, effectExtents, lyricScene, sceneTimeline, textCardLook, typedShare, typingPlan, typingWords, type EffectChoice, type SceneLine, type SceneOptions } from "../src";

const FPS = 30;
const LETTERS = [3, 3, 5]; // "one two three"
function lines(): SceneLine[] {
  return [0, 1, 2].map((k) => {
    const start = 30 + 90 * k;
    const stamp = start + 8;
    return { startFrame: start, endFrame: k < 2 ? start + 90 : start + 200, stampFrame: stamp, sungEndFrame: stamp + 30, isHook: k === 1, words: ["one", "two", "three"].map((t, w) => ({ text: t, startFrame: stamp + 10 * w, endFrame: stamp + 10 * (w + 1) })) };
  });
}
const options = (verse: EffectChoice, over: Partial<SceneOptions> = {}): SceneOptions => ({
  fps: FPS,
  durationInFrames: 600,
  verse,
  hook: verse,
  showNext: true,
  nextScale: 0.55,
  gapPx: 22,
  height: () => 74,
  wordCount: () => 3,
  wordLetters: () => [...LETTERS],
  ...over,
});
const typed = (words: { chars: number }[]) => words.reduce((n, w, k) => n + w.chars * LETTERS[k], 0);

describe("typewriter: letter by letter", () => {
  it("types one letter at a time, steadily, and every word is complete when it is sung", () => {
    const ls = lines();
    const t = sceneTimeline(ls, options({ name: "typewriter", intensity: "balanced" }));
    for (const [i, l] of ls.entries()) {
      let last = 0;
      for (let f = l.startFrame - 20; f <= l.words![2].startFrame; f++) {
        const item = lyricScene(t, f).find((x) => x.index === i);
        if (!item?.words) continue;
        const n = typed(item.words);
        expect(n, `line ${i} frame ${f} never goes back`).toBeGreaterThanOrEqual(last - 1e-9);
        expect(n - last, `line ${i} frame ${f}: a few letters a frame at most`).toBeLessThanOrEqual(3.01);
        last = n;
      }
      for (const [k, w] of l.words!.entries()) {
        const at = lyricScene(t, w.startFrame).find((x) => x.index === i)!.words![k];
        expect(at.chars, `line ${i} word ${k} typed by the time it is sung`).toBe(1);
      }
    }
  });

  it("the cursor follows the typing, then blinks softly after the last word", () => {
    const plan = typingPlan(0, [{ startFrame: 40, endFrame: 50 }, { startFrame: 50, endFrame: 60 }, { startFrame: 60, endFrame: 70 }], LETTERS, FPS);
    const mid = typingWords(plan, 8, FPS);
    expect(mid.filter((w) => w.cursor > 0).length).toBe(1);
    const done = 0 + plan.total / plan.perFrame;
    const after = [0, 8, 16].map((d) => typingWords(plan, Math.ceil(done) + d, FPS)[2].cursor);
    expect(Math.max(...after) - Math.min(...after)).toBeGreaterThan(0.2); // it blinks
    expect(typingWords(plan, Math.ceil(done) + 2, FPS).slice(0, 2).every((w) => w.cursor === 0)).toBe(true);
  });

  it("the intensity is the pace (calm / normal / quick), never behind the singer", () => {
    const slow = [{ startFrame: 200, endFrame: 210 }, { startFrame: 210, endFrame: 220 }, { startFrame: 220, endFrame: 230 }];
    const calm = typingPlan(0, slow, LETTERS, FPS, 0.6);
    const quick = typingPlan(0, slow, LETTERS, FPS, 1.5);
    expect(quick.perFrame).toBeGreaterThan(calm.perFrame);
    expect(Math.round(calm.perFrame * FPS)).toBe(8);
    expect(Math.round(quick.perFrame * FPS)).toBe(21);
    // A word sung right away: the pace rises for it, whatever the intensity.
    const fast = typingPlan(0, [{ startFrame: 6, endFrame: 10 }, { startFrame: 10, endFrame: 14 }, { startFrame: 14, endFrame: 20 }], LETTERS, FPS, 0.6);
    expect(typingWords(fast, 6, FPS)[0].chars).toBe(1);
    expect(typingWords(fast, 14, FPS)[2].chars).toBeGreaterThan(0);
  });

  it("typewriter-erase removes the letters right to left on the way out", () => {
    const ls = lines();
    const t = sceneTimeline(ls, options({ name: "typewriter-erase", intensity: "balanced" }));
    const last = ls[2];
    const shown = (f: number) => {
      const item = lyricScene(t, f).find((x) => x.index === 2);
      return item?.words ? typed(item.words) : 0;
    };
    expect(shown(last.endFrame - 13)).toBeCloseTo(11, 5);
    expect(shown(last.endFrame - 6)).toBeLessThan(11);
    expect(shown(last.endFrame - 6)).toBeGreaterThan(0);
    const late = lyricScene(t, last.endFrame - 2).find((x) => x.index === 2)!.words!;
    expect(late[2].chars).toBeLessThan(late[0].chars); // the last word goes first
  });

  it("a title card types in at a calm pace and is complete a second before it ends", () => {
    expect(typedShare(0, 20, 0, FPS)).toBe(0);
    expect(typedShare(0, 20, 30, FPS)).toBeCloseTo(0.7, 5); // 14 letters a second
    expect(typedShare(0, 40, 60, FPS, 60)).toBeCloseTo(1, 5); // a long title finishes in time (faster than the base pace)
    expect(typedShare(0, 40, 30, FPS, 60)).toBeCloseTo(0.5, 5);
    const look = textCardLook({ startFrame: 0, endFrame: 120, effect: { name: "typewriter", intensity: "balanced" }, text: "Tea with the Monk" }, 15, FPS)!;
    expect(look.chars).toBeGreaterThan(0);
    expect(look.chars).toBeLessThan(1);
  });
});

describe("spread", () => {
  it("letters gather close and open up to their spacing as the line comes in; never wider", () => {
    const ls = lines();
    const t = sceneTimeline(ls, options({ name: "spread", intensity: "balanced" }));
    const first = ls[0];
    const look = (f: number) => lyricScene(t, f).find((x) => x.index === 0)?.look;
    const early = look(first.startFrame - 10)!;
    expect(early.spacing).toBeLessThan(0);
    expect(early.opacity).toBeLessThan(1);
    expect(look(first.startFrame)!.spacing ?? 0).toBeCloseTo(0, 5); // readable at its usual time
    for (let f = 0; f < 600; f++) for (const s of lyricScene(t, f)) expect(s.look.spacing ?? 0, `frame ${f}`).toBeLessThanOrEqual(0);
    const card = textCardLook({ startFrame: 0, endFrame: 120, effect: { name: "spread", intensity: "balanced" } }, 5, FPS)!;
    expect(card.spacing).toBeLessThan(0);
  });
});

describe("breathe", () => {
  it("with the beat: largest on each downbeat, at most +3.5%, smooth", () => {
    const b = { mode: "beat" as const, downbeats: [0, 60, 120, 180] };
    expect(breatheScale(b, 60, FPS, true)).toBeCloseTo(BREATHE_MAX_SCALE, 5);
    expect(breatheScale(b, 90, FPS, true)).toBeCloseTo(1, 5); // half-way through the bar
    expect(breatheScale(b, 60, FPS, false)).toBeCloseTo(1.02, 5); // softer on verses
    for (let f = 1; f < 200; f++) expect(Math.abs(breatheScale(b, f, FPS, true) - breatheScale(b, f - 1, FPS, true))).toBeLessThan(0.003);
    for (let f = 0; f < 200; f++) expect(breatheScale(b, f, FPS, true)).toBeLessThanOrEqual(BREATHE_MAX_SCALE + 1e-9);
  });

  it("gentle: a slow swell every 4 s; off: nothing", () => {
    expect(breatheScale({ mode: "gentle" }, 0, FPS, false)).toBeCloseTo(1.02, 5);
    expect(breatheScale({ mode: "gentle" }, 60, FPS, false)).toBeCloseTo(1, 5);
    expect(breatheScale(null, 60, FPS, false)).toBe(1);
  });

  it("works with any effect and counts in the safe-zone box", () => {
    const ls = lines();
    const t = sceneTimeline(ls, options({ name: "glide", intensity: "balanced" }, { breathe: { mode: "beat", downbeats: [30, 90, 150] } }));
    const at = lyricScene(t, 150).find((x) => x.index === 1 && x.role === "active")!;
    expect(at.look.scale).toBeCloseTo(BREATHE_MAX_SCALE, 3); // line 1 is a hook, on a downbeat
    const without = effectExtents({ name: "glide", intensity: "balanced" }, { name: "glide", intensity: "balanced" }, FPS);
    const withIt = effectExtents({ name: "glide", intensity: "balanced" }, { name: "glide", intensity: "balanced" }, FPS, { mode: "gentle" });
    expect(withIt.maxScale).toBeCloseTo(without.maxScale * BREATHE_MAX_SCALE, 5);
  });
});
