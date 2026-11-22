import { describe, expect, it } from "vitest";

import { backingShadow, BASE_TEXT_SHADOW, fallbackBackground, gradeLook, grainLayer, grainOffset, pictureOf, titleStyleCss, vignetteBackground, warpLetter } from "../src/picture";
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
  it("film grain (22 Nov 2026): off draws nothing; light and medium a noise tile drawn in the page, soft-light, no file", () => {
    expect(grainLayer("off")).toBeNull();
    expect(grainLayer(undefined)).toBeNull();
    const light = grainLayer("light")!;
    const medium = grainLayer("medium")!;
    const svg = decodeURIComponent(light.background.replace(/^url\("data:image\/svg\+xml,/, "").replace(/"\)$/, ""));
    expect(svg).toMatch(/^<svg .*feTurbulence/);
    expect(svg.match(/https?:\/\/[^'"]+/g)).toEqual(["http://www.w3.org/2000/svg"]); // a name, nothing fetched
    expect(light.background).not.toMatch(/[<>']/); // safe inside any HTML attribute or CSS value
    expect([light.blend, light.opacity < medium.opacity]).toEqual(["soft-light", true]);
    expect(pictureOf({ grain: "light" }).grain).toBe("light");
    expect(pictureOf({ grain: "heavy" }).grain).toBeUndefined();
    expect(checkRecipe({ grain: "medium" }).problems).toEqual([]);
    expect(checkRecipe({ grain: "heavy" }).problems[0]).toMatch(/grain must be off, light, medium/);
    expect(THEME_FIELDS).toContain("grain");
    expect(LIBRARY_RECIPE.grain).toBe("off");
  });
  it("the grain moves on every frame, the same way every time; the frame function stands alone (HyperFrames gets it as text)", () => {
    expect(grainOffset(12)).toBe(grainOffset(12));
    expect(new Set(Array.from({ length: 30 }, (_, f) => grainOffset(f))).size).toBeGreaterThan(25);
    for (let f = 0; f < 100; f++) expect(grainOffset(f)).toMatch(/^(1?\d{1,2})px (1?\d{1,2})px$/);
    const copy = new Function(`return (${grainOffset.toString()})`)() as (f: number) => string;
    expect([copy(0), copy(41), copy(900)]).toEqual([grainOffset(0), grainOffset(41), grainOffset(900)]);
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
  it("the title's style and shape (title cards only)", () => {
    expect(titleStyleCss("plain", 80, "#FFFFFF", "#E8A3B5")).toEqual({});
    expect(titleStyleCss("outline", 80, "#FFFFFF", "#E8A3B5").color).toBe("transparent");
    expect(String(titleStyleCss("extrude", 80, "#FFFFFF", "#FF0000").textShadow).split("),").length).toBe(7);
    expect(titleStyleCss("label", 80, "#FFFFFF", "#E8A3B5", 0.5).clipPath).toBe("inset(0 50.0% 0 0)"); // wiping in
    expect(titleStyleCss("label", 80, "#FFFFFF", "#E8A3B5", 1).clipPath).toBeUndefined();
    // Arc: the middle letter lifted most, the ends level and turned outwards.
    expect(warpLetter("arc", 2, 5, 100).y).toBeCloseTo(-28);
    expect(warpLetter("arc", 0, 5, 100).y).toBeCloseTo(0);
    expect(warpLetter("arc", 0, 5, 100).rotate).toBe(-16);
    expect(warpLetter("none", 3, 5, 100)).toEqual({ y: 0, rotate: 0 });
    expect(pictureOf({ titleStyle: "extrude", titleWarp: "arc" })).toMatchObject({ titleStyle: "extrude", titleWarp: "arc" });
    expect(pictureOf({ titleStyle: "plain" }).titleStyle).toBeUndefined();
    expect(checkRecipe({ titleStyle: "label", titleWarp: "wave" }).problems).toEqual([]);
  });
});
