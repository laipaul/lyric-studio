// Themes (31 Oct 2026): a song's look in themes\<name>\theme.json; the recipe order library -> brand ->
// theme -> song -> run; the move of a song's look into a theme; changes for every song or only this one.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyStyleAction,
  plainSongThemeNames,
  songLookAbout,
  writeTheme,
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
  brandThemes,
  setThemeCover,
  themeCoverVideo,
  setThemeDetails,
  removeThemeCover,
  themeCover,
  themesPageWithFrames,
  THEME_SAMPLE_LINES,
  artistDefaultTheme,
  resolveRecipe,
  restoreTheme,
  saveTheme,
  saveThemeAs,
  dropsPlatformValues,
  themesPageData,
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
    expect(data.theme?.name).toBe("Own Look look");
    expect(data.themes.map((t) => t.name)).toEqual(["Life Lyrics", "Own Look look"]);
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
    expect(song.theme).toBe("Own Look look");
    expect(song.verseEffect).toBeUndefined();
    expect(song.locked).toEqual(["tempo"]);
    expect(song.perPlatform).toEqual({ youtube: { length: 90 } });
    const theme = loadTheme(wsDir, "Own Look look", catalog);
    expect(theme.look.verseEffect).toBe("typewriter");
    expect(theme.perPlatform.youtube?.verseFont).toBe("Cinzel");
    const data = styleData(ws, ids["Own Look"]);
    const yt = data.fields.find((f) => f.field === "verseFont")!.perPlatform!.find((p) => p.platform === "youtube")!;
    expect([yt.value, yt.source]).toEqual(["Cinzel", "theme:youtube"]);
    expect(data.themes.map((t) => t.name)).toEqual(["Life Lyrics", "Own Look look"]);
    expect(data.themes.find((t) => t.name === "Life Lyrics")!.users.sort()).toEqual(["Plain", "Third"]);
  });

  it("a change for every song edits the theme; a change for this song copies a shared theme", () => {
    const catalog = loadFontCatalog(wsDir);
    setThemeLook(ws, { projectId: ids.Plain, values: { accentColour: "#112233" }, scope: "all", catalog });
    expect(loadTheme(wsDir, "Life Lyrics").look.accentColour).toBe("#112233");
    expect(themeUsers(ws, "Life Lyrics").length).toBe(2);
    const r = setThemeLook(ws, { projectId: ids.Plain, values: { verseEffect: "spread" }, scope: "song", catalog });
    expect(r).toEqual({ theme: "Plain look", copied: true });
    expect(readRecipe(songPathsById(ws, ids.Plain).recipe!).theme).toBe("Plain look");
    expect(loadTheme(wsDir, "Plain look").look.verseEffect).toBe("spread");
    expect(loadTheme(wsDir, "Plain look").look.accentColour).toBe("#112233");
    expect(loadTheme(wsDir, "Life Lyrics").look.verseEffect).not.toBe("spread"); // the other song keeps its look
    // A theme only this song uses is changed in place.
    expect(setThemeLook(ws, { projectId: ids.Plain, values: { verseEffect: "glide" }, scope: "song", catalog })).toEqual({ theme: "Plain look", copied: false });
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

  it("Same look on every platform: a Save that drops YouTube's own look keeps the theme as it was in _replaced", () => {
    const catalog = loadFontCatalog(wsDir);
    writeTheme(wsDir, { ...loadTheme(wsDir, "Life Lyrics"), name: "Highway" }); // edited from the Themes page: the song keeps its theme
    const look = { ...loadTheme(wsDir, "Highway").look, verseEffect: "typewriter:15" };
    saveTheme(ws, { projectId: ids.Third, theme: "Highway", look, perPlatform: { youtube: { verseEffect: "cinematic-fade" } }, catalog });
    const replaced = path.join(wsDir, "themes", "Highway", "_replaced");
    expect(existsSync(replaced)).toBe(false); // adding a platform value takes nothing away
    expect(themesPageData(ws).themes.find((t) => t.name === "Highway")?.differsOn).toEqual(["YouTube"]);
    saveTheme(ws, { projectId: ids.Third, theme: "Highway", look, perPlatform: {}, catalog }); // the switch on, then Save
    expect(loadTheme(wsDir, "Highway").perPlatform).toEqual({});
    const kept = readdirSync(replaced).filter((f) => /^theme-.*\.json$/.test(f));
    expect(kept).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(replaced, kept[0]), "utf8")).perPlatform).toEqual({ youtube: { verseEffect: "cinematic-fade" } });
    expect(themesPageData(ws).themes.find((t) => t.name === "Highway")?.differsOn).toEqual([]);
    saveTheme(ws, { projectId: ids.Third, theme: "Highway", look: { ...look, accentColour: "#00FFAA" }, perPlatform: {}, catalog });
    expect(readdirSync(replaced)).toHaveLength(1); // nothing dropped: no new copy
    expect(dropsPlatformValues({ youtube: { verseEffect: "glide" } }, { youtube: { verseEffect: "ink" } })).toBe(false);
    expect(dropsPlatformValues({ youtube: { verseEffect: "glide", hookEffect: "ink" } }, { youtube: { verseEffect: "glide" } })).toBe(true);
    expect(readRecipe(songPathsById(ws, ids.Third).recipe!).theme).not.toBe("Highway");
    rmSync(path.join(wsDir, "themes", "Highway"), { recursive: true, force: true }); // test only: leave the workspace as it was
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
    chooseTheme(ws, ids.Third, "Own Look look", catalog);
    expect(readRecipe(songPathsById(ws, ids.Third).recipe!).theme).toBe("Own Look look");
    const copy = duplicateTheme(wsDir, "Own Look look");
    expect(copy).toBe("Own Look look copy");
    expect(renameTheme(ws, "Own Look look", "Night Drive")).toBe("Night Drive");
    expect(themeUsers(ws, "Night Drive").map((u) => u.title).sort()).toEqual(["Own Look", "Third"]);
    expect(listThemes(wsDir).map((t) => t.name)).toEqual(["Life Lyrics", "Neon", "Neon Night", "Night Drive", "Own Look look copy", "Plain look"]);
    const file = songPathsById(ws, ids.Third).recipe!;
    writeFileSync(file, JSON.stringify({ theme: "Gone" }));
    expect(() => styleData(ws, ids.Third)).toThrow(/Theme "Gone" not found/);
    expect(() => chooseTheme(ws, ids.Third, "Nope", catalog)).toThrow(/Theme "Nope" not found/);
  });

  it("Theme cover: its own picture in the theme folder; none = a neutral backdrop, never a song's picture", async () => {
    const pic = path.join(root, "my cover.JPEG");
    writeFileSync(pic, "jpeg bytes");
    let page = await themesPageWithFrames(ws);
    expect(page.themes.every((t) => t.background === null)).toBe(true); // no song pictures borrowed
    expect(page.sampleLines).toEqual([...THEME_SAMPLE_LINES]);
    expect(() => setThemeCover(wsDir, "Life Lyrics", pic, "notes.txt")).toThrow(/JPG, PNG, WebP\) or a video/);
    const cover = setThemeCover(wsDir, "Life Lyrics", pic, "my cover.JPEG");
    expect(path.basename(cover)).toBe("cover.jpg");
    expect(existsSync(pic)).toBe(true); // copied, the original stays
    page = await themesPageWithFrames(ws);
    expect(page.themes.find((t) => t.name === "Life Lyrics")!.background).toMatch(/^themes\/Life Lyrics\/cover\.jpg\?v=\d+$/);
    const png = path.join(root, "b.png");
    writeFileSync(png, "png bytes");
    setThemeCover(wsDir, "Life Lyrics", png); // the old one goes to _replaced
    expect(path.basename(themeCover(wsDir, "Life Lyrics")!)).toBe("cover.png");
    const copy = duplicateTheme(wsDir, "Life Lyrics", "Cover Copy");
    expect(path.basename(themeCover(wsDir, copy)!)).toBe("cover.png"); // a duplicate keeps the cover
    removeThemeCover(wsDir, "Life Lyrics");
    expect(themeCover(wsDir, "Life Lyrics")).toBeNull();
    expect(readdirSync(path.join(wsDir, "themes", "Life Lyrics", "_replaced")).length).toBe(2); // nothing deleted
  });

  it("Theme cover from a video: kept as cover-video, its first frame the still cover; a broken video changes nothing", async () => {
    const clip = path.join(root, "mood.mp4");
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=teal:s=180x320:d=1", "-pix_fmt", "yuv420p", clip]);
    setThemeCover(wsDir, "Life Lyrics", clip, "Mood Clip.MP4");
    expect(path.basename(themeCoverVideo(wsDir, "Life Lyrics")!)).toBe("cover-video.mp4");
    expect(path.basename(themeCover(wsDir, "Life Lyrics")!)).toBe("cover.jpg");
    const t = (await themesPageWithFrames(ws)).themes.find((x) => x.name === "Life Lyrics")!;
    expect(t.background).toMatch(/cover\.jpg\?v=/);
    expect(t.backgroundVideo).toMatch(/cover-video\.mp4\?v=/);
    const broken = path.join(root, "broken.mp4");
    writeFileSync(broken, "not a video");
    expect(() => setThemeCover(wsDir, "Life Lyrics", broken, "broken.mp4")).toThrow(/could not be read/);
    expect(themeCoverVideo(wsDir, "Life Lyrics")).not.toBeNull(); // unchanged
    const pic = path.join(root, "still.png");
    writeFileSync(pic, "png bytes");
    setThemeCover(wsDir, "Life Lyrics", pic); // a picture replaces the video too
    expect(themeCoverVideo(wsDir, "Life Lyrics")).toBeNull();
    expect(path.basename(themeCover(wsDir, "Life Lyrics")!)).toBe("cover.png");
    removeThemeCover(wsDir, "Life Lyrics");
  });

  it("moods: ticked on the theme's page, kept in theme.json, checked in plain words", async () => {
    setThemeDetails(wsDir, "Life Lyrics", { moods: ["Night", "Romantic", "Spooky", "Night"] });
    expect(loadTheme(wsDir, "Life Lyrics").moods).toEqual(["Romantic", "Night"]);
    expect((await themesPageWithFrames(ws)).themes.find((t) => t.name === "Life Lyrics")!.moods).toEqual(["Romantic", "Night"]);
    setThemeDetails(wsDir, "Life Lyrics", { author: "Paul" }); // other details keep the moods
    expect(loadTheme(wsDir, "Life Lyrics").moods).toEqual(["Romantic", "Night"]);
    expect(checkTheme({ name: "X", moods: ["Sad"] }).problems.join(" ")).toMatch(/moods: "Sad" is not one of Romantic, Night/);
    expect(checkTheme({ name: "X" }).theme.moods).toEqual([]); // older themes: none
    setThemeDetails(wsDir, "Life Lyrics", { moods: [], author: "" });
  });

  it("renaming the artist's default theme keeps it the default (brand.json follows)", () => {
    const catalog = loadFontCatalog(wsDir);
    expect(brandThemes(ws, catalog).has("Life Lyrics")).toBe(true);
    expect(renameTheme(ws, "Life Lyrics", "Golden Dusk")).toBe("Golden Dusk");
    expect(brandThemes(ws, catalog).get("Golden Dusk")).toBe("Life Lyrics");
    expect(artistDefaultTheme(ws, "Life Lyrics", catalog)).toBe("Golden Dusk"); // no new "Life Lyrics" made
    expect(listThemes(wsDir).map((t) => t.name)).not.toContain("Life Lyrics");
    renameTheme(ws, "Golden Dusk", "Life Lyrics");
    expect(brandThemes(ws, catalog).has("Life Lyrics")).toBe(true);
  });
  it("a theme made from a song has a plain name ('<song> look') and says where it came from; old ones are renamed", () => {
    const catalog = loadFontCatalog(wsDir);
    expect(loadTheme(wsDir, "Night Drive").description) // the song "Own Look"'s theme, renamed above
      .toMatch(/^Made from Own Look's look on \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(songLookAbout("Hold On", "2026-10-29T10:00:00Z")).toBe("Made from Hold On's look on 29 Oct 2026");
    // A theme from before 1 Nov 2026, named like its song: renamed, the song follows, About says where it came from.
    const base = loadTheme(wsDir, "Life Lyrics", catalog);
    writeTheme(wsDir, { ...base, name: "Third", description: "The look Third had", createdAt: "2026-10-20T09:00:00Z" });
    chooseTheme(ws, ids.Third, "Third", catalog);
    expect(plainSongThemeNames(ws)).toEqual([{ from: "Third", to: "Third look" }]);
    expect(readRecipe(songPathsById(ws, ids.Third).recipe!).theme).toBe("Third look");
    expect(loadTheme(wsDir, "Third look").description).toBe("Made from Third's look on 20 Oct 2026");
    expect(plainSongThemeNames(ws)).toEqual([]); // once only; a theme the user named is never touched
  });
});
