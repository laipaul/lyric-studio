// The Shape page's viewer: a look change patched into the planned props until the new plan arrives.
import { describe, expect, it } from "vitest";

import { patchChoice, patchLook } from "../src/look-patch";
import { defaultLyricVideoProps, type LyricVideoProps } from "../src/props";

const planned: LyricVideoProps = {
  ...defaultLyricVideoProps,
  style: { ...defaultLyricVideoProps.style, font: "Cormorant Garamond", weight: 400 },
  fonts: [{ family: "Cormorant Garamond", weight: 400, style: "normal", src: "_fonts/cg-400.woff2" }],
  lyricEffects: { verse: { name: "glide", intensity: "balanced", durationMs: 500 }, hook: { name: "karaoke-highlight", intensity: "balanced" }, accent: "#E8A3B5" },
};

describe("look patch", () => {
  it("leaves the props alone without a patch", () => {
    expect(patchLook(planned, null)).toBe(planned);
    expect(patchLook(planned, {})).toBe(planned);
  });

  it("swaps the fonts and adds their files once", () => {
    const face = { family: "Lato", weight: 700, italic: true, files: [{ family: "Lato", weight: 700, style: "italic" as const, src: "_fonts/lato-700i.woff2" }] };
    const p = patchLook(planned, { verse: face, hook: face });
    expect(p.style).toMatchObject({ font: "Lato", weight: 700, italic: true });
    expect(p.hookFont).toEqual({ font: "Lato", weight: 700, italic: true });
    expect(p.fonts.map((f) => f.src)).toEqual(["_fonts/cg-400.woff2", "_fonts/lato-700i.woff2"]);
    expect(planned.style.font).toBe("Cormorant Garamond"); // not mutated
  });

  it("sets the effects, keeping the planned timing of the same effect", () => {
    expect(patchChoice("glide:subtle", { name: "glide", intensity: "balanced", durationMs: 500 })).toEqual({ name: "glide", intensity: "subtle", durationMs: 500 });
    expect(patchChoice("typewriter", { name: "glide", intensity: "balanced", durationMs: 500 })).toEqual({ name: "typewriter", intensity: "balanced" });
    const p = patchLook(planned, { hookEffect: "typewriter:expressive", accent: "#FFFFFF" });
    expect(p.lyricEffects?.verse.name).toBe("glide");
    expect(p.lyricEffects?.hook).toEqual({ name: "typewriter", intensity: "expressive" });
    expect(p.lyricEffects?.accent).toBe("#FFFFFF");
  });

  it("turns Breathe and the add-ons on and off, with the bars for the beat and Shine", () => {
    const on = patchLook(planned, { breathe: "beat", shine: true, heldGlow: true }, [0, 60, 120]);
    expect(on.lyricEffects?.breathe).toEqual({ mode: "beat", downbeats: [0, 60, 120] });
    expect(on.lyricEffects?.shine).toBe(true);
    expect(on.lyricEffects?.heldGlow).toBe(true);
    expect(on.lyricEffects?.downbeats).toEqual([0, 60, 120]);
    const off = patchLook(on, { breathe: "off", shine: false, heldGlow: false });
    expect(off.lyricEffects?.breathe).toBeUndefined();
    expect(off.lyricEffects?.shine).toBeUndefined();
    expect(off.lyricEffects?.heldGlow).toBeUndefined();
  });
});
