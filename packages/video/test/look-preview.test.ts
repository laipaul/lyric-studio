// The Style tab's Look preview helpers: the sample lines' timing, the exact font faces it loads, the
// tried Set effect state read back from sessionStorage, and the soft backing by the render's own rule.
import { describe, expect, it } from "vitest";

import { lookPreviewDuration, LOOK_LINE_FRAMES, parseTried, previewBacking, previewFace, previewLyrics } from "../src/look-preview";

const fonts = [
  {
    family: "Cormorant Garamond",
    faces: [
      { weight: 400, style: "normal", srcs: ["_fonts/cg-latin-400-normal.woff2", "_fonts/cg-latin-ext-400-normal.woff2"], ranges: ["U+0000-00FF", "U+0100-02BA"] },
      { weight: 600, style: "normal", srcs: ["_fonts/cg-latin-600-normal.woff2"], ranges: [null] },
      { weight: 600, style: "italic", srcs: ["_fonts/cg-latin-600-italic.woff2"] },
    ],
  },
  { family: "Lato", faces: [{ weight: 300, style: "normal", srcs: ["_fonts/lato-300.woff2"] }, { weight: 700, style: "normal", srcs: ["_fonts/lato-700.woff2"] }] },
];

describe("Look preview", () => {
  it("times the song's lines like sung lines, the middle one a hook", () => {
    const l = previewLyrics(["Where the river meets the light", "You had a heart for two", "Hold on"]);
    expect(l.map((x) => x.isHook)).toEqual([false, true, false]);
    expect(l.map((x) => x.startFrame)).toEqual([15, 15 + LOOK_LINE_FRAMES, 15 + 2 * LOOK_LINE_FRAMES]);
    expect(l[0].words?.map((w) => w.text)).toEqual(["Where", "the", "river", "meets", "the", "light"]);
    expect(l[2].endFrame).toBe(l[2].startFrame + LOOK_LINE_FRAMES + 30); // the last line is held longer
    expect(lookPreviewDuration(3)).toBe(3 * LOOK_LINE_FRAMES + 45);
  });

  it("loads the face a render uses: exact italic, else upright; nearest weight (heavier on a tie); unknown -> null", () => {
    const italic = previewFace(fonts, "cormorant garamond", 600, true)!;
    expect([italic.family, italic.weight, italic.italic, italic.files.map((f) => f.src)]).toEqual(["Cormorant Garamond", 600, true, ["_fonts/cg-latin-600-italic.woff2"]]);
    const regular = previewFace(fonts, "Cormorant Garamond", 400, false)!;
    expect(regular.files).toEqual([
      { family: "Cormorant Garamond", weight: 400, style: "normal", src: "_fonts/cg-latin-400-normal.woff2", unicodeRange: "U+0000-00FF" },
      { family: "Cormorant Garamond", weight: 400, style: "normal", src: "_fonts/cg-latin-ext-400-normal.woff2", unicodeRange: "U+0100-02BA" },
    ]);
    expect(previewFace(fonts, "Lato", 500, true)).toMatchObject({ weight: 700, italic: false }); // no italic: upright; 500 -> 700 on a tie
    expect(previewFace(fonts, "Nope", 400, false)).toBeNull();
  });

  it("reads back what Set effect tried; anything broken or unknown is ignored", () => {
    const names = ["glide", "typewriter"];
    const t = { name: "typewriter", intensity: "subtle", breathe: "beat", addOns: { heldGlow: true, chorusLift: false, shine: true } };
    expect(parseTried(JSON.stringify(t), names)).toEqual(t);
    expect(parseTried(JSON.stringify({ ...t, addOns: undefined }), names)?.addOns).toEqual({ heldGlow: false, chorusLift: false, shine: false });
    expect(parseTried(JSON.stringify({ ...t, name: "gone" }), names)).toBeNull();
    expect(parseTried(JSON.stringify({ ...t, breathe: "loud" }), names)).toBeNull();
    expect(parseTried("{not json", names)).toBeNull();
    expect(parseTried(null, names)).toBeNull();
  });

  it("shows the soft backing exactly when the render would add it over this frame", () => {
    const look = { colour: "#ffffff", accent: "#E8A3B5", verse: { family: "Lato", weight: 400 }, hook: { family: "Lato", weight: 400 } };
    expect(previewBacking("auto", 0.8, look)).toBe(true); // a bright frame behind the lyrics
    expect(previewBacking("auto", 0.02, look)).toBe(false); // a night clip
    expect(previewBacking(undefined, 0.8, look)).toBe(true); // undefined = auto
    expect(previewBacking("auto", null, look)).toBe(false); // no frame measured
    expect(previewBacking("strong", 0.02, look)).toBe(true);
    expect(previewBacking("normal", 0.8, look)).toBe(false);
    // Mid-grey: fine for a regular accent, too low for a thin script hook.
    expect(previewBacking("auto", 0.09, look)).toBe(false);
    expect(previewBacking("auto", 0.09, { ...look, hook: { family: "Great Vibes", weight: 400 } })).toBe(true);
  });
});
