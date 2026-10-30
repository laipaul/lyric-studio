// Lyric readability is the app's job: with readability "auto" (the default) the render adds the soft
// dark band behind the lyrics when enough of the video's clips are too bright behind them; "strong" and
// "normal" stay the user's overrides.
import { describe, expect, it } from "vitest";

import { BRIGHT_SHARE, contrastWith, isThinFace, lyricBackingFor, lyricContrast } from "../src/readability";
import { checkRecipe, LIBRARY_RECIPE } from "../src/node";

const look = { colour: "#ffffff", accent: "#E8A3B5", verseThin: false, hookThin: false };
const DARK = 0.02; // a night clip behind the lyrics
const BRIGHT = 0.8; // a white dress / a sky behind the lyrics

describe("lyric readability", () => {
  it("contrast: white over a dark frame reads, over a bright one it does not; thin strokes need more", () => {
    expect(contrastWith("#ffffff", DARK)).toBeGreaterThan(10);
    expect(lyricContrast(DARK, look).low).toBe(false);
    expect(lyricContrast(BRIGHT, look).low).toBe(true);
    // Mid-grey: enough for a regular accent, not for a thin script.
    expect(lyricContrast(0.09, look).low).toBe(false);
    expect(lyricContrast(0.09, { ...look, hookThin: true }).low).toBe(true);
    expect([isThinFace("Great Vibes", 400), isThinFace("Lato", 300), isThinFace("Lato", 400), isThinFace("My Script", 400, "thin")]).toEqual([true, true, false, true]);
  });

  it('"auto" (the default) adds the backing when at least a quarter of the clips are bright behind the lyrics', () => {
    expect(BRIGHT_SHARE).toBe(0.25);
    const dark = lyricBackingFor("auto", [DARK, DARK, DARK, DARK], look);
    expect([dark.backing, dark.measured, dark.bright]).toEqual([false, 4, 0]);
    expect(dark.text).toBe("lyric readability auto: the lyrics read clearly over all 4 clips, no backing");
    const some = lyricBackingFor(undefined, [BRIGHT, DARK, DARK, DARK], look); // undefined = auto
    expect([some.backing, some.mode, some.bright]).toEqual([true, "auto", 1]);
    expect(some.text).toMatch(/1 of 4 clips are bright behind the lyrics, so a soft dark band goes behind them/);
    const few = lyricBackingFor("auto", [BRIGHT, ...Array(7).fill(DARK)], look); // 1 of 8: under a quarter
    expect(few.backing).toBe(false);
    expect(few.text).toMatch(/too few for a backing/);
    expect(lyricBackingFor("auto", [BRIGHT, BRIGHT, ...Array(6).fill(DARK)], look).backing).toBe(true); // 2 of 8
    // A clip that could not be measured does not count; nothing measured: no backing.
    expect(lyricBackingFor("auto", [null, null, BRIGHT], look).backing).toBe(true);
    expect(lyricBackingFor("auto", [], look)).toMatchObject({ backing: false, measured: 0 });
  });

  it('"strong" and "normal" stay the user\'s overrides', () => {
    expect(lyricBackingFor("strong", [DARK], look).backing).toBe(true);
    expect(lyricBackingFor("strong", [], look).backing).toBe(true);
    const normal = lyricBackingFor("normal", [BRIGHT, BRIGHT], look);
    expect(normal.backing).toBe(false);
    expect(normal.text).toBe("lyric readability normal (set by you): no backing (2 of 2 clips are bright behind the lyrics)");
  });

  it("the recipe: auto is the default; auto, normal and strong are accepted (also per platform)", () => {
    expect(LIBRARY_RECIPE.readability).toBe("auto");
    expect(checkRecipe({ readability: "auto", perPlatform: { reels: { readability: "auto" }, tiktok: { readability: "strong" } } }).problems).toEqual([]);
    expect(checkRecipe({ readability: "loud" }).problems).toEqual(["readability must be auto, normal or strong (auto = the app adds a soft backing behind the lyrics when the clips need it)"]);
  });
});
