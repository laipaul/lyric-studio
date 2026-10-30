// The music-reactive add-ons: held-note glow (only on words held long, while held), chorus lift (only the
// first line of each chorus, full when settled, eased back), shine (one sweep on a chorus line, on a
// downbeat). Smooth, never on the waiting next line, and counted in QA's safe-zone box.
import { describe, expect, it } from "vitest";

import { effectExtents, heldGlow, HELD_GLOW_MAX, LIFT_MAX_SCALE, liftAt, lyricScene, sceneTimeline, shineAt, SHINE_FRAMES, type EffectChoice, type SceneLine, type SceneOptions } from "../src";

const FPS = 30;
const GLIDE: EffectChoice = { name: "glide", intensity: "balanced" };
// Lines 0 verse, 1-2 chorus, 3 verse, 4 chorus. Each: "one two three", the last word held 1.2 s.
function lines(): SceneLine[] {
  return [0, 1, 2, 3, 4].map((k) => {
    const start = 30 + 90 * k;
    const stamp = start + 8;
    return {
      startFrame: start,
      endFrame: k < 4 ? start + 90 : start + 200,
      stampFrame: stamp,
      sungEndFrame: stamp + 56,
      isHook: k === 1 || k === 2 || k === 4,
      words: [
        { text: "one", startFrame: stamp, endFrame: stamp + 10 },
        { text: "two", startFrame: stamp + 10, endFrame: stamp + 20 },
        { text: "three", startFrame: stamp + 20, endFrame: stamp + 56 },
      ],
    };
  });
}
const options = (accents: SceneOptions["accents"], verse = GLIDE): SceneOptions => ({
  fps: FPS,
  durationInFrames: 700,
  verse,
  hook: verse,
  showNext: true,
  nextScale: 0.55,
  gapPx: 22,
  height: () => 74,
  wordCount: () => 3,
  accents,
});
const at = (t: ReturnType<typeof sceneTimeline>, f: number, i: number) => lyricScene(t, f).find((x) => x.index === i && x.role !== "next");

describe("held-note glow", () => {
  it("only a word held long glows, rising while it is held and settling after", () => {
    const w = { startFrame: 100, endFrame: 136 };
    expect(heldGlow(99, w)).toBe(0);
    expect(heldGlow(118, w)).toBeGreaterThan(0.3);
    expect(heldGlow(136, w)).toBeCloseTo(HELD_GLOW_MAX, 5);
    expect(heldGlow(170, w)).toBe(0);
    expect(heldGlow(105, { startFrame: 100, endFrame: 110 })).toBe(0); // a short word: no glow
    for (let f = 99; f < 180; f++) expect(Math.abs(heldGlow(f, w) - heldGlow(f - 1, w))).toBeLessThan(0.12);
  });

  it("in the scene: the held word glows (also with a line effect), the others do not; off = nothing", () => {
    const ls = lines();
    for (const verse of [GLIDE, { name: "karaoke-highlight", intensity: "balanced" } as EffectChoice]) {
      const t = sceneTimeline(ls, options({ heldGlow: true }, verse));
      const words = at(t, ls[0].words![2].endFrame, 0)!.words!;
      expect(words[2].glow).toBeCloseTo(HELD_GLOW_MAX, 3);
      expect(words[0].glow ?? 0).toBe(0);
    }
    const off = sceneTimeline(ls, options(null));
    expect(at(off, ls[0].words![2].endFrame, 0)!.words).toBeNull();
  });
});

describe("chorus lift", () => {
  it("the first line of each chorus only: full when settled, eased back over 1.5 s", () => {
    const ls = lines();
    const t = sceneTimeline(ls, options({ chorusLift: true }));
    const plain = sceneTimeline(ls, options(null));
    const scale = (tt: typeof t, f: number, i: number) => at(tt, f, i)!.look.scale;
    expect(scale(t, ls[1].startFrame, 1)).toBeCloseTo(LIFT_MAX_SCALE * scale(plain, ls[1].startFrame, 1), 5); // chorus 1, first line
    expect(scale(t, ls[2].startFrame, 2)).toBeCloseTo(scale(plain, ls[2].startFrame, 2), 5); // second chorus line: no lift
    expect(scale(t, ls[4].startFrame, 4)).toBeGreaterThan(scale(plain, ls[4].startFrame, 4)); // chorus 2
    expect(scale(t, ls[0].startFrame, 0)).toBeCloseTo(scale(plain, ls[0].startFrame, 0), 5); // a verse
    expect(liftAt(ls[1].startFrame + 60, 0, ls[1].startFrame)).toBe(0);
    for (let f = 1; f < 600; f++) {
      const a = at(t, f - 1, 1);
      const b = at(t, f, 1);
      if (a && b && b.role === a.role) expect(Math.abs(b.look.scale - a.look.scale), `frame ${f}`).toBeLessThan(0.06);
    }
    const ext = effectExtents(GLIDE, GLIDE, FPS, null, true);
    expect(ext.maxScale).toBeCloseTo(effectExtents(GLIDE, GLIDE, FPS).maxScale * LIFT_MAX_SCALE, 5);
  });
});

describe("shine", () => {
  it("one sweep across each chorus line, on the first downbeat after it is settled", () => {
    const ls = lines();
    const downbeats = [0, 60, 120, 180, 240, 300, 360, 420, 480];
    const t = sceneTimeline(ls, options({ shine: true, downbeats }));
    const sweep = (i: number) => [...Array(700).keys()].filter((f) => at(t, f, i)?.look.shine !== undefined);
    const s1 = sweep(1);
    expect(s1[0]).toBe(120); // line 1 is settled at 120, a downbeat: the sweep starts there
    expect(s1.length).toBe(SHINE_FRAMES + 1);
    expect(sweep(0)).toEqual([]); // a verse: no shine
    expect(shineAt(120, 120, 210, downbeats)).toBe(0);
  });
});

describe("the settings", () => {
  it("song.json and per platform: off or on; a wrong value is named", async () => {
    const { checkRecipe } = await import("../src/node/recipe");
    expect(checkRecipe({ heldGlow: "on", chorusLift: "off", shine: "on" }).problems).toEqual([]);
    expect(checkRecipe({ shine: "yes" }).problems).toEqual(["shine must be off or on"]);
    expect(checkRecipe({ perPlatform: { reels: { chorusLift: "on" } } }).problems).toEqual([]);
    expect(checkRecipe({ perPlatform: { reels: { heldGlow: "maybe" } } }).problems[0]).toMatch(/heldGlow must be off or on/);
  });
});
