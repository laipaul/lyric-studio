// Lines fit the lyric area WITH their effect's growth (1 Nov 2026: Here With Me's YouTube video was
// "Not ready" because hook lines, enlarged by the chorus lift, reached 33 px past the safe margin).
import { describe, expect, it } from "vitest";

import { effectExtents, restWidth } from "../src/effects/scene";

describe("rest width", () => {
  it("leaves room for the effect's scale and sideways drift", () => {
    const area = 1600;
    for (const [effect, lift] of [["glide", true], ["karaoke-highlight", true], ["soft-blur", false], ["glide", false]] as const) {
      const ext = effectExtents(effect, "glide", 30, null, lift);
      const w = restWidth(area, ext);
      expect(w * ext.maxScale + 2 * ext.side).toBeLessThanOrEqual(area + 0.001);
    }
  });
  it("is the whole area for a still line, never under 60%", () => {
    expect(restWidth(1000, { side: 0, maxScale: 1 })).toBe(1000);
    expect(restWidth(1000, { side: 400, maxScale: 2 })).toBe(600);
  });
});
