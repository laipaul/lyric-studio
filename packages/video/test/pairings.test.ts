// Font weight / italic and font pairings: the exact file or the nearest with a warning (never a synthetic
// bold or italic), every bundled font with the French accents, the pairing presets (checked, applied to a
// song with locks respected, reset, saved to the brand only on request) and their card warnings.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACCENTS, applyPairing, BUNDLED_FONTS, checkRecipe, createSong, DEFAULT_BRAND, forText, loadBrand, loadFontCatalog, loadPairings, loadStyles, lockField,
  missingCharacters, pairingWarnings, pairingsView, parsePairings, readRecipe, resetPairing, resolveFont, savePairingToBrand, songPathsById, writeRecipe,
} from "../src/node";

const catalog = loadFontCatalog(path.join(os.tmpdir(), "no-workspace"));

describe("font weight and italic", () => {
  it("uses the exact weight and italic file; otherwise the nearest, with a warning naming what was used", () => {
    const exact = resolveFont(catalog, "Cormorant Garamond", 600, true, "hook font");
    expect([exact.face.weight, exact.face.style, exact.warnings]).toEqual([600, "italic", []]);
    expect(exact.face.files[0].src).toBe("_fonts/cormorant-garamond-latin-600-italic.woff2");
    const nearest = resolveFont(catalog, "Cormorant Garamond", 800, false, "verse font");
    expect([nearest.face.weight, nearest.warnings]).toEqual([700, ["verse font Cormorant Garamond has no weight 800: 700 used (it has 300, 400, 500, 600, 700; never a synthetic bold)"]]);
    const script = resolveFont(catalog, "Great Vibes", 400, true, "hook font");
    expect([script.face.style, script.warnings]).toEqual(["normal", ["hook font Great Vibes has no italic: upright used (never a synthetic italic)"]]);
  });

  it("the styles carry them into the props (weight, italic, the exact files) and name the fallbacks", () => {
    const ws = openWorkspace(mkdtempSync(path.join(os.tmpdir(), "lyric-pair-styles-")));
    const st = loadStyles(ws, catalog, { font: "Cormorant Garamond", fontHook: "Playfair Display", verse: { weight: 400 }, hook: { weight: 600, italic: true } });
    expect(st.simple.entry.style).toMatchObject({ font: "Cormorant Garamond", weight: 400 });
    expect(st.simple.entry.style.italic).toBeUndefined();
    expect(st.simple.entry.hookFont).toEqual({ font: "Playfair Display", weight: 600, italic: true });
    expect(st.bold.entry.style.weight).toBe(400); // the recipe's weight in every variation (Bold too)
    expect(st.simple.entry.fonts.map((f) => f.src)).toContain("_fonts/playfair-display-latin-600-italic.woff2");
    expect(st.simple.warnings).toEqual([]);
    expect(loadStyles(ws, catalog, { font: "Kaushan Script", verse: { weight: 700, italic: true } }).simple.warnings).toEqual([
      "verse font Kaushan Script has no italic: upright used (never a synthetic italic)",
      "verse font Kaushan Script has no weight 700: 400 used (it has 400; never a synthetic bold)",
    ]);
    ws.close();
  });

  it("song.json and perPlatform take weights and italic, every problem named", () => {
    expect(checkRecipe({ verseWeight: 600, hookItalic: true, perPlatform: { reels: { hookWeight: 700, hookItalic: false } } }).problems).toEqual([]);
    expect(checkRecipe({ verseWeight: 650, hookItalic: "yes", perPlatform: { reels: { hookWeight: 1000 } } }).problems).toEqual([
      "verseWeight must be a font weight: 100, 200, ... 900 (400 = regular, 600 = semibold, 700 = bold)",
      "hookItalic must be true or false",
      "perPlatform.reels.hookWeight must be a font weight: 100, 200, ... 900 (400 = regular, 600 = semibold, 700 = bold)",
    ]);
  });
});

describe("bundled fonts", () => {
  const added = ["Great Vibes", "EB Garamond", "Spline Sans", "Space Mono", "Bitter", "Grand Hotel", "Lato", "Abril Fatface", "Poppins", "Arima", "Mulish", "Noto Sans JP", "Noto Serif JP", "Special Elite", "Cormorant Garamond", "Playfair Display"];

  it("every family asked for is bundled, with the faces asked for", () => {
    const families = BUNDLED_FONTS.map(([, f]) => f);
    for (const f of added) expect(families).toContain(f);
    const has = (family: string, weight: number, italic = false) => resolveFont(catalog, family, weight, italic).warnings.length === 0;
    for (const [w, i] of [[400, false], [400, true], [500, false], [600, false], [600, true], [700, false]] as const) expect(has("Cormorant Garamond", w, i)).toBe(true);
    for (const [w, i] of [[400, false], [400, true], [600, true]] as const) expect(has("Playfair Display", w, i)).toBe(true);
  });

  it("they load with the French accents (é è ç à ô), and the Japanese families with Japanese", () => {
    for (const f of added) {
      const face = resolveFont(catalog, f, 400).face;
      expect(missingCharacters(forText(face, ACCENTS.join("")), ACCENTS), f).toEqual([]);
    }
    const jp = forText(resolveFont(catalog, "Noto Sans JP", 400).face, "君の名は");
    expect(jp.files.length).toBeLessThan(10); // only the pieces these words use, not all ~120
    expect(missingCharacters(jp, [..."君の名は"])).toEqual([]);
    expect(missingCharacters(forText(resolveFont(catalog, "Noto Serif JP", 400).face, "愛してる"), [..."愛してる"])).toEqual([]);
  });
});

describe("pairing presets", () => {
  it("presets/font-pairings.json: every font and weight exists; the brand's own fonts come first", () => {
    const { pairings, problems } = loadPairings(catalog, DEFAULT_BRAND);
    expect(problems).toEqual([]);
    expect(pairings.map((p) => p.id)).toEqual(["brand", "elegant", "dramatic", "romantic-script", "literary", "typewriter-story", "vintage-romance", "bold-statement", "gentle"]);
    expect(pairings[0]).toMatchObject({ name: "Current brand", brand: true, verse: { family: "Cormorant Garamond" }, hook: { family: "Kaushan Script" } });
    expect(pairings.find((p) => p.id === "elegant")).toMatchObject({ recommended: true, hook: { family: "Cormorant Garamond", weight: 600, italic: true } });
    expect(pairings.find((p) => p.id === "typewriter-story")!.title).toEqual({ family: "Special Elite", weight: 400, italic: false });
  });

  it("names a font or weight that does not exist", () => {
    const { problems } = parsePairings({ pairings: [{ id: "x", verse: { family: "Nope Sans" }, hook: { family: "Great Vibes", weight: 700, italic: true } }, { id: "Bad Id", verse: {}, hook: {} }] }, catalog);
    expect(problems).toEqual([
      'pairings[0] (x).verse: font "Nope Sans" not found (see pnpm fonts)',
      "pairings[0] (x).hook: Great Vibes has no 700 italic (it has 400)",
      'pairings[1] (Bad Id): id must be lower case letters, digits and "-"',
    ]);
  });

  it("card warnings: thin script on long hooks, characters the song uses, low contrast over the frame", () => {
    const { pairings } = loadPairings(catalog, DEFAULT_BRAND);
    const byId = (id: string) => pairings.find((p) => p.id === id)!;
    const ctx = { catalog, lyricsText: "Where the river meets the light\n* You had a heart for two, my love\n", hookLines: ["You had a heart for two, my love"], background: 0.02, colour: "#ffffff", accent: "#E8A3B5" };
    expect(pairingWarnings(byId("elegant"), ctx)).toEqual([]);
    expect(pairingWarnings(byId("romantic-script"), ctx)).toEqual([
      'Great Vibes is a thin script on a long hook line ("You had a heart for two, my love", 32 characters): hard to read on a phone; best on short hooks, set large',
      "Great Vibes is a thin script: short hooks only, and set them large.",
    ]);
    // A Japanese tagline: the Latin-only fonts lack it.
    const jp = pairingWarnings(byId("literary"), { ...ctx, lyricsText: "* 君の名は\nWhere the river meets the light\n", hookLines: ["君の名は"] });
    expect(jp).toContain("EB Garamond (verse) lacks 4 characters this song uses (君 の 名 は): they would show in another font");
    // A white frame behind the lyrics: white text has no contrast.
    const bright = pairingWarnings(byId("elegant"), { ...ctx, background: 0.95 });
    expect(bright[0]).toMatch(/^low contrast over this frame: the verse text is 1\.\d:1 against the brightest part behind it/);
    expect(bright[1]).toMatch(/^low contrast over this frame: the hook's accent colour is/);
  });
});

describe("pairings on a song", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-pairings-"));
  let ws: Workspace;
  let id: string;
  beforeAll(async () => {
    ws = openWorkspace(path.join(root, "workspace"));
    mkdirSync(path.join(root, "in"), { recursive: true });
    const song = path.join(root, "in", "A Heart For Two.wav");
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", song]);
    writeFileSync(path.join(root, "in", "lyrics.txt"), "Where the river meets the light\n* You had a heart for two\n");
    id = (await createSong(ws, { song, lyrics: path.join(root, "in", "lyrics.txt") })).id;
    const clips = songPathsById(ws, id).clips!;
    mkdirSync(clips, { recursive: true });
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0xf0ece4:s=216x384:d=1", "-pix_fmt", "yuv420p", path.join(clips, "01_dress.mp4")]); // a cream frame
  });
  afterAll(() => {
    ws?.close();
    rmSync(root, { recursive: true, force: true });
  });
  const brandFile = () => loadBrand(ws.dir, catalog, "Life Lyrics").file;

  it('"This song" applies the pair (fonts, weights, italic); the brand is untouched; Reset goes back to the brand', () => {
    const brandBefore = readFileSync(brandFile(), "utf8");
    expect(applyPairing(ws, id, "elegant")).toMatchObject({ applied: ["verseFont", "hookFont", "verseWeight", "hookWeight", "verseItalic", "hookItalic"], kept: [] });
    const song = readRecipe(songPathsById(ws, id).recipe);
    expect([song.verseFont, song.verseWeight, song.verseItalic, song.hookFont, song.hookWeight, song.hookItalic]).toEqual(["Cormorant Garamond", 400, false, "Cormorant Garamond", 600, true]);
    expect(readFileSync(brandFile(), "utf8")).toBe(brandBefore);
    resetPairing(ws, id);
    const reset = readRecipe(songPathsById(ws, id).recipe);
    expect([reset.verseFont, reset.hookFont, reset.verseWeight, reset.hookItalic]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("locks are respected (and named)", () => {
    const file = songPathsById(ws, id).recipe!;
    writeRecipe(file, lockField({ hookFont: "Kaushan Script" }, "hookFont", "Kaushan Script"));
    const r = applyPairing(ws, id, "dramatic");
    expect(r.kept).toEqual(["hookFont"]);
    expect(readRecipe(file).hookFont).toBe("Kaushan Script");
    expect(readRecipe(file).hookItalic).toBe(true); // the rest of the pair applied
    expect(resetPairing(ws, id).kept).toEqual(["hookFont"]);
    writeRecipe(file, {});
  });

  it('"Save to brand" writes the pair into the artist\'s brand.json (title too), checked', () => {
    const r = savePairingToBrand(ws, id, "typewriter-story");
    expect(r.file).toBe("brand/brand.json");
    const brand = JSON.parse(readFileSync(brandFile(), "utf8"));
    expect([brand.verseFont, brand.hookFont.family, brand.titleFont.family, brand.titleFont.letterSpacing]).toEqual([{ family: "Bitter", weight: 400, italic: false }, "Space Mono", "Special Elite", 0.18]);
    expect(() => savePairingToBrand(ws, id, "nope")).toThrow(/Unknown pairing "nope"/);
    savePairingToBrand(ws, id, "brand"); // still the brand's own (now Typewriter)
    writeFileSync(brandFile(), `${JSON.stringify({ verseFont: DEFAULT_BRAND.verseFont, hookFont: DEFAULT_BRAND.hookFont, titleFont: DEFAULT_BRAND.titleFont }, null, 2)}\n`);
  });

  it("the cards: the song's own lines over a frame of its clips, exact font files, warnings (a cream frame: low contrast)", async () => {
    const v = await pairingsView(ws, id);
    expect([v.verseLine, v.hookLine, v.backgroundFrom, v.platform]).toEqual(["Where the river meets the light", "You had a heart for two", "a frame of 01_dress.mp4", "Instagram Reels"]);
    expect(v.background).toMatch(/^thumbs\//);
    expect(v.userFonts).toBe(path.join(ws.dir, "fonts"));
    const elegant = v.cards.find((c) => c.id === "elegant")!;
    expect(elegant.fonts.map((f) => f.src)).toEqual(expect.arrayContaining(["_fonts/cormorant-garamond-latin-400-normal.woff2", "_fonts/cormorant-garamond-latin-600-italic.woff2"]));
    expect(elegant.warnings.some((w) => w.startsWith("low contrast over this frame"))).toBe(true);
    expect(v.cards.find((c) => c.brand)!.current).toBe(true); // the song uses its brand's fonts
    expect(v.highlightWords).toBe(3); // karaoke hooks: half the words sung
  });
});

