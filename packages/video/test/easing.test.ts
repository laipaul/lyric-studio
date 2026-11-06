// Our easing curves are Remotion's (the lyric effects moved off Remotion for the HyperFrames text layer).
import { Easing } from "remotion";
import { describe, expect, it } from "vitest";

import { cubicBezier } from "../src/easing";

describe("cubicBezier", () => {
  it("matches Remotion's Easing.bezier for the effects' curves", () => {
    const curves: [number, number, number, number][] = [[0.42, 0, 0.58, 1], [0, 0, 0.58, 1], [0.42, 0, 1, 1], [0.25, 0.1, 0.25, 1], [0.68, -0.6, 0.32, 1.6]];
    for (const [a, b, c, d] of curves) {
      const ours = cubicBezier(a, b, c, d);
      const theirs = Easing.bezier(a, b, c, d);
      for (let k = 0; k <= 1000; k++) expect(Math.abs(ours(k / 1000) - theirs(k / 1000))).toBeLessThan(1e-5);
    }
  });
});
