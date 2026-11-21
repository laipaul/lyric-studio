// The lights-dim ending (21 Nov 2026, Paul: "fading with the studio light going to dim"): with a fade or ring-out
// the picture goes to black over the same frames as the music fade; a loop and the song's own end keep their picture.
import { describe, expect, it } from "vitest";

import { endDimOpacity, endDimSeconds, hyperframesGaps, runQa, type Ending } from "../src";

const ending = (kind: Ending["kind"], fadeOutS: number): Ending => ({ kind, requested: "auto", endMs: 150_000, fadeOutS, text: "", note: null });

describe("lights-dim ending", () => {
  it("dims with a fade or ring-out, over the music fade; never with a loop or at the song's own end", () => {
    expect(endDimSeconds(ending("fade", 1.5))).toBe(1.5);
    expect(endDimSeconds(ending("ring-out", 2.4))).toBe(2.4);
    expect(endDimSeconds(ending("loop", 0.12))).toBe(0);
    expect(endDimSeconds(ending("song-end", 0))).toBe(0);
    expect(endDimSeconds(null)).toBe(0);
  });

  it("is fully lit before the last frames, darkens slowly at first and is black on the last frame", () => {
    const d = 300;
    const f = 45;
    expect(endDimOpacity(d - f - 1, d, f)).toBe(0);
    const early = endDimOpacity(d - f + 5, d, f);
    const middle = endDimOpacity(d - Math.round(f / 2), d, f);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.1); // the light lingers
    expect(middle).toBeGreaterThan(0.4);
    expect(middle).toBeLessThan(0.6);
    expect(endDimOpacity(d - 1, d, f)).toBe(1);
    expect(endDimOpacity(10, d, 0)).toBe(0);
  });

  it("QA does not call the dim's own black a fault, but still reports black earlier in the video", () => {
    const props = { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 300, endDim: { frames: 45 } };
    const frames = { black: [{ start_s: 9.6, end_s: 10 }], frozen: [] };
    const check = (p: typeof props | Omit<typeof props, "endDim">) => runQa({ props: p, shotClips: [], poolSize: 8, lyrics: [], frames }).checks.find((c) => c.name === "Black or frozen frames")!;
    expect(check(props).ok).toBe(true);
    const { endDim: _e, ...noDim } = props;
    expect(check(noDim).ok).toBe(false);
    expect(runQa({ props, shotClips: [], poolSize: 8, lyrics: [], frames: { black: [{ start_s: 3, end_s: 3.5 }], frozen: [] } }).checks.find((c) => c.name === "Black or frozen frames")!.ok).toBe(false);
  });

  it("HyperFrames leaves it to the current renderer", () => {
    expect(hyperframesGaps({ shots: [{}], lyrics: [], endDim: { frames: 45 } } as never)).toContain("the lights-dim ending");
  });
});
