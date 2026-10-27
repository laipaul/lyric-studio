// The song page's Style tab (Step 6.2c-2a): every recipe setting with its value and where it comes
// from (library, the artist's brand, the song), per platform where it can differ, and
// the song's own changes: set, reset (back to inherited), lock / unlock. Writes song.json only.
// No rendering code is imported here, so the studio's server can use it directly.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { project as projectTable, REPO_ROOT, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { EFFECT_NAMES, effectOptionLabel } from "../effects/names";
import { parsePresets, type PlatformPreset } from "../platform";
import { loadBrand } from "./brand";
import { loadFontCatalog, missingCharacters, type FontCatalog } from "./font-catalog";
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
  type SongRecipe,
} from "./recipe";
import { sharedCollections, songPathsById } from "./song-folder";
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
  collections: "Shared collections",
  platforms: "Platforms Generate starts with",
  variations: "Videos per platform",
  section: "Section",
  length: "Target length (auto section)",
  ep: "EP",
  youtubeLayout: "YouTube layout",
};

export type StyleValue = { value: unknown; source: string; own: boolean };
export type StyleField = StyleValue & {
  field: RecipeField;
  label: string;
  locked: boolean;
  perPlatform: (StyleValue & { platform: string; label: string })[] | null; // fields that can differ per platform
};
export type StyleFont = { family: string; source: "bundled" | "user"; weights: number[]; missing: string[]; faces: { weight: number; style: string; srcs: string[] }[] };
export type StyleData = {
  folder: string | null;
  recipeFile: string | null; // workspace-relative song.json
  brandFile: string;
  fields: StyleField[];
  platforms: { name: string; label: string; presetLength: string; presetVariations: number }[]; // presetLength: "30 s", "45-60 s", "whole song", "loop"
  effects: { name: string; label: string }[]; // label: "glide · verses"
  brandDefaults: { verseEffect: string; hookEffect: string }; // marked "brand default" in the lists
  fonts: StyleFont[];
  collections: string[];
  previewLine: string;
};

function presetsList(): PlatformPreset[] {
  const file = path.join(REPO_ROOT, "presets", "platforms.json");
  return Object.values(parsePresets(JSON.parse(readFileSync(file, "utf8")), file)).filter((p) => p.available && p.name !== "standard");
}

// The preset's own length, for "empty = the preset" in the Style tab and Generate.
export function presetLengthText(p: Pick<PlatformPreset, "length">): string {
  const l = p.length;
  return l.mode === "target" ? `${l.seconds} s` : l.mode === "range" ? `${l.min}-${l.max} s` : l.mode === "full" ? "whole song" : "loop";
}

// Everything the recipe resolution needs for this song (without a run).
export function recipeInputFor(ws: Workspace, projectId: string, catalog: FontCatalog = loadFontCatalog(ws.dir)): { input: RecipeInput; song: SongRecipe; recipeFile: string | null; brandFile: string } {
  const p = songPathsById(ws, projectId);
  const artist = artistOf(ws, projectId);
  const brand = loadBrand(ws.dir, catalog, artist);
  const song = p.recipe ? readRecipe(p.recipe) : {};
  return {
    input: { library: LIBRARY_RECIPE, artist: artistRecipe(brand.brand), artistPlatforms: brand.brand.perPlatform, song },
    song,
    recipeFile: p.recipe ? path.relative(ws.dir, p.recipe).split(path.sep).join("/") : null,
    brandFile: path.relative(ws.dir, brand.file).split(path.sep).join("/"),
  };
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
      faces: f.faces.map((x) => ({ weight: x.weight, style: x.style, srcs: x.files.map((file) => file.src) })),
    };
  });
}

export function styleData(ws: Workspace, projectId: string): StyleData {
  const catalog = loadFontCatalog(ws.dir);
  const { input, song, recipeFile, brandFile } = recipeInputFor(ws, projectId, catalog);
  const platforms = presetsList().map((p) => ({ name: p.name, label: SHORT_LABELS[p.name] ?? p.label, presetLength: presetLengthText(p), presetVariations: p.variations }));
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
          own: songValue(song, field, p.name) !== undefined,
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
  };
}

export type StyleAction = { action: "set" | "reset" | "lock" | "unlock"; field: RecipeField; platform?: string; value?: unknown };

// One change from the Style tab, checked like song.json is checked when it is read.
export function applyStyleAction(ws: Workspace, projectId: string, a: StyleAction): SongRecipe {
  if (!(RECIPE_FIELDS as readonly string[]).includes(a.field)) throw new Error(`Unknown setting ${a.field}.`);
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
  const song = readRecipe(file);
  const run = runRecipe(options);
  const fields = RECIPE_FIELDS.filter((k) => run[k] !== undefined);
  const kept = fields.filter((k) => (song.locked ?? []).includes(k));
  writeRecipe(file, saveToSong(song, run));
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
