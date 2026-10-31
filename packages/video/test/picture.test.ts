import { describe, expect, it } from "vitest";

import { backingShadow, BASE_TEXT_SHADOW, fallbackBackground, gradeLook, pictureOf, vignetteBackground } from "../src/picture";
import { patchLook } from "../src/look-patch";
import { defaultLyricVideoProps } from "../src/props";
import { checkRecipe, LIBRARY_RECIPE } from "../src/node/recipe";
import { checkTheme, THEME_FIELDS } from "../src/node/themes";

describe("the theme's picture", () => {
  it("natural changes nothing; every other grade draws a filter", () => {
    expect(gradeLook("natural")).toEqual({});
    for (const g of ["warm", "cool", "faded", "mono", "moody"] as const) expect(gradeLook(g).filter).toBeTruthy();
    expect(gradeLook("mono").filter).toContain("grayscale(1)");
  });
  it("vignette off draws nothing; soft and strong darken the edges", () => {
    expect(vignetteBackground("off")).toBeNull();
    expect(vignetteBackground("soft")).toContain("radial-gradient");
    expect(vignetteBackground("strong")).toContain("0.78");
  });
  it("behind the words: none keeps the light shadow every video has; glow is in the accent", () => {
    expect(backingShadow("none", "#E8A3B5")).toBe(BASE_TEXT_SHADOW);
    expect(backingShadow("glow", "#FF0000")).toContain("rgba(255,0,0");
  });
  it("the background without a clip: the plain colour, else a gradient in the accent", () => {
    expect(fallbackBackground({ fallback: "colour", fallbackColour: "#123456", accent: "#E8A3B5" })).toBe("#123456");
    expect(fallbackBackground({ fallback: "gradient", fallbackColour: "#123456", accent: "#FF0000" })).toContain("rgba(255,0,0");
    expect(fallbackBackground(null)).toBe("#000");
  });
  it("the Canvas keeps the clips' colours when gradeCanvas is off (and is graded by default)", () => {
    const v = { grade: "warm", gradeCanvas: "off", accentColour: "#E8A3B5" };
    expect(pictureOf(v, { canvas: true }).grade).toBe("natural");
    expect(pictureOf(v).grade).toBe("warm");
    expect(pictureOf({ grade: "warm" }, { canvas: true }).grade).toBe("warm");
    expect(pictureOf({ grade: "nonsense" }).grade).toBe("natural");
  });
  it("is part of a theme and of the recipe, checked like every setting", () => {
    for (const k of ["textColour", "grade", "vignette", "textBacking", "fallback", "fallbackColour", "gradeCanvas"]) expect(THEME_FIELDS).toContain(k);
    expect(LIBRARY_RECIPE.grade).toBe("natural");
    expect(LIBRARY_RECIPE.textColour).toBe("#FFFFFF");
    expect(checkRecipe({ grade: "warm", vignette: "soft", textBacking: "box", fallback: "cover", textColour: "#FAFAFA", gradeCanvas: "off" }).problems).toEqual([]);
    expect(checkRecipe({ grade: "sepia" }).problems[0]).toContain("grade must be natural");
    expect(checkRecipe({ textColour: "white" }).problems[0]).toContain("textColour");
    // An older theme.json without them: the library's defaults, no problem.
    const { theme, problems } = checkTheme({ name: "Old", look: { accentColour: "#E8A3B5" } });
    expect(problems).toEqual([]);
    expect(theme.look.grade).toBe("natural");
    expect(theme.look.fallback).toBe("gradient");
  });
  it("the viewer shows a draft's picture and text colour at once (patchLook)", () => {
    const picture = pictureOf({ grade: "cool", vignette: "strong", accentColour: "#E8A3B5" });
    const next = patchLook(defaultLyricVideoProps, { picture, colour: "#FFEEDD" });
    expect(next.picture?.grade).toBe("cool");
    expect(next.colour).toBe("#FFEEDD");
  });
});
