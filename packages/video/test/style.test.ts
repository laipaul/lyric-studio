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
  loadTheme,
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
  type AlignRunner,
  type RecipeInput,
  type RenderOptions,
} from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const artist = { verseEffect: "glide", hookEffect: "karaoke-highlight", verseFont: "Cormorant Garamond", hookFont: "Kaushan Script", accentColour: "#E8A3B5" };
const input = (extra: Partial<RecipeInput> = {}): RecipeInput => ({
  library: LIBRARY_RECIPE,
  artist,
  artistPlatforms: { youtube: { verseEffect: "cinematic-fade" } },
  song: {},
  ...extra,
});

describe("per-platform values: library -> artist -> artist (platform) -> song -> song (platform) -> run", () => {
  it("each platform gets its own value and source", () => {
    expect(resolveRecipe(input()).values.verseEffect).toBe("glide"); // the default (no platform)
    const yt = resolveRecipe(input(), "youtube");
    expect([yt.values.verseEffect, yt.sources.verseEffect]).toEqual(["cinematic-fade", "artist:youtube"]);
    const reels = resolveRecipe(input(), "reels");
    expect([reels.values.verseEffect, reels.sources.verseEffect, reels.values.hookEffect, reels.sources.hookEffect]).toEqual(["glide", "artist", "karaoke-highlight", "artist"]);
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
    // The song's own per-platform value still counts under a lock (song:reels); a run cannot change it.
    const reelsLocked = { ...song, perPlatform: { ...song.perPlatform, reels: { verseEffect: "word-reveal:subtle" } } };
    const reels = resolveRecipe({ ...brandChanged, song: reelsLocked }, "reels");
    expect([reels.values.verseEffect, reels.sources.verseEffect]).toEqual(["word-reveal:subtle", "song:reels"]);
    expect(reels.ignored).toEqual([{ field: "verseEffect", run: "soft-blur", kept: "word-reveal:subtle" }]);
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
      "perPlatform.youtube.collections: only verseEffect, hookEffect, verseFont, hookFont, verseWeight, hookWeight, verseItalic, hookItalic, accentColour, section, length, shotLength, ending, transitions, paceShift, readability, breathe, heldGlow, chorusLift, shine, emphasis, titleOpening can differ per platform",
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

  it("brand.json motion.gapHideS / gapLeadInS: defaults 3 s and 1 s, checked", () => {
    const brandFile = path.join(wsDir, "brand", "brand.json");
    expect(loadBrand(wsDir, loadFontCatalog(wsDir)).brand.motion).toMatchObject({ gapHideS: 3, gapLeadInS: 1 }); // creates it if needed
    const raw = JSON.parse(readFileSync(brandFile, "utf8"));
    writeFileSync(brandFile, JSON.stringify({ ...raw, motion: { gapHideS: 4.5, gapLeadInS: 0.8 } }));
    expect(loadBrand(wsDir, loadFontCatalog(wsDir)).brand.motion).toMatchObject({ gapHideS: 4.5, gapLeadInS: 0.8, verseEffect: { name: "glide" } });
    writeFileSync(brandFile, JSON.stringify({ ...raw, motion: { gapHideS: "soon", gapLeadInS: 9 } }));
    expect(() => loadBrand(wsDir, loadFontCatalog(wsDir))).toThrow(/motion.gapHideS must be a number of seconds from 1.5 to 30[\s\S]*motion.gapLeadInS must be a number of seconds from 0.25 to 3/);
    writeFileSync(brandFile, JSON.stringify(raw));
  });

  it("styleData: every setting with value and source, per platform, and fonts with the accent check", () => {
    const d = styleData(ws, id);
    const verse = d.fields.find((f) => f.field === "verseEffect")!;
    // Themes (31 Oct 2026): the song moved to the artist's default theme, made from brand.json (its TikTok effect too).
    expect([verse.value, verse.source, verse.own, verse.locked]).toEqual(["glide", "theme", false, false]);
    expect(verse.perPlatform!.find((p) => p.platform === "tiktok")).toMatchObject({ value: "cinematic-fade", source: "theme:tiktok", own: true });
    expect(d.theme?.name).toBe("Life Lyrics");
    expect(d.fields.find((f) => f.field === "collections")!.perPlatform).toBeNull();
    expect(d.fonts.find((f) => f.family === "Cormorant Garamond" && f.source === "bundled")!.missing).toEqual([]);
    expect(d.fonts.find((f) => f.source === "user")).toMatchObject({ missing: ["é", "è", "ç", "à", "ô", "É", "È", "Ç", "À", "Ô"] });
    expect(d.previewLine).toMatch(/é.*à.*ô.*ç/);
  });

  it("set / reset / lock / unlock write song.json; theme settings go to the theme; bad values are refused", () => {
    applyStyleAction(ws, id, { action: "set", field: "verseEffect", value: "soft-blur:subtle", platform: "reels" });
    applyStyleAction(ws, id, { action: "set", field: "collections", value: ["wedding"] });
    applyStyleAction(ws, id, { action: "lock", field: "collections" });
    const file = songPathsById(ws, id).recipe!;
    expect(readRecipe(file)).toEqual({ theme: "Life Lyrics", collections: ["wedding"], locked: ["collections"] });
    expect(loadTheme(wsDir, "Life Lyrics").perPlatform.reels).toEqual({ verseEffect: "soft-blur:subtle" });
    const d = styleData(ws, id);
    expect(d.fields.find((f) => f.field === "verseEffect")!.perPlatform!.find((p) => p.platform === "reels")).toMatchObject({ value: "soft-blur:subtle", source: "theme:reels", own: true });
    expect(d.fields.find((f) => f.field === "collections")).toMatchObject({ locked: true, own: true, source: "song" });
    expect(() => applyStyleAction(ws, id, { action: "set", field: "verseFont", value: "Nope Sans" })).toThrow(/font "Nope Sans" not found/);
    expect(() => applyStyleAction(ws, id, { action: "set", field: "accentColour", value: "pink" })).toThrow(/accentColour must look like/);
    expect(() => applyStyleAction(ws, id, { action: "lock", field: "hookEffect" })).toThrow(/part of the song's theme/);
    applyStyleAction(ws, id, { action: "unlock", field: "collections" });
    applyStyleAction(ws, id, { action: "reset", field: "collections" });
    expect(readRecipe(file).collections).toBeUndefined();
    applyStyleAction(ws, id, { action: "set", field: "collections", value: ["wedding"] });
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
    expect(readRecipe(file)).toMatchObject({ section: "full" });
    expect(readRecipe(file).hookEffect).toBeUndefined();
    expect(loadTheme(wsDir, readRecipe(file).theme!).look.hookEffect).toBe("word-reveal"); // the effect went into the song's theme
    applyStyleAction(ws, id, { action: "set", field: "hookEffect", value: "karaoke-highlight" });
    writeRecipe(file, { theme: readRecipe(file).theme, collections: ["wedding"] });
  });

  it("pnpm make uses the right value per platform (song, brand and platforms.json levels) and says so", async () => {
    const logs: string[] = [];
    const r = await makeVideos({
      workspaceDir: wsDir, song, lyrics: path.join(songPathsById(ws, id).root, "lyrics.txt"), platforms: "reels,tiktok,shorts", variations: 1,
      align: fakeAlign, frameCheck: false, renderer, platform: "win32", log: (m) => logs.push(m),
    });
    const effectOf = (name: string) => readManifest(r.platforms.find((x) => x.name === name)!.variations[0].manifestFile).props.lyricEffects!.verse;
    expect(effectOf("reels")).toEqual({ name: "soft-blur", intensity: "subtle" }); // the theme's Reels value
    expect(effectOf("tiktok")).toEqual({ name: "cinematic-fade", intensity: "balanced" }); // the theme's TikTok value (from brand.json)
    expect(effectOf("shorts")).toEqual({ name: "glide", intensity: "balanced" }); // the theme's default
    expect(logs).toContain("theme: Life Lyrics");
    expect(logs).toContain("reels: recipe verseEffect soft-blur:subtle (theme:reels)");
    expect(logs).toContain("tiktok: recipe verseEffect cinematic-fade (theme:tiktok)");
    const m = readManifest(r.platforms.find((x) => x.name === "reels")!.variations[0].manifestFile);
    expect((m as unknown as { effects: { from: { verse: string } } }).effects?.from?.verse ?? "theme (reels)").toBe("theme (reels)");
    expect(readdirSync(r.exportDir).sort()).toEqual(expect.arrayContaining(["reels", "shorts", "tiktok"]));
  });
});

describe("platforms.json never sets the style", () => {
  it("a preset with another effect (old motion entry) does not beat the brand: glide wins, with a message", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "lyric-preset-"));
    const wsDir = path.join(root, "workspace");
    const presetsFile = path.join(root, "platforms.json");
    const json = JSON.parse(readFileSync(path.resolve("../../presets/platforms.json"), "utf8"));
    json.platforms.reels.motion = { verseEffect: "typewriter" };
    writeFileSync(presetsFile, JSON.stringify(json));
    const song = path.join(root, "Preset Test.wav");
    makeSong(song, 20);
    writeFileSync(path.join(root, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
    mkdirSync(path.join(wsDir, "collections", "wedding"), { recursive: true });
    makeClip(path.join(wsDir, "collections", "wedding", "01_a.mp4"), 6, "blue");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", path.join(root, "s.mp4"));
    const logs: string[] = [];
    const previous = process.env.WORKSPACE_DIR;
    process.env.WORKSPACE_DIR = wsDir;
    try {
      const r = await makeVideos({
        workspaceDir: wsDir, song, lyrics: path.join(root, "lyrics.txt"), presetsFile, platforms: "reels", variations: 1, collection: "wedding",
        align: fakeAlign, frameCheck: false, renderer: async (o) => (copyFileSync(path.join(root, "s.mp4"), o.outFile), o.outFile), platform: "win32", log: (m) => logs.push(m),
      });
      expect(readManifest(r.variations[0].manifestFile).props.lyricEffects!.verse).toEqual({ name: "glide", intensity: "balanced" }); // the brand's
      expect(logs.some((l) => l.startsWith('platforms.json reels: "motion" is not used any more'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.WORKSPACE_DIR;
      else process.env.WORKSPACE_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("the Assets tab's hints check", () => {
  it("timed lines, end marks (the empty stamp after the last line) and orphans", () => {
    const lyrics = "Verse one here\n* Hold on to me\nThrough the night\n";
    const tap = "[ti:x]\n[00:01.00]Verse one here\n[00:02.50]Hold on to me\n[00:04.00]Through the night\n[00:05.20]\n";
    expect(checkHints(tap, lyrics)).toEqual({ stamps: 4, timed: 3, marks: 1, orphans: [], untapped: 0, handSet: 0 });
    const old = "[00:01.00]Verse one here\n[00:02.00]A line that was removed\n[00:04.00]Through the night\n";
    expect(checkHints(old, lyrics)).toEqual({ stamps: 3, timed: 3, marks: 0, orphans: ["A line that was removed"], untapped: 1, handSet: 0 });
  });
});

describe("target length per platform (B3) and effect hints (B6)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-length-"));
  const wsDir = path.join(root, "workspace");
  const song = path.join(root, "Long Night.wav");
  const lyrics = path.join(root, "lyrics.txt");
  const previousWorkspace = process.env.WORKSPACE_DIR;
  let ws: Workspace;
  let id: string;
  const renderer = async (o: RenderOptions) => (copyFileSync(path.join(root, "s.mp4"), o.outFile), o.outFile);
  // Like a real song: a line every 3 s (sung 1.1 s), so there are clean bars between lines.
  const spaced: AlignRunner = async (a) => {
    const texts = readFileSync(a.lyrics, "utf8").split(/\r?\n/).filter(Boolean);
    const stamp = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(2).padStart(5, "0")}`;
    const rows = texts.map((raw, i) => {
      const text = raw.replace(/^\*\s+/, "");
      const start = 1000 + i * 3000;
      return { line: `[${stamp(start)}]${raw.startsWith("* ") ? "* " : ""}${text.split(" ").map((w, k) => `<${stamp(start + k * 250)}>${w}`).join(" ")} <${stamp(start + 1100)}>`, report: { number: i + 1, text, is_hook: raw.startsWith("* "), start_ms: start, end_ms: start + 1100, confidence: 0.9 } };
    });
    writeFileSync(a.out, `${rows.map((r) => r.line).join("\n")}\n`);
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: rows.map((r) => r.report) }));
  };
  const make = (extra: Record<string, unknown> = {}, logs: string[] = []) =>
    makeVideos({ workspaceDir: wsDir, song, lyrics, variations: 1, align: spaced, frameCheck: false, renderer, platform: "win32", log: (m) => logs.push(m), ...extra });

  beforeAll(async () => {
    process.env.WORKSPACE_DIR = wsDir;
    mkdirSync(root, { recursive: true });
    makeSong(song, 75);
    // 24 lines, a line every 3 s from 1 s; every 4th line a hook.
    writeFileSync(lyrics, `${Array.from({ length: 24 }, (_, i) => `${i % 4 === 3 ? "* " : ""}Line number ${i + 1} sings`).join("\n")}\n`);
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", path.join(root, "s.mp4"));
    mkdirSync(path.join(wsDir, "collections", "wedding"), { recursive: true });
    makeClip(path.join(wsDir, "collections", "wedding", "01_a.mp4"), 6, "blue");
    makeClip(path.join(wsDir, "collections", "wedding", "02_b.mp4"), 6, "red");
    ws = openWorkspace(wsDir);
    seedStylePresets(ws.db);
    id = (await findOrCreateSongProject(ws, song)).project.id;
    writeRecipe(songPathsById(ws, id).recipe!, { collections: ["wedding"], perPlatform: { reels: { length: 45 }, tiktok: { length: 20 }, shorts: { length: 300 } } });
  }, 120_000);
  afterAll(() => {
    ws?.close();
    if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = previousWorkspace;
    rmSync(root, { recursive: true, force: true });
  });

  it("an auto section aims for each platform's length, starts at or just before a hook and cuts no sung line", async () => {
    const logs: string[] = [];
    const r = await make({ platforms: "reels,tiktok,shorts" }, logs);
    const section = (name: string) => readManifest(r.platforms.find((x) => x.name === name)!.variations[0].manifestFile).section;
    const reels = section("reels");
    const tiktok = section("tiktok");
    expect((reels.end_ms - reels.start_ms) / 1000).toBeGreaterThan(45 * 0.75);
    expect((reels.end_ms - reels.start_ms) / 1000).toBeLessThan(45 * 1.3);
    expect((tiktok.end_ms - tiktok.start_ms) / 1000).toBeGreaterThan(20 * 0.75);
    expect((tiktok.end_ms - tiktok.start_ms) / 1000).toBeLessThan(20 * 1.3);
    for (const s of [reels, tiktok]) expect(s.reason).toMatch(/hook/);
    expect(logs).toContain("reels: target length 45 s (+-15%)");
    expect(logs).toContain("tiktok: target length 20 s (+-15%)");
    // Longer than the song: the whole song, and said so.
    expect(logs).toContain("shorts: target length 300 s is longer than the song (1:15.0): the whole song");
    const shorts = section("shorts");
    expect(shorts.mode).toBe("full");
    for (const p of r.platforms) expect(readFileSync(p.variations[0].qaFile, "utf8")).toContain("[ok  ] Section start/end"); // no sung line cut
  }, 300_000);

  it("a fixed section stays exactly as given; longer than the platform allows -> QA WARN, not trimmed", async () => {
    const r = await make({ platforms: "tiktok", section: "0:01-0:45" });
    const m = readManifest(r.variations[0].manifestFile);
    expect((m.section.end_ms - m.section.start_ms) / 1000).toBeGreaterThan(40); // not trimmed to 20-25 s
    const qa = readFileSync(r.variations[0].qaFile, "utf8");
    expect(qa).toMatch(/\[WARN\] Length for the platform/);
    expect(qa).toMatch(/TikTok allows up to \d+ s \(it was not trimmed/);
  }, 300_000);

  it("--length on the command line; a length never applies to YouTube (whole song) or Canvas (loop)", async () => {
    const { parseMakeArgs, lengthFor, loadPresets } = await import("../src/node");
    expect(parseMakeArgs(["a.wav", "b.txt", "--length", "90"], "/").options.length).toBe(90);
    expect(() => parseMakeArgs(["a.wav", "b.txt", "--length", "1"], "/")).toThrow(/--length must be a number of seconds from 3 to 600/);
    const presets = loadPresets();
    expect(lengthFor(presets.youtube, 90, 240_000)).toMatchObject({ wholeSong: false, note: "target length 90 s not used (this platform shows the whole song)" });
    expect(lengthFor(presets.reels, 90, 240_000).preset.length).toEqual({ mode: "target", seconds: 90, tolerance: 0.15 });
    expect(lengthFor(presets.standard, 40, 240_000).preset.length).toEqual({ mode: "target", seconds: 40, tolerance: 0.15 });
  });

  it("every effect has a hint, in one format, and the brand default is marked", async () => {
    const { EFFECT_NAMES, EFFECT_HINTS, effectOptionLabel } = await import("../src/effects/names");
    for (const name of EFFECT_NAMES) expect(EFFECT_HINTS[name]).toBeTruthy();
    expect(effectOptionLabel("glide")).toBe("glide · verses");
    expect(effectOptionLabel("karaoke-highlight", "karaoke-highlight:subtle")).toBe("karaoke-highlight · hooks · brand default");
    expect(effectOptionLabel("cinematic-fade")).toBe("cinematic-fade · verses, slow songs");
    const d = styleData(ws, id);
    expect(d.effects.find((e) => e.name === "glide")!.label).toBe("glide · verses");
    expect(d.brandDefaults).toEqual({ verseEffect: "glide", hookEffect: "karaoke-highlight" });
    expect(d.fields.find((f) => f.field === "length")!.perPlatform!.find((p) => p.platform === "reels")).toMatchObject({ value: 45, source: "song:reels" });
    expect(d.platforms.find((p) => p.name === "reels")!.presetLength).toBe("90 s");
    const g = generatePanelData(ws, ws.db.select().from(project).where(eq(project.id, id)).get()!);
    expect(g.recipe.lengths).toMatchObject({ reels: 45, tiktok: 20, youtube: null });
    // A default length for every platform still leaves YouTube "whole song" and Canvas "loop".
    const file = songPathsById(ws, id).recipe!;
    const before = readRecipe(file);
    writeRecipe(file, { ...before, length: 90 });
    const all = generatePanelData(ws, ws.db.select().from(project).where(eq(project.id, id)).get()!).recipe;
    expect([all.lengths.standard, all.lengths.youtube, all.lengths.canvas]).toEqual([90, null, null]);
    expect([all.presetLengths.youtube, all.presetLengths.canvas]).toEqual(["whole song", "loop"]);
    writeRecipe(file, before);
    expect(g.effects[0]).toEqual({ name: "glide", label: "glide · verses" });
  });
});
