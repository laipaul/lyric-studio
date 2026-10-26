// Step 6.2c-2a: per-platform recipe values (brand.json and song.json "perPlatform"), the Style tab
// (values with their source, set / reset / lock / unlock, fonts with the French-accent check), Generate
// starting from the recipe with "save to song", and pnpm make using the right value per platform.
// Also the Assets tab's hints check (timed lines, end marks, orphans).
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, project, seedStylePresets, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyStyleAction,
  bundledFontDirs,
  checkHints,
  checkRecipe,
  findOrCreateSongProject,
  generatePanelData,
  LIBRARY_RECIPE,
  loadBrand,
  loadFontCatalog,
  lockField,
  makeVideos,
  readManifest,
  readRecipe,
  resetField,
  resolveRecipe,
  saveRunToSong,
  setField,
  songPathsById,
  styleData,
  writeRecipe,
  type RecipeInput,
  type RenderOptions,
} from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const artist = { verseEffect: "glide", hookEffect: "karaoke-highlight", verseFont: "Cormorant Garamond", hookFont: "Kaushan Script", accentColour: "#E8A3B5" };
const input = (extra: Partial<RecipeInput> = {}): RecipeInput => ({
  library: LIBRARY_RECIPE,
  artist,
  artistPlatforms: { youtube: { verseEffect: "cinematic-fade" } },
  presets: { reels: { hookEffect: "word-reveal" } },
  song: {},
  ...extra,
});

describe("per-platform values: library -> artist -> platforms.json -> artist (platform) -> song -> song (platform) -> run", () => {
  it("each platform gets its own value and source", () => {
    expect(resolveRecipe(input()).values.verseEffect).toBe("glide"); // the default (no platform)
    const yt = resolveRecipe(input(), "youtube");
    expect([yt.values.verseEffect, yt.sources.verseEffect]).toEqual(["cinematic-fade", "artist:youtube"]);
    const reels = resolveRecipe(input(), "reels");
    expect([reels.values.verseEffect, reels.sources.verseEffect, reels.values.hookEffect, reels.sources.hookEffect]).toEqual(["glide", "artist", "word-reveal", "platforms.json"]);
    // The song's default is above the brand's per-platform value; the song's per-platform value above that.
    const song = { verseEffect: "soft-blur", perPlatform: { tiktok: { verseEffect: "typewriter" } } };
    expect(resolveRecipe(input({ song }), "youtube").sources.verseEffect).toBe("song");
    expect(resolveRecipe(input({ song }), "tiktok")).toMatchObject({ values: { verseEffect: "typewriter" }, sources: { verseEffect: "song:tiktok" } });
    expect(resolveRecipe(input({ song, run: { verseEffect: "floating" } }), "tiktok").values.verseEffect).toBe("floating"); // a run choice is for every platform
  });

  it("a locked field uses only the song's values: no brand change reaches it, a run cannot change it", () => {
    const song = { verseEffect: "glide", perPlatform: { youtube: { verseEffect: "dreamy-glow" } }, locked: ["verseEffect" as const] };
    const brandChanged = input({ song, artist: { ...artist, verseEffect: "typewriter" }, artistPlatforms: { youtube: { verseEffect: "word-reveal" }, reels: { verseEffect: "floating" } }, run: { verseEffect: "soft-blur" } });
    expect(resolveRecipe(brandChanged, "reels")).toMatchObject({ values: { verseEffect: "glide" }, sources: { verseEffect: "song" } });
    const yt = resolveRecipe(brandChanged, "youtube");
    expect([yt.values.verseEffect, yt.sources.verseEffect]).toEqual(["dreamy-glow", "song:youtube"]);
    expect(yt.ignored).toEqual([{ field: "verseEffect", run: "soft-blur", kept: "dreamy-glow" }]);
  });

  it("locking keeps the per-platform values seen now; set / reset per platform", () => {
    const locked = lockField({}, "verseEffect", "glide", { youtube: "cinematic-fade", reels: "glide" });
    expect(locked).toEqual({ verseEffect: "glide", perPlatform: { youtube: { verseEffect: "cinematic-fade" } }, locked: ["verseEffect"] });
    const set = setField({}, "hookEffect", "word-reveal:subtle", "reels");
    expect(set).toEqual({ perPlatform: { reels: { hookEffect: "word-reveal:subtle" } } });
    expect(resetField(set, "hookEffect", "reels")).toEqual({});
    expect(() => setField({}, "collections", ["x"], "reels")).toThrow(/cannot differ per platform/);
  });

  it("song.json and brand.json perPlatform are checked", () => {
    expect(checkRecipe({ perPlatform: { youtube: { verseEffect: "spin", collections: ["x"], accentColour: "pink" } } }).problems).toEqual([
      expect.stringMatching(/perPlatform.youtube.verseEffect: unknown effect "spin"/),
      "perPlatform.youtube.collections: only verseEffect, hookEffect, verseFont, hookFont, accentColour, section can differ per platform",
      'perPlatform.youtube.accentColour must look like "#E8A3B5"',
    ]);
    expect(checkRecipe({ verseEffect: "wobble" }).problems[0]).toMatch(/verseEffect: unknown effect "wobble"/);
  });
});

describe("the Style tab, Generate and pnpm make", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-style-"));
  const wsDir = path.join(root, "workspace");
  const song = path.join(root, "Night Call.wav");
  const sample = path.join(root, "sample.mp4");
  const previousWorkspace = process.env.WORKSPACE_DIR;
  let ws: Workspace;
  let id: string;
  const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);

  beforeAll(async () => {
    process.env.WORKSPACE_DIR = wsDir;
    mkdirSync(root, { recursive: true });
    makeSong(song, 20);
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
    mkdirSync(path.join(wsDir, "collections", "wedding"), { recursive: true });
    makeClip(path.join(wsDir, "collections", "wedding", "01_a.mp4"), 6, "blue");
    makeClip(path.join(wsDir, "collections", "wedding", "02_b.mp4"), 6, "yellow");
    // A font of your own without the French accents (only the latin-ext part of a bundled font).
    mkdirSync(path.join(wsDir, "fonts"), { recursive: true });
    copyFileSync(path.join(bundledFontDirs()["cormorant-garamond"], "cormorant-garamond-latin-ext-600-normal.woff2"), path.join(wsDir, "fonts", "NoAccents.woff2"));
    ws = openWorkspace(wsDir);
    seedStylePresets(ws.db);
    id = (await findOrCreateSongProject(ws, song)).project.id;
    writeFileSync(path.join(songPathsById(ws, id).root, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  }, 120_000);
  afterAll(() => {
    ws?.close();
    if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = previousWorkspace;
    rmSync(root, { recursive: true, force: true });
  });

  it("brand.json perPlatform is read and checked", () => {
    const brandFile = path.join(wsDir, "brand", "brand.json");
    loadBrand(wsDir, loadFontCatalog(wsDir)); // creates it
    const raw = JSON.parse(readFileSync(brandFile, "utf8"));
    writeFileSync(brandFile, JSON.stringify({ ...raw, perPlatform: { tiktok: { verseEffect: "spin", verseFont: "Nope Sans" } } }));
    expect(() => loadBrand(wsDir, loadFontCatalog(wsDir))).toThrow(/perPlatform.tiktok.verseEffect: unknown effect "spin"[\s\S]*perPlatform.tiktok.verseFont: font "Nope Sans" not found/);
    writeFileSync(brandFile, JSON.stringify({ ...raw, perPlatform: { tiktok: { verseEffect: "cinematic-fade" } } }));
    expect(loadBrand(wsDir, loadFontCatalog(wsDir)).brand.perPlatform).toEqual({ tiktok: { verseEffect: "cinematic-fade" } });
  });

  it("styleData: every setting with value and source, per platform, and fonts with the accent check", () => {
    const d = styleData(ws, id);
    const verse = d.fields.find((f) => f.field === "verseEffect")!;
    expect([verse.value, verse.source, verse.own, verse.locked]).toEqual(["glide", "artist", false, false]);
    expect(verse.perPlatform!.find((p) => p.platform === "tiktok")).toMatchObject({ value: "cinematic-fade", source: "artist:tiktok", own: false });
    expect(d.fields.find((f) => f.field === "collections")!.perPlatform).toBeNull();
    expect(d.fonts.find((f) => f.family === "Cormorant Garamond" && f.source === "bundled")!.missing).toEqual([]);
    expect(d.fonts.find((f) => f.source === "user")).toMatchObject({ missing: ["é", "è", "ç", "à", "ô", "É", "È", "Ç", "À", "Ô"] });
    expect(d.previewLine).toMatch(/é.*à.*ô.*ç/);
  });

  it("set / reset / lock / unlock write song.json; bad values are refused", () => {
    applyStyleAction(ws, id, { action: "set", field: "verseEffect", value: "soft-blur:subtle", platform: "reels" });
    applyStyleAction(ws, id, { action: "set", field: "collections", value: ["wedding"] });
    applyStyleAction(ws, id, { action: "lock", field: "hookEffect" });
    const file = songPathsById(ws, id).recipe!;
    expect(readRecipe(file)).toEqual({ hookEffect: "karaoke-highlight", collections: ["wedding"], perPlatform: { reels: { verseEffect: "soft-blur:subtle" } }, locked: ["hookEffect"] });
    const d = styleData(ws, id);
    expect(d.fields.find((f) => f.field === "verseEffect")!.perPlatform!.find((p) => p.platform === "reels")).toMatchObject({ value: "soft-blur:subtle", source: "song:reels", own: true });
    expect(d.fields.find((f) => f.field === "hookEffect")).toMatchObject({ locked: true, own: true, source: "song" });
    expect(() => applyStyleAction(ws, id, { action: "set", field: "verseFont", value: "Nope Sans" })).toThrow(/font "Nope Sans" not found/);
    expect(() => applyStyleAction(ws, id, { action: "set", field: "accentColour", value: "pink" })).toThrow(/accentColour must look like/);
    applyStyleAction(ws, id, { action: "unlock", field: "hookEffect" });
    applyStyleAction(ws, id, { action: "reset", field: "hookEffect" });
    expect(readRecipe(file).hookEffect).toBeUndefined();
  });

  it("Generate starts from the recipe; save to song keeps locked settings", () => {
    const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
    const g = generatePanelData(ws, p);
    expect(g.verseEffect).toBe("glide");
    expect(g.recipe.effects.reels).toEqual({ verse: "soft-blur:subtle", hook: "karaoke-highlight" });
    expect(g.recipe.effects.tiktok).toEqual({ verse: "cinematic-fade", hook: "karaoke-highlight" });
    expect(g.chosen).toEqual(["wedding"]);
    const file = songPathsById(ws, id).recipe!;
    writeRecipe(file, { ...readRecipe(file), section: "full", locked: ["section"] });
    expect(generatePanelData(ws, p).recipe).toMatchObject({ section: "full", locked: ["section"] });
    const r = saveRunToSong(ws, id, { section: "0:10-0:40", hookEffect: "word-reveal", lineEffect: undefined });
    expect(r).toEqual({ saved: ["hookEffect"], kept: ["section"] });
    expect(readRecipe(file)).toMatchObject({ section: "full", hookEffect: "word-reveal" });
    writeRecipe(file, { collections: ["wedding"], perPlatform: { reels: { verseEffect: "soft-blur:subtle" } } });
  });

  it("pnpm make uses the right value per platform (song, brand and platforms.json levels) and says so", async () => {
    const logs: string[] = [];
    const r = await makeVideos({
      workspaceDir: wsDir, song, lyrics: path.join(songPathsById(ws, id).root, "lyrics.txt"), platforms: "reels,tiktok,shorts", variations: 1,
      align: fakeAlign, frameCheck: false, renderer, platform: "win32", log: (m) => logs.push(m),
    });
    const effectOf = (name: string) => readManifest(r.platforms.find((x) => x.name === name)!.variations[0].manifestFile).props.lyricEffects!.verse;
    expect(effectOf("reels")).toEqual({ name: "soft-blur", intensity: "subtle" }); // song.json perPlatform
    expect(effectOf("tiktok")).toEqual({ name: "cinematic-fade", intensity: "balanced" }); // brand.json perPlatform
    expect(effectOf("shorts")).toEqual({ name: "glide", intensity: "balanced" }); // the brand's default
    expect(logs).toContain("reels: recipe verseEffect soft-blur:subtle (song:reels)");
    expect(logs).toContain("tiktok: recipe verseEffect cinematic-fade (artist:tiktok)");
    const m = readManifest(r.platforms.find((x) => x.name === "reels")!.variations[0].manifestFile);
    expect((m as unknown as { effects: { from: { verse: string } } }).effects?.from?.verse ?? "song.json (reels)").toBe("song.json (reels)");
    expect(readdirSync(r.exportDir).sort()).toEqual(expect.arrayContaining(["reels", "shorts", "tiktok"]));
  });
});

describe("the Assets tab's hints check", () => {
  it("timed lines, end marks (the empty stamp after the last line) and orphans", () => {
    const lyrics = "Verse one here\n* Hold on to me\nThrough the night\n";
    const tap = "[ti:x]\n[00:01.00]Verse one here\n[00:02.50]Hold on to me\n[00:04.00]Through the night\n[00:05.20]\n";
    expect(checkHints(tap, lyrics)).toEqual({ stamps: 4, timed: 3, marks: 1, orphans: [], untapped: 0 });
    const old = "[00:01.00]Verse one here\n[00:02.00]A line that was removed\n[00:04.00]Through the night\n";
    expect(checkHints(old, lyrics)).toEqual({ stamps: 3, timed: 3, marks: 0, orphans: ["A line that was removed"], untapped: 1 });
  });
});
