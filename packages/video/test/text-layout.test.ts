// The theme's text layout (src/text-layout.ts): Centred, Lower third, Big hook. Inside every platform's
// safe zones, the same in the viewer patch and the render props.
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";
import { describe, expect, it } from "vitest";

import { patchLook } from "../src/look-patch";
import { defaultLyricVideoProps, type LyricVideoProps } from "../src/props";
import { lyricArea } from "../src/platform";
import { lyricBox, safeZoneProblem } from "../src/qa";
import { areaForLayout, BIG_HOOK_SCALE, lineScale, LOWER_THIRD_AT } from "../src/text-layout";
import { checkRecipe, loadPresets } from "../src/node";

const presets = loadPresets(path.join(REPO_ROOT, "presets", "platforms.json"));
const vertical = Object.values(presets).filter((p) => p.layout === "vertical");

describe("text layout", () => {
  it("Lower third sits lower than Centred, inside the usable area, on every vertical platform", () => {
    for (const p of vertical) {
      const format = { width: p.width, height: p.height };
      const base = lyricArea(format, p.safeZone, p.lyricsAt);
      const centre = areaForLayout(base, "centre", p.lyricsAt);
      const lower = areaForLayout(base, "lower", p.lyricsAt);
      expect(centre.centerY, p.name).toBe(base.centerY);
      expect(lower.centerY, p.name).toBeGreaterThan(centre.centerY);
      expect(lower.centerY, p.name).toBe(Math.round(base.top + (base.bottom - base.top) * LOWER_THIRD_AT));
      // Three lines of a big chorus (Big hook size, generous text size) plus the next line waiting below still clear the safe zone.
      const size = 84 * p.textScale * BIG_HOOK_SCALE;
      const box = lyricBox(3, size, (lower.right - lower.left) * 0.95, 1, lower);
      const withNext = { ...box, bottom: box.bottom + size * 0.55 * lower.lineHeight + size * 0.35 };
      expect(safeZoneProblem(withNext, false, format, p.safeZone), p.name).toBeNull();
    }
  });

  it("Big hook: chorus lines larger, verses and textboard cards as they are", () => {
    expect(lineScale({ isHook: true }, BIG_HOOK_SCALE)).toBe(BIG_HOOK_SCALE);
    expect(lineScale({ isHook: false }, BIG_HOOK_SCALE)).toBe(1);
    expect(lineScale({ isHook: true, card: { scale: 0.9 } }, BIG_HOOK_SCALE)).toBe(0.9);
    expect(lineScale({ isHook: true })).toBe(1);
  });

  it("the viewer patch moves the lyric area and sizes the chorus at once (not on YouTube's cover)", () => {
    const area = lyricArea({ width: 1080, height: 1920 }, { top: 0.14, bottom: 0.35, left: 0, right: 0.12 }, 0.45);
    const planned: LyricVideoProps = { ...defaultLyricVideoProps, lyricArea: area, lyricsAt: 0.45, lyricEffects: { verse: { name: "glide", intensity: "balanced" }, hook: { name: "glide", intensity: "balanced" }, accent: "#E8A3B5" } };
    const lower = patchLook(planned, { textLayout: "lower" });
    expect(lower.lyricArea!.centerY).toBeGreaterThan(area.centerY);
    expect(lower.lyricEffects!.hookScale).toBeUndefined();
    const big = patchLook(lower, { textLayout: "bighook" });
    expect(big.lyricArea!.centerY).toBe(area.centerY);
    expect(big.lyricEffects!.hookScale).toBe(BIG_HOOK_SCALE);
    expect(patchLook(big, { textLayout: "centre" }).lyricEffects!.hookScale).toBeUndefined();
    const cover = patchLook({ ...planned, layout: "cover" }, { textLayout: "lower" });
    expect(cover.lyricArea).toEqual(area);
  });

  it("is a theme / recipe setting with plain-word problems", () => {
    expect(checkRecipe({ textLayout: "lower" }).recipe.textLayout).toBe("lower");
    expect(checkRecipe({ textLayout: "left" }).problems.join(" ")).toMatch(/textLayout must be centre, lower, bighook/);
  });
});
