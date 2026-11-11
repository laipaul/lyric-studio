// The song page's Style tab (Step 6.2c-2a): every recipe setting with its value and where it comes
// from (library, the artist's brand, the song), per platform where it can differ, and
// the song's own changes: set, reset (back to inherited), lock / unlock. Writes song.json only.
// No rendering code is imported here, so the studio's server can use it directly.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, project as projectTable, REPO_ROOT, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { EFFECT_NAMES, effectOptionLabel } from "../effects/names";
import { parsePresets, type PlatformPreset } from "../platform";
import { loadBrand } from "./brand";
import { loadFontCatalog, missingCharacters, userFontsDir, type FontCatalog } from "./font-catalog";
import { isPlatformField, PLATFORM_FIELDS } from "./per-platform";
import {
  artistRecipe,
  checkRecipe,
  LIBRARY_RECIPE,
  lockField,
  readRecipe,
  resetField,
  resolveRecipe,
  RECIPE_FIELDS,
  runRecipe,
  saveToSong,
  setField,
  songValue,
  unlockField,
  writeRecipe,
  type RecipeField,
  type RecipeInput,
  type RecipeValues,
  type SongRecipe,
} from "./recipe";
import { readTextboard, TITLE_SIZE_VERTICAL } from "./textboard";
import { isRemovedSong, sharedCollections, songPathsById } from "./song-folder";
import { brandThemes, ensureAllThemes, ensureSongTheme, isThemeField, listThemes, loadTheme, plainSongThemeNames, removedThemes, setThemeLook, themeCover, themeCoverVideo, themeLayer, type RemovedTheme, type ThemeLook } from "./themes";
import { SHORT_LABELS } from "./exports";

// The characters the font preview checks (French accents).
export const ACCENT_CHECK = ["é", "è", "ç", "à", "ô", "É", "È", "Ç", "À", "Ô"];
export const PREVIEW_LINE = "Où es-tu, mon cœur ? L'été à côté de toi, ça change tout — ÉÈÇÀÔ";

export const FIELD_LABELS: Record<RecipeField, string> = {
  verseEffect: "Verse effect",
  hookEffect: "Hook effect",
  verseFont: "Verse font",
  hookFont: "Hook font",
  verseWeight: "Verse weight",
  hookWeight: "Hook weight",
  verseItalic: "Verse italic",
  hookItalic: "Hook italic",
  accentColour: "Accent colour",
  shotLength: "Shot length",
  tempo: "Tempo (BPM)",
  collections: "Shared collections",
  platforms: "Platforms Generate starts with",
  variations: "Videos per platform",
  section: "Section",
  length: "Target length (auto section)",
  ending: "Ending (Reels, TikTok, Shorts)",
  transitions: "Transitions",
  paceShift: "Pace adjustment (bars)",
  readability: "Lyric readability",
  breathe: "Breathe (lyrics swell softly)",
  heldGlow: "Held-note glow",
  chorusLift: "Chorus lift",
  shine: "Shine (choruses)",
  emphasis: "Emphasis word",
  titleOpening: "Title opening (Reels, TikTok, Shorts)",
  tagline: "Credits", // on screen since 11 Nov 2026 (song.json keeps "tagline")
  ep: "EP",
  youtubeLayout: "YouTube layout",
  textColour: "Text colour",
  grade: "Colour grade",
  vignette: "Vignette",
  textBacking: "Behind the words",
  textLayout: "Text layout",
  lineShape: "Line shape",
  lineBuild: "Lines appear",
  finalHook: "Bigger final chorus",
  fallback: "Background without a clip",
  fallbackColour: "Background colour",
  gradeCanvas: "Grade on the Canvas",
  titleStyle: "Title style",
  titleWarp: "Title shape",
  hookCard: "Hook card (Reels, TikTok, Shorts)",
  hookCardStyle: "Hook card style",
  endCard: "End card (Reels, TikTok, Shorts)",
  endCardStyle: "End card style",
  hookText: "Hook card text",
  endText: "End card text",
};

export type StyleValue = { value: unknown; source: string; own: boolean };
// A theme as the Theme panel shows it: name, the look (default and per platform), how many songs use it.
export type StyleTheme = { name: string; description: string; look: ThemeLook; perPlatform: Record<string, Partial<ThemeLook>>; users: string[]; problems: string[]; preview: boolean; cover?: string | null }; // cover: the Theme cover (workspace-relative, ?v=mtime)
export type StyleField = StyleValue & {
  field: RecipeField;
  label: string;
  locked: boolean;
  perPlatform: (StyleValue & { platform: string; label: string })[] | null; // fields that can differ per platform
};
export type StyleFont = { family: string; source: "bundled" | "user"; weights: number[]; missing: string[]; faces: { weight: number; style: string; srcs: string[]; ranges: (string | null)[] }[] }; // ranges: each src's unicode-range (null: all)
export type StyleData = {
  folder: string | null;
  recipeFile: string | null; // workspace-relative song.json
  brandFile: string;
  fields: StyleField[];
  platforms: { name: string; label: string; presetLength: string; presetSeconds: number | null; presetVariations: number }[]; // presetLength: "automatic (...)", "30 s", "45-60 s", "whole song", "loop"; presetSeconds: a target preset's seconds
  effects: { name: string; label: string }[]; // label: "glide · verses"
  brandDefaults: { verseEffect: string; hookEffect: string }; // marked "brand default" in the lists
  fonts: StyleFont[];
  collections: string[];
  previewLine: string;
  sampleLines: string[]; // the song's first sung lines (the effects preview)
  // Song Details' fit hint (11 Nov 2026): how the tagline, Hook and End cards are drawn in a Reel (font, size, letter
  // spacing, case) and the width they may use (the safe area), with the theme they come from; measured in the studio.
  cardFit: CardFitData;
  userFonts: string; // the folder for the user's own fonts (WORKSPACE_DIR\fonts)
  theme: StyleTheme | null; // the song's theme
  themes: StyleTheme[]; // every theme, for the Theme panel's tiles
  removedThemes: RemovedTheme[]; // deleted themes (themes\_removed\), each with a Restore
  cover: string | null; // the song's cover (workspace-relative), for the editor's cover colours
  title: string; // the song's title (the editor's title style sample)
  song: { file: string | null; bpm: number | null }; // workspace-relative song file (the Tap button plays it); the BPM the last video used
};

function presetsList(): PlatformPreset[] {
  const file = path.join(REPO_ROOT, "presets", "platforms.json");
  return Object.values(parsePresets(JSON.parse(readFileSync(file, "utf8")), file)).filter((p) => p.available && p.name !== "standard");
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// The preset's own length, for "empty = the preset" in the Style tab and Generate ("automatic (...)" when
// the preset has an Automatic range).
export function presetLengthText(p: Pick<PlatformPreset, "length">): string {
  const l = p.length;
  if (l.mode === "target" && l.auto) return `automatic (a finished phrase near ${clock(l.seconds)}, ${clock(l.auto.min)}-${clock(l.auto.max)})`;
  return l.mode === "target" ? `${l.seconds} s` : l.mode === "range" ? `${l.min}-${l.max} s` : l.mode === "full" ? "whole song" : "loop";
}

// Everything the recipe resolution needs for this song (without a run).
export function recipeInputFor(ws: Workspace, projectId: string, catalog: FontCatalog = loadFontCatalog(ws.dir)): { input: RecipeInput; song: SongRecipe; recipeFile: string | null; brandFile: string } {
  const p = songPathsById(ws, projectId);
  const artist = artistOf(ws, projectId);
  const brand = loadBrand(ws.dir, catalog, artist);
  const song = p.recipe ? ensureSongTheme(ws, projectId, catalog) : {};
  const theme = song.theme ? loadTheme(ws.dir, song.theme, catalog) : null;
  return {
    input: { library: LIBRARY_RECIPE, artist: artistRecipe(brand.brand), artistPlatforms: brand.brand.perPlatform, ...(theme ? { theme: themeLayer(theme) } : {}), song },
    song,
    recipeFile: p.recipe ? path.relative(ws.dir, p.recipe).split(path.sep).join("/") : null,
    brandFile: path.relative(ws.dir, brand.file).split(path.sep).join("/"),
  };
}

function coverOf(ws: Workspace, projectId: string): string | null {
  const cover = ws.db.select({ cover: projectTable.cover_path }).from(projectTable).where(eq(projectTable.id, projectId)).get()?.cover;
  return cover && existsSync(absPath(ws, cover)) ? cover : null;
}

function songRow(ws: Workspace, projectId: string): StyleData["song"] {
  const row = ws.db.select({ file: projectTable.audio_path, bpm: projectTable.bpm }).from(projectTable).where(eq(projectTable.id, projectId)).get();
  return { file: row?.file ?? null, bpm: row?.bpm ?? null };
}

function artistOf(ws: Workspace, projectId: string): string {
  const row = ws.db.select({ artist: projectTable.artist }).from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!row) throw new Error("Song not found.");
  return row.artist;
}

// The fonts the Style tab offers: bundled and the user's own (WORKSPACE_DIR\fonts), with the French
// accents each one lacks.
export function styleFonts(catalog: FontCatalog): StyleFont[] {
  return catalog.families.map((f) => {
    const face = f.faces.find((x) => x.style === "normal" && x.weight === 400) ?? f.faces.find((x) => x.style === "normal") ?? f.faces[0];
    let missing: string[] = [];
    try {
      missing = face ? missingCharacters(face, ACCENT_CHECK) : ACCENT_CHECK;
    } catch {
      missing = [];
    }
    return {
      family: f.family,
      source: f.source,
      weights: [...new Set(f.faces.map((x) => x.weight))].sort((a, b) => a - b),
      missing,
      faces: f.faces.map((x) => ({ weight: x.weight, style: x.style, srcs: x.files.map((file) => file.src), ranges: x.files.map((file) => file.unicodeRange ?? null) })),
    };
  });
}

// A theme's cover as /api/files wants it (workspace-relative, ?v=mtime so a new one shows at once).
function coverRef(dir: string, name: string): string | null {
  const cover = themeCover(dir, name);
  return cover ? `${path.relative(dir, cover).split(path.sep).join("/")}?v=${Math.round(statSync(cover).mtimeMs)}` : null;
}

export function styleData(ws: Workspace, projectId: string): StyleData {
  const catalog = loadFontCatalog(ws.dir);
  plainSongThemeNames(ws); // themes named like their song get "<song> look" (themes.ts)
  const { input, song, recipeFile, brandFile } = recipeInputFor(ws, projectId, catalog);
  const platforms = presetsList().map((p) => ({ name: p.name, label: SHORT_LABELS[p.name] ?? p.label, presetLength: presetLengthText(p), presetSeconds: p.length.mode === "target" ? p.length.seconds : null, presetVariations: p.variations }));
  const withLyrics = new Set(presetsList().filter((p) => p.lyrics).map((p) => p.name)); // Canvas has no lyrics, effects or fonts
  const all = resolveRecipe(input);
  const byPlatform = Object.fromEntries(platforms.map((p) => [p.name, resolveRecipe(input, p.name)]));
  const fields: StyleField[] = RECIPE_FIELDS.map((field) => ({
    field,
    label: FIELD_LABELS[field],
    value: all.values[field],
    source: all.sources[field],
    own: song[field] !== undefined,
    locked: all.locked.includes(field),
    perPlatform: isPlatformField(field)
      ? platforms.filter((p) => withLyrics.has(p.name)).map((p) => ({
          platform: p.name,
          label: p.label,
          value: byPlatform[p.name].values[field],
          source: byPlatform[p.name].sources[field],
          // a theme setting: "own" = the theme's own value for this platform (it can be reset to the theme's default)
          own: isThemeField(field) ? byPlatform[p.name].sources[field] === `theme:${p.name}` : songValue(song, field, p.name) !== undefined,
        }))
      : null,
  }));
  return {
    folder: songPathsById(ws, projectId).legacy ? null : songPathsById(ws, projectId).rel,
    recipeFile,
    brandFile,
    fields,
    platforms,
    effects: EFFECT_NAMES.map((name) => ({ name, label: effectOptionLabel(name) })),
    brandDefaults: { verseEffect: String(input.artist.verseEffect), hookEffect: String(input.artist.hookEffect) },
    fonts: styleFonts(catalog),
    collections: sharedCollections(ws),
    previewLine: PREVIEW_LINE,
    sampleLines: sampleLines(ws, projectId),
    cardFit: cardFitData(ws, projectId, catalog, all.values, song.theme ?? null),
    userFonts: userFontsDir(ws.dir),
    song: songRow(ws, projectId),
    ...themesOf(ws, song.theme ?? null, catalog),
    removedThemes: removedThemes(ws.dir),
    cover: coverOf(ws, projectId),
    title: ws.db.select({ title: projectTable.title }).from(projectTable).where(eq(projectTable.id, projectId)).get()?.title ?? "",
  };
}

function themesOf(ws: Workspace, current: string | null, catalog: FontCatalog): { theme: StyleTheme | null; themes: StyleTheme[] } {
  ensureAllThemes(ws, catalog); // every song's theme and the brand's default theme are offered
  const users = new Map<string, string[]>();
  for (const p of ws.db.select({ id: projectTable.id, title: projectTable.title, folder: projectTable.folder }).from(projectTable).all()) {
    if (isRemovedSong(p.folder)) continue; // a deleted song
    const file = songPathsById(ws, p.id).recipe;
    if (!file || !existsSync(file)) continue;
    try {
      const t = readRecipe(file).theme;
      if (t) users.set(t, [...(users.get(t) ?? []), p.title]);
    } catch {
      // a broken song.json is named on that song's page
    }
  }
  const themes = listThemes(ws.dir, catalog).map((t) => ({ name: t.name, description: t.theme.description, look: t.theme.look, perPlatform: t.theme.perPlatform, users: users.get(t.name) ?? [], problems: t.problems, preview: !!t.preview, cover: coverRef(ws.dir, t.name) }));
  return { theme: themes.find((t) => t.name === current) ?? null, themes };
}

// The song's first three sung lines (hook marks removed), for the effects preview.
function sampleLines(ws: Workspace, projectId: string): string[] {
  try {
    const file = songPathsById(ws, projectId).lyricsTxt;
    const lines = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\*\s+/, "").trim())
      .filter((l) => l && !/^\[.*\]$/.test(l) && !/:$/.test(l));
    if (lines.length) return lines.slice(0, 3);
  } catch {
    // no lyrics yet
  }
  return ["Hold on to the light", "We had a heart for two", "And it carried us home"];
}

// scope (theme settings: fonts, effects, colour, add-ons): "all" = the theme itself, every song using it;
// "song" = only this song (a copy of the theme when other songs use it).
export type StyleAction = { action: "set" | "reset" | "lock" | "unlock" | "brand"; field: RecipeField; platform?: string; value?: unknown; scope?: "all" | "song" };

// "Use for all my songs" (the music-reactive add-ons and Breathe): the value in the artist's brand.json for
// every platform with lyrics, and this song's own value removed so it follows the brand too.
export const BRAND_ALL_FIELDS = ["breathe", "heldGlow", "chorusLift", "shine", "emphasis"] as const;
export function setBrandAllPlatforms(ws: Workspace, projectId: string, field: RecipeField, value: string): { file: string; platforms: string[] } {
  if (!(BRAND_ALL_FIELDS as readonly string[]).includes(field)) throw new Error(`${FIELD_LABELS[field]} cannot be set for all songs here.`);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const platforms = presetsList().filter((x) => x.lyrics).map((x) => x.name);
  let file = "";
  for (const platform of platforms) file = setBrandPerPlatform(ws, { artist: p.artist, platform, field, value }).file;
  const recipeFile = songPathsById(ws, projectId).recipe;
  if (recipeFile && existsSync(recipeFile)) {
    let song = readRecipe(recipeFile);
    if (!(song.locked ?? []).includes(field)) {
      song = resetField(song, field);
      for (const platform of platforms) song = resetField(song, field, platform);
      writeRecipe(recipeFile, song);
    }
  }
  return { file, platforms };
}

// One change from the Style tab, checked like song.json is checked when it is read.
export function applyStyleAction(ws: Workspace, projectId: string, a: StyleAction): SongRecipe {
  if (!(RECIPE_FIELDS as readonly string[]).includes(a.field)) throw new Error(`Unknown setting ${a.field}.`);
  if (isThemeField(a.field)) {
    // Fonts, effects, colour and add-ons live in the song's theme.
    if (a.action === "set" || (a.action === "reset" && a.platform)) {
      const catalog = loadFontCatalog(ws.dir);
      setThemeLook(ws, { projectId, values: { [a.field]: a.action === "set" ? a.value : null }, platform: a.platform, scope: a.scope ?? "all", catalog });
      return readRecipe(songPathsById(ws, projectId).recipe);
    }
    throw new Error(`${FIELD_LABELS[a.field]} is part of the song's theme: change it in the theme.`);
  }
  if (a.action === "brand") {
    setBrandAllPlatforms(ws, projectId, a.field, String(a.value));
    return readRecipe(songPathsById(ws, projectId).recipe);
  }
  if (a.platform && !isPlatformField(a.field)) throw new Error(`${FIELD_LABELS[a.field]} cannot differ per platform (only ${PLATFORM_FIELDS.join(", ")}).`);
  const catalog = loadFontCatalog(ws.dir);
  const { input, song } = recipeInputFor(ws, projectId, catalog);
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  let next: SongRecipe;
  if (a.action === "set") next = setField(song, a.field, a.value, a.platform);
  else if (a.action === "reset") next = resetField(song, a.field, a.platform);
  else if (a.action === "unlock") next = unlockField(song, a.field);
  else {
    const now = resolveRecipe(input);
    const perPlatform = isPlatformField(a.field) ? Object.fromEntries(presetsList().map((p) => [p.name, resolveRecipe(input, p.name).values[a.field]])) : {};
    next = lockField(song, a.field, now.values[a.field], perPlatform);
  }
  const { recipe, problems } = checkRecipe(next);
  for (const k of ["verseFont", "hookFont"] as const) {
    const fonts = [recipe[k], ...Object.values(recipe.perPlatform ?? {}).map((v) => v[k])].filter(Boolean) as string[];
    for (const f of fonts) if (!catalog.families.some((x) => x.family.toLowerCase() === f.toLowerCase())) problems.push(`${FIELD_LABELS[k]}: font "${f}" not found`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  writeRecipe(file, recipe);
  return recipe;
}

// Generate's "Save to song": the run's choices become the song's own settings (locked ones stay).
// Returns the settings that were saved and the ones a lock kept.
export function saveRunToSong(ws: Workspace, projectId: string, options: Parameters<typeof runRecipe>[0]): { saved: RecipeField[]; kept: RecipeField[] } {
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const catalog = loadFontCatalog(ws.dir);
  const song = ensureSongTheme(ws, projectId, catalog);
  const run = runRecipe(options);
  const fields = RECIPE_FIELDS.filter((k) => run[k] !== undefined);
  const kept = fields.filter((k) => (song.locked ?? []).includes(k));
  // Fonts and effects go into the song's theme (a copy when other songs share it); the rest into song.json.
  const look = Object.fromEntries(fields.filter((k) => isThemeField(k) && !kept.includes(k)).map((k) => [k, run[k]]));
  const rest = Object.fromEntries(Object.entries(run).filter(([k]) => !isThemeField(k)));
  writeRecipe(file, saveToSong(song, rest));
  if (Object.keys(look).length) setThemeLook(ws, { projectId, values: look, scope: "song", catalog });
  return { saved: fields.filter((k) => !kept.includes(k)), kept };
}

// "pnpm brand:set youtube verseEffect cinematic-fade" (artist "Life Lyrics" unless --artist): a
// per-platform value in the artist's brand.json, for every song of that artist. Songs that set the very
// same value themselves (and do not lock it) lose their own copy, so they inherit it from the brand;
// songs with another value of their own keep it (listed).
export function setBrandPerPlatform(
  ws: Workspace,
  o: { artist: string; platform: string; field: string; value: string | number | null },
): { file: string; tidied: string[]; kept: string[] } {
  if (!isPlatformField(o.field)) throw new Error(`${o.field} cannot differ per platform (only ${PLATFORM_FIELDS.join(", ")}).`);
  const platforms = presetsList().map((p) => p.name);
  if (!platforms.includes(o.platform)) throw new Error(`Unknown platform "${o.platform}". Known: ${platforms.join(", ")}`);
  const catalog = loadFontCatalog(ws.dir);
  const brand = loadBrand(ws.dir, catalog, o.artist); // creates the file with the defaults if needed
  const before = readFileSync(brand.file, "utf8");
  const raw = JSON.parse(before) as Record<string, unknown> & { perPlatform?: Record<string, Record<string, unknown>> };
  const perPlatform = { ...(raw.perPlatform ?? {}) };
  const own = { ...(perPlatform[o.platform] ?? {}) };
  if (o.value === null) delete own[o.field];
  else own[o.field] = o.value;
  if (Object.keys(own).length) perPlatform[o.platform] = own;
  else delete perPlatform[o.platform];
  writeFileSync(brand.file, `${JSON.stringify({ ...raw, perPlatform }, null, 2)}\n`);
  try {
    loadBrand(ws.dir, catalog, o.artist); // checked like any brand.json; a bad value is put back
  } catch (error) {
    writeFileSync(brand.file, before);
    throw error;
  }
  const tidied: string[] = [];
  const kept: string[] = [];
  for (const p of ws.db.select().from(projectTable).where(eq(projectTable.artist, o.artist)).all()) {
    const file = songPathsById(ws, p.id).recipe;
    if (!file || !existsSync(file)) continue;
    const song = readRecipe(file);
    const mine = songValue(song, o.field as RecipeField, o.platform);
    if (mine === undefined) continue;
    if (o.value !== null && JSON.stringify(mine) === JSON.stringify(o.value) && !(song.locked ?? []).includes(o.field as RecipeField)) {
      writeRecipe(file, resetField(song, o.field as RecipeField, o.platform));
      tidied.push(p.title);
    } else kept.push(p.title);
  }
  return { file: brand.file, tidied, kept };
}

// The card editor's "Use as the brand's title font": the artist's brand.json titleFont family (its
// weight and letter spacing kept; the nearest weight the family has, with the brand's own check). Every
// title card, YouTube title and thumbnail of the artist then uses it.
export function setBrandTitleFont(ws: Workspace, o: { artist: string; family: string }): { file: string; family: string } {
  const catalog = loadFontCatalog(ws.dir);
  if (!catalog.families.some((f) => f.family.toLowerCase() === o.family.trim().toLowerCase())) throw new Error(`Font "${o.family}" not found.`);
  const brand = loadBrand(ws.dir, catalog, o.artist);
  const before = readFileSync(brand.file, "utf8");
  const raw = JSON.parse(before) as Record<string, unknown> & { titleFont?: Record<string, unknown> };
  const family = catalog.families.find((f) => f.family.toLowerCase() === o.family.trim().toLowerCase())!.family;
  writeFileSync(brand.file, `${JSON.stringify({ ...raw, titleFont: { ...(raw.titleFont ?? {}), family } }, null, 2)}\n`);
  try {
    loadBrand(ws.dir, catalog, o.artist);
  } catch (error) {
    writeFileSync(brand.file, before);
    throw error;
  }
  return { file: brand.file, family };
}

// The Themes page (31 Oct 2026): every theme with its songs, the fonts to draw them, a few lyric lines to
// preview them on (the newest song with lyrics), the songs to use a theme for, and the deleted themes.
export const THEME_SAMPLE_LINES = ["Your lyric line here", "Your chorus here"] as const;
export type ThemeCard = StyleTheme & { author: string; licence: string; createdAt: string; moods: string[]; songs: { id: string; title: string }[]; brandDefault: string | null; background?: string | null; backgroundVideo?: string | null };
export type ThemesPageData = { themes: ThemeCard[]; fonts: StyleFont[]; sampleLines: string[]; sampleSong: string | null; songs: { id: string; title: string; theme: string | null }[]; removed: RemovedTheme[] };

export function themesPageData(ws: Workspace): ThemesPageData {
  const catalog = loadFontCatalog(ws.dir);
  ensureAllThemes(ws, catalog);
  const projects = ws.db.select({ id: projectTable.id, title: projectTable.title, created: projectTable.created_at, folder: projectTable.folder }).from(projectTable).all().filter((p) => !isRemovedSong(p.folder));
  const songs = projects.map((p) => {
    let theme: string | null = null;
    try {
      theme = readRecipe(songPathsById(ws, p.id).recipe).theme ?? null;
    } catch {
      // named on the song's page
    }
    return { id: p.id, title: p.title, theme };
  });
  const defaults = brandThemes(ws, catalog);
  const themes = listThemes(ws.dir, catalog).map((t) => {
    const users = songs.filter((s) => s.theme === t.name);
    return {
      name: t.name,
      description: t.theme.description,
      look: t.theme.look,
      perPlatform: t.theme.perPlatform,
      users: users.map((u) => u.title),
      songs: users.map((u) => ({ id: u.id, title: u.title })),
      problems: t.problems,
      preview: !!t.preview,
      author: t.theme.author,
      licence: t.theme.licence,
      createdAt: t.theme.createdAt,
      moods: t.theme.moods ?? [],
      brandDefault: defaults.has(t.name) ? defaults.get(t.name) || "" : null,
    };
  });
  // Neutral words on every theme preview (1 Nov 2026): lines from one of the songs made a theme look like it.
  const sample = [...THEME_SAMPLE_LINES];
  const sampleSong: string | null = null;
  return { themes, fonts: styleFonts(catalog), sampleLines: sample, sampleSong, songs: songs.sort((a, b) => a.title.localeCompare(b.title)), removed: removedThemes(ws.dir) };
}

// The Themes page with each theme's own picture: its Theme cover (themes\<name>\cover.jpg), else none (the
// tile draws a neutral backdrop in the theme's colours). Never a song's clip or cover (1 Nov 2026: themes
// showing a song's picture looked like that song).
export async function themesPageWithFrames(ws: Workspace): Promise<ThemesPageData> {
  const data = themesPageData(ws);
  for (const t of data.themes) {
    const cover = themeCover(ws.dir, t.name);
    t.background = cover ? `${path.relative(ws.dir, cover).split(path.sep).join("/")}?v=${Math.round(statSync(cover).mtimeMs)}` : null;
    const video = themeCoverVideo(ws.dir, t.name);
    t.backgroundVideo = video ? `${path.relative(ws.dir, video).split(path.sep).join("/")}?v=${Math.round(statSync(video).mtimeMs)}` : null;
  }
  return data;
}

// ---- Song Details: how each card text is drawn in a Reel (the fit hint) ----
export type CardFitSpec = { family: string; weight: number; italic: boolean; size: number; letterSpacing: number; upper: boolean };
export type CardFitData = { platform: string; theme: string | null; artist: string; room: number; cards: { tagline: CardFitSpec; hookText: CardFitSpec; endText: CardFitSpec } };
// The same sizes and faces Make uses (textboard.ts title cards: the tagline at 0.42 of the title size in the title
// opening, in the title font; make.ts extraCards: the Hook card at 1.1 in the hook font, upper case; the End card at
// 0.6 in the title font), at the Reel's text scale, inside its safe area's width (fitCardBlocks keeps cards centred).
function cardFitData(ws: Workspace, projectId: string, catalog: FontCatalog, values: Partial<RecipeValues>, theme: string | null): CardFitData {
  const reels = presetsList().find((p) => p.name === "reels") ?? presetsList()[0];
  const brand = loadBrand(ws.dir, catalog, artistOf(ws, projectId)).brand;
  const width = 1080;
  const room = Math.round(width - 2 * width * Math.max(reels.safeZone.left, reels.safeZone.right));
  const base = Math.round(TITLE_SIZE_VERTICAL * (reels.textScale ?? 1));
  const title = { family: brand.titleFont.family, weight: brand.titleFont.weight, italic: brand.titleFont.italic === true };
  const hookFamily = String(values.hookFont ?? values.verseFont ?? brand.hookFont.family);
  const hook = { family: hookFamily, weight: Number(values.hookWeight ?? brand.hookFont.weight ?? 400), italic: values.hookItalic === true };
  // The tagline (11 Nov 2026): the lyric font by default, or the font, size and capitals set on its card (Shape).
  let board = null as ReturnType<typeof readTextboard>;
  try {
    const p = songPathsById(ws, projectId);
    board = p.legacy ? null : readTextboard(p.root);
  } catch {
    board = null; // a broken textboard.json: the defaults (Shape reports it)
  }
  const tag = { ...(board?.roles.tagline ?? {}), ...(board?.cards.find((c) => c.type === "tagline")?.overrides ?? {}) };
  const lyric = { family: String(values.verseFont ?? brand.verseFont.family), weight: Number(values.verseWeight ?? brand.verseFont.weight ?? 400), italic: values.verseItalic === true };
  const tagFace = tag.font ? { family: tag.font, weight: tag.weight ?? 400, italic: tag.italic === true } : lyric;
  return {
    platform: SHORT_LABELS.reels ?? "Reels",
    theme,
    artist: artistOf(ws, projectId),
    room,
    cards: {
      tagline: { ...tagFace, size: Math.round(base * 0.35 * (tag.size ?? 1)), letterSpacing: tagFace.family === title.family ? (brand.titleFont.letterSpacing ?? 0.18) : 0.02, upper: tag.upper === true },
      hookText: { ...hook, size: Math.round(base * 1.1), letterSpacing: 0.06, upper: true },
      endText: { ...title, size: Math.round(base * 0.6), letterSpacing: 0.04, upper: false },
    },
  };
}
