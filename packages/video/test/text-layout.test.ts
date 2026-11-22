// The theme's text layout (src/text-layout.ts): Centred, Lower third, Big hook. Inside every platform's
// safe zones, the same in the viewer patch and the render props.
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";
import { describe, expect, it } from "vitest";

import { patchLook } from "../src/look-patch";
import { defaultLyricVideoProps, type LyricVideoProps } from "../src/props";
import { lyricArea } from "../src/platform";
import { lyricBox, safeZoneProblem } from "../src/qa";
import { areaForLayout, BIG_HOOK_SCALE, lineScale, LOWER_MARGIN } from "../src/text-layout";
import { checkRecipe, loadPresets } from "../src/node";
import { lyricScene, sceneTimeline } from "../src/effects/scene";

const presets = loadPresets(path.join(REPO_ROOT, "presets", "platforms.json"));
const vertical = Object.values(presets).filter((p) => p.layout === "vertical");

const frameOf = (p: (typeof vertical)[number]) => ({ width: p.width, height: p.height });

describe("text layout", () => {
  it("Lower third anchors the block's bottom on the usable area's bottom, rows grow upward, on every platform", () => {
    for (const p of Object.values(presets)) {
      const format = frameOf(p);
      const base = lyricArea(format, p.safeZone, p.lyricsAt);
      const centre = areaForLayout(base, "centre", p.lyricsAt, format.height);
      const lower = areaForLayout(base, "lower", p.lyricsAt, format.height);
      expect(centre, p.name).toEqual(base); // centre: pixel-identical to the plain area
      expect(lower.anchor, p.name).toBe("bottom");
      expect(lower.bottomMargin, p.name).toBe(Math.round(format.height * LOWER_MARGIN));
      for (const [rows, scale] of [[1, 1], [2, 1], [3, 1], [2, BIG_HOOK_SCALE], [3, BIG_HOOK_SCALE]] as const) {
        const size = 84 * p.textScale * scale;
        const width = (lower.right - lower.left) * 0.95;
        const box = lyricBox(rows, size, width, 1, lower);
        const plain = lyricBox(rows, size, width, 1, centre);
        const why = `${p.name} ${rows} rows x${scale}`;
        expect(Math.abs(box.bottom - (lower.bottom - lower.bottomMargin!)), why).toBeLessThanOrEqual(1);
        expect(box.top, why).toBeGreaterThanOrEqual(lower.top);
        expect(safeZoneProblem(box, false, format, p.safeZone), why).toBeNull();
        expect((box.top + box.bottom) / 2 - (plain.top + plain.bottom) / 2, why).toBeGreaterThanOrEqual(format.height * 0.08);
        // the waiting next line under it is inside the margin too
        const below = size * 0.35 + 0.55 * size * lower.lineHeight;
        const withNext = lyricBox(rows, size, width, 1, lower, below);
        expect(withNext.bottom + below, why).toBeCloseTo(lower.bottom - lower.bottomMargin!, 0);
        expect(withNext.top, why).toBeGreaterThanOrEqual(lower.top);
      }
    }
  });

  it("Lower third's block bottom, in % of the screen, per platform", () => {
    const at = (name: string) => {
      const p = presets[name];
      const format = frameOf(p);
      const lower = areaForLayout(lyricArea(format, p.safeZone, p.lyricsAt), "lower", p.lyricsAt, format.height);
      return Math.round((lyricBox(2, 84 * p.textScale, 600, 1, lower).bottom / format.height) * 100);
    };
    expect(at("reels")).toBeGreaterThanOrEqual(62);
    expect(at("reels")).toBeLessThanOrEqual(64);
    expect(at("tiktok")).toBeGreaterThanOrEqual(67);
    expect(at("tiktok")).toBeLessThanOrEqual(69);
    expect(at("shorts")).toBeGreaterThanOrEqual(72);
    expect(at("shorts")).toBeLessThanOrEqual(74);
    expect(at("youtube")).toBeGreaterThanOrEqual(86);
    expect(at("youtube")).toBeLessThanOrEqual(89);
  });

  it("switching layouts never keeps the old anchoring", () => {
    const base = lyricArea({ width: 1080, height: 1920 }, { top: 0.14, bottom: 0.35, left: 0, right: 0.12 }, 0.45);
    const lower = areaForLayout(base, "lower", 0.45, 1920);
    expect(areaForLayout(lower, "centre", 0.45, 1920)).toEqual(base);
    expect(areaForLayout(lower, "bighook", 0.45, 1920)).toEqual(base);
    expect(lower.centerY).toBeGreaterThan(base.centerY); // the typical block's centre: cards avoid it as before
  });

  it("a glide's waiting line starts exactly where it waited, even when the two lines sit at different heights", () => {
    const glide = { name: "glide" as const, intensity: "balanced" as const };
    const lines = [{ startFrame: 30, endFrame: 100 }, { startFrame: 100, endFrame: 170 }];
    const H = [200, 100]; // 2 rows, 1 row: bottom-anchored, so their centres differ
    const centre = [1000, 1050];
    const t = sceneTimeline(lines, { fps: 30, durationInFrames: 200, verse: glide, hook: glide, showNext: true, nextScale: 0.55, gapPx: 30, height: (i) => H[i], wordCount: () => 3, shift: (i) => (i > 0 ? centre[i - 1] - centre[i] : 0) });
    const f = t.enterStart[1];
    const next = lyricScene(t, f - 1).find((x) => x.index === 1)!;
    const active = lyricScene(t, f).find((x) => x.index === 1)!;
    expect(next.role).toBe("next");
    expect(centre[1] + active.look.y).toBeCloseTo(centre[0] + next.look.y, 0);
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
