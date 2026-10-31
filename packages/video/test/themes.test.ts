// Themes (31 Oct 2026): a song's look in themes\<name>\theme.json; the recipe order library -> brand ->
// theme -> song -> run; the move of a song's look into a theme; changes for every song or only this one.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyStyleAction,
  checkTheme,
  createTheme,
  duplicateTheme,
  ensureSongTheme,
  findOrCreateSongProject,
  LIBRARY_RECIPE,
  listThemes,
  loadFontCatalog,
  loadTheme,
  readRecipe,
  removeTheme,
  removedThemes,
  renameTheme,
  resolveRecipe,
  restoreTheme,
  saveTheme,
  saveThemeAs,
  setThemeLook,
  songPathsById,
  styleData,
  themeUsers,
  chooseTheme,
  writeRecipe,
} from "../src/node";
import { makeSong } from "./media-helpers";

describe("the recipe with a theme", () => {
  const look = { ...LIBRARY_RECIPE, verseFont: "Inter", verseEffect: "typewriter", accentColour: "#33AAFF" };
  it("the theme sits above the brand and below the song and the run", () => {
    const r = resolveRecipe({ library: LIBRARY_RECIPE, artist: { verseFont: "Cinzel", hookFont: "Kaushan Script" }, theme: { look, perPlatform: { youtube: { verseEffect: "cinematic-fade" } } }, song: {} }, "youtube");
    expect([r.values.verseFont, r.sources.verseFont]).toEqual(["Inter", "theme"]);
    expect([r.values.verseEffect, r.sources.verseEffect]).toEqual(["cinematic-fade", "theme:youtube"]);
    const run = resolveRecipe({ library: LIBRARY_RECIPE, artist: {}, theme: { look, perPlatform: {} }, song: {}, run: { verseFont: "Cinzel" } });
    expect([run.values.verseFont, run.sources.verseFont]).toEqual(["Cinzel", "run"]);
  });
  it("theme.json is checked in plain words", () => {
    const bad = checkTheme({ name: "X", look: { verseEffect: "spin", accentColour: "pink", shotLength: "2" } });
    const text = bad.problems.join("\n");
    expect(text).toMatch(/verseEffect/);
    expect(text).toMatch(/accentColour/);
    expect(text).toMatch(/look.shotLength is not part of a theme/);
    const ok = checkTheme({ name: "Calm", look: { verseFont: "Inter" } });
    expect(ok.problems).toEqual([]);
    expect(ok.theme.look.hookFont).toBe(LIBRARY_RECIPE.hookFont); // missing fields: the library's
  });
});

describe("songs and themes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-themes-"));
  const wsDir = path.join(root, "workspace");
  const previous = process.env.WORKSPACE_DIR;
  let ws: Workspace;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.WORKSPACE_DIR = wsDir;
    mkdirSync(root, { recursive: true });
    ws = openWorkspace(wsDir);
    for (const [i, name] of ["Plain", "Own Look", "Third"].entries()) {
      const file = path.join(root, `${name}.wav`);
      makeSong(file, 4 + i); // different audio: a song is known by its sound
      ids[name] = (await findOrCreateSongProject(ws, file)).project.id;
    }
    // "Own Look" set its own effect and a YouTube font before themes; it locked the effect.
    const file = songPathsById(ws, ids["Own Look"]).recipe!;
    writeRecipe(file, { verseEffect: "typewriter", perPlatform: { youtube: { verseFont: "Cinzel", length: 90 } }, locked: ["verseEffect", "tempo"], tempo: 92 });
  }, 120_000);
  afterAll(() => {
    ws?.close();
    if (previous === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });

  it("the Theme panel offers every song's theme and the brand's default theme from the start", () => {
    const data = styleData(ws, ids["Own Look"]); // the first song opened has its own look
    expect(data.theme?.name).toBe("Own Look");
    expect(data.themes.map((t) => t.name)).toEqual(["Life Lyrics", "Own Look"]);
    expect(data.themes.find((t) => t.name === "Life Lyrics")!.users.sort()).toEqual(["Plain", "Third"]);
  });

  it("a song without a look of its own moves to the artist's default theme; nothing looks different", () => {
    const catalog = loadFontCatalog(wsDir);
    const before = resolveRecipe({ library: LIBRARY_RECIPE, artist: {}, song: {} }).values;
    const song = ensureSongTheme(ws, ids.Plain, catalog);
    expect(song.theme).toBe("Life Lyrics");
    const theme = loadTheme(wsDir, "Life Lyrics", catalog);
    expect(theme.look.verseFont).toBe(before.verseFont);
    expect(JSON.parse(readFileSync(path.join(wsDir, "brand", "brand.json"), "utf8")).theme).toBe("Life Lyrics");
    expect(ensureSongTheme(ws, ids.Third, catalog).theme).toBe("Life Lyrics"); // the same default theme
  });

  it("a song with its own look gets a theme named after it; song.json keeps only the rest", () => {
    const catalog = loadFontCatalog(wsDir);
    const before = styleData(ws, ids.Plain); // (any song: makes sure styleData works with themes)
    expect(before.theme?.name).toBe("Life Lyrics");
    const song = ensureSongTheme(ws, ids["Own Look"], catalog);
    expect(song.theme).toBe("Own Look");
    expect(song.verseEffect).toBeUndefined();
    expect(song.locked).toEqual(["tempo"]);
    expect(song.perPlatform).toEqual({ youtube: { length: 90 } });
    const theme = loadTheme(wsDir, "Own Look", catalog);
    expect(theme.look.verseEffect).toBe("typewriter");
    expect(theme.perPlatform.youtube?.verseFont).toBe("Cinzel");
    const data = styleData(ws, ids["Own Look"]);
    const yt = data.fields.find((f) => f.field === "verseFont")!.perPlatform!.find((p) => p.platform === "youtube")!;
    expect([yt.value, yt.source]).toEqual(["Cinzel", "theme:youtube"]);
    expect(data.themes.map((t) => t.name)).toEqual(["Life Lyrics", "Own Look"]);
    expect(data.themes.find((t) => t.name === "Life Lyrics")!.users.sort()).toEqual(["Plain", "Third"]);
  });

  it("a change for every song edits the theme; a change for this song copies a shared theme", () => {
    const catalog = loadFontCatalog(wsDir);
    setThemeLook(ws, { projectId: ids.Plain, values: { accentColour: "#112233" }, scope: "all", catalog });
    expect(loadTheme(wsDir, "Life Lyrics").look.accentColour).toBe("#112233");
    expect(themeUsers(ws, "Life Lyrics").length).toBe(2);
    const r = setThemeLook(ws, { projectId: ids.Plain, values: { verseEffect: "spread" }, scope: "song", catalog });
    expect(r).toEqual({ theme: "Plain", copied: true });
    expect(readRecipe(songPathsById(ws, ids.Plain).recipe!).theme).toBe("Plain");
    expect(loadTheme(wsDir, "Plain").look.verseEffect).toBe("spread");
    expect(loadTheme(wsDir, "Plain").look.accentColour).toBe("#112233");
    expect(loadTheme(wsDir, "Life Lyrics").look.verseEffect).not.toBe("spread"); // the other song keeps its look
    // A theme only this song uses is changed in place.
    expect(setThemeLook(ws, { projectId: ids.Plain, values: { verseEffect: "glide" }, scope: "song", catalog })).toEqual({ theme: "Plain", copied: false });
  });

  it("the Style actions on a theme setting go to the theme; lock and reset are not offered", () => {
    applyStyleAction(ws, ids.Third, { action: "set", field: "hookEffect", value: "typewriter", scope: "all" });
    expect(loadTheme(wsDir, "Life Lyrics").look.hookEffect).toBe("typewriter");
    applyStyleAction(ws, ids.Third, { action: "set", field: "hookEffect", value: "spread", platform: "youtube" });
    expect(loadTheme(wsDir, "Life Lyrics").perPlatform.youtube?.hookEffect).toBe("spread");
    applyStyleAction(ws, ids.Third, { action: "reset", field: "hookEffect", platform: "youtube" });
    expect(loadTheme(wsDir, "Life Lyrics").perPlatform.youtube).toBeUndefined();
    expect(() => applyStyleAction(ws, ids.Third, { action: "lock", field: "hookEffect" })).toThrow(/part of the song's theme/);
    expect(() => applyStyleAction(ws, ids.Third, { action: "set", field: "accentColour", value: "pink" })).toThrow(/accentColour/);
    expect(readRecipe(songPathsById(ws, ids.Third).recipe!).hookEffect).toBeUndefined();
  });

  it("the editor: New theme (named first), Save for every song, Save as new theme, Delete and Restore", () => {
    const catalog = loadFontCatalog(wsDir);
    expect(() => createTheme(ws, { projectId: ids.Third, name: "Life Lyrics", from: "Life Lyrics", catalog })).toThrow(/already exists/);
    expect(createTheme(ws, { projectId: ids.Third, name: "Neon", from: "Life Lyrics", catalog })).toBe("Neon");
    expect(readRecipe(songPathsById(ws, ids.Third).recipe!).theme).toBe("Neon");
    const look = { ...loadTheme(wsDir, "Neon").look, accentColour: "#00FFAA", verseEffect: "ink" };
    saveTheme(ws, { projectId: ids.Third, look, perPlatform: { youtube: { hookEffect: "spread" } }, catalog });
    expect(loadTheme(wsDir, "Neon").look.accentColour).toBe("#00FFAA");
    expect(loadTheme(wsDir, "Neon").perPlatform).toEqual({ youtube: { hookEffect: "spread" } });
    expect(() => saveTheme(ws, { projectId: ids.Third, look: { ...look, accentColour: "pink" }, perPlatform: {}, catalog })).toThrow(/accentColour/);
    expect(saveThemeAs(ws, { projectId: ids.Third, name: "Neon Night", look: { ...look, verseEffect: "glide" }, perPlatform: {}, catalog })).toBe("Neon Night");
    expect(loadTheme(wsDir, "Neon").look.verseEffect).toBe("ink"); // the theme it came from stays
    expect(readRecipe(songPathsById(ws, ids.Third).recipe!).theme).toBe("Neon Night");
    expect(() => removeTheme(ws, "Neon Night", catalog)).toThrow(/1 song uses "Neon Night" \(Third\)/);
    expect(() => removeTheme(ws, "Life Lyrics", catalog)).toThrow(/new songs of Life Lyrics start on/);
    removeTheme(ws, "Neon", catalog);
    expect(listThemes(wsDir).map((t) => t.name)).not.toContain("Neon");
    const removed = removedThemes(wsDir);
    expect(removed.map((r) => r.name)).toEqual(["Neon"]);
    expect(restoreTheme(wsDir, removed[0].folder)).toBe("Neon");
    expect(loadTheme(wsDir, "Neon").look.verseEffect).toBe("ink");
    chooseTheme(ws, ids.Third, "Life Lyrics", catalog);
  });

  it("use, duplicate and rename; a missing theme is named", () => {
    const catalog = loadFontCatalog(wsDir);
    chooseTheme(ws, ids.Third, "Own Look", catalog);
    expect(readRecipe(songPathsById(ws, ids.Third).recipe!).theme).toBe("Own Look");
    const copy = duplicateTheme(wsDir, "Own Look");
    expect(copy).toBe("Own Look copy");
    expect(renameTheme(ws, "Own Look", "Night Drive")).toBe("Night Drive");
    expect(themeUsers(ws, "Night Drive").map((u) => u.title).sort()).toEqual(["Own Look", "Third"]);
    expect(listThemes(wsDir).map((t) => t.name)).toEqual(["Life Lyrics", "Neon", "Neon Night", "Night Drive", "Own Look copy", "Plain"]);
    const file = songPathsById(ws, ids.Third).recipe!;
    writeFileSync(file, JSON.stringify({ theme: "Gone" }));
    expect(() => styleData(ws, ids.Third)).toThrow(/Theme "Gone" not found/);
    expect(() => chooseTheme(ws, ids.Third, "Nope", catalog)).toThrow(/Theme "Nope" not found/);
  });
});
