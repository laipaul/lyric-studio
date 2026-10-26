// The song's recipe: song.json in its folder. Every setting is inherited unless the song sets it:
//   library defaults -> the artist's brand (brand\<artist>\brand.json) -> the song (song.json)
//   -> this run (Generate / command-line options; kept only with "save to song").
// A locked setting keeps the song's value: a later brand change does not reach it, and a run cannot
// change it (the run's choice is ignored, with a note).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { choiceText, DEFAULT_HOOK_EFFECT, DEFAULT_VERSE_EFFECT } from "../effects/names";
import { DEFAULT_BRAND, type Brand } from "./brand";

export const RECIPE_FIELDS = ["verseEffect", "hookEffect", "verseFont", "hookFont", "accentColour", "collections", "platforms", "variations", "section", "ep", "youtubeLayout"] as const;
export type RecipeField = (typeof RECIPE_FIELDS)[number];

export type RecipeValues = {
  verseEffect: string; // "glide", "soft-blur:subtle"
  hookEffect: string;
  verseFont: string; // font family
  hookFont: string;
  accentColour: string; // #RRGGBB
  collections: string[]; // shared collections used with the song's own clips
  platforms: string[]; // the platforms Generate starts with
  variations: Record<string, number>; // videos per platform
  section: string; // auto | full | 0:11-1:10
  ep: string;
  youtubeLayout: "cover" | "stills" | "clips";
};

export type SongRecipe = Partial<RecipeValues> & { locked?: RecipeField[] };
export type RecipeSource = "library" | "artist" | "song" | "run";

export type ResolvedRecipe = {
  values: RecipeValues;
  sources: Record<RecipeField, RecipeSource>;
  locked: RecipeField[];
  ignored: { field: RecipeField; run: unknown; kept: unknown }[]; // run choices a lock kept out
};

export const RECIPE_HELP =
  "The recipe of this song. A setting that is not here is inherited from the artist's brand (brand.json) " +
  "or the library defaults; a setting here is this song's own. \"locked\": settings that keep this song's value " +
  "(a brand change does not reach them, and Generate cannot change them for one run). Fields: verseEffect, hookEffect " +
  '("glide", "soft-blur:subtle", ...), verseFont, hookFont, accentColour ("#E8A3B5"), collections (shared collections used ' +
  'with the clips in clips\\), platforms (["reels", "youtube"]), variations ({ "reels": 3 }), section ("auto", "full", ' +
  '"0:11-1:10"), ep, youtubeLayout ("cover", "stills", "clips").';

// Checks a song.json; every problem is named.
export function checkRecipe(raw: unknown): { recipe: SongRecipe; problems: string[] } {
  const problems: string[] = [];
  const recipe: SongRecipe = {};
  if (!raw || typeof raw !== "object") return { recipe, problems: ["song.json must be a JSON object"] };
  const r = raw as Record<string, unknown>;
  const str = (k: RecipeField) => {
    if (r[k] === undefined) return;
    if (typeof r[k] !== "string" || !(r[k] as string).trim()) problems.push(`${k} must be text`);
    else (recipe as Record<string, unknown>)[k] = (r[k] as string).trim();
  };
  for (const k of ["verseEffect", "hookEffect", "verseFont", "hookFont", "section", "ep"] as const) str(k);
  if (r.ep === "") recipe.ep = "";
  if (r.accentColour !== undefined) {
    if (typeof r.accentColour === "string" && /^#[0-9a-fA-F]{6}$/.test(r.accentColour)) recipe.accentColour = r.accentColour;
    else problems.push('accentColour must look like "#E8A3B5"');
  }
  for (const k of ["collections", "platforms"] as const) {
    if (r[k] === undefined) continue;
    if (Array.isArray(r[k]) && (r[k] as unknown[]).every((x) => typeof x === "string")) recipe[k] = r[k] as string[];
    else problems.push(`${k} must be a list of names, e.g. ["wedding"]`);
  }
  if (r.variations !== undefined) {
    const v = r.variations as Record<string, unknown>;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 24)) recipe.variations = v as Record<string, number>;
    else problems.push('variations must look like { "reels": 3 } (1-24 videos)');
  }
  if (r.youtubeLayout !== undefined) {
    if (["cover", "stills", "clips"].includes(String(r.youtubeLayout))) recipe.youtubeLayout = r.youtubeLayout as RecipeValues["youtubeLayout"];
    else problems.push("youtubeLayout must be cover, stills or clips");
  }
  if (r.locked !== undefined) {
    if (Array.isArray(r.locked) && r.locked.every((x) => (RECIPE_FIELDS as readonly string[]).includes(String(x)))) recipe.locked = r.locked as RecipeField[];
    else problems.push(`locked must list settings of this recipe (${RECIPE_FIELDS.join(", ")})`);
  }
  for (const k of recipe.locked ?? []) if (recipe[k] === undefined) problems.push(`${k} is locked but has no value in song.json`);
  return { recipe, problems };
}

export function readRecipe(file: string | null): SongRecipe {
  if (!file || !existsSync(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message})`);
  }
  const { recipe, problems } = checkRecipe(raw);
  if (problems.length) throw new Error(`Problems in ${file}:\n  - ${problems.join("\n  - ")}`);
  return recipe;
}

export function writeRecipe(file: string, recipe: SongRecipe): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const ordered: Record<string, unknown> = { _help: RECIPE_HELP };
  for (const k of RECIPE_FIELDS) if (recipe[k] !== undefined) ordered[k] = recipe[k];
  if (recipe.locked?.length) ordered.locked = recipe.locked;
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);
}

// Each setting's value and where it comes from.
export function resolveRecipe(input: { library: RecipeValues; artist: Partial<RecipeValues>; song: SongRecipe; run?: Partial<RecipeValues> }): ResolvedRecipe {
  const locked = input.song.locked ?? [];
  const values = { ...input.library } as Record<RecipeField, unknown>;
  const sources = Object.fromEntries(RECIPE_FIELDS.map((k) => [k, "library"])) as Record<RecipeField, RecipeSource>;
  const ignored: ResolvedRecipe["ignored"] = [];
  for (const k of RECIPE_FIELDS) {
    if (input.artist[k] !== undefined) [values[k], sources[k]] = [input.artist[k], "artist"];
    if (input.song[k] !== undefined) [values[k], sources[k]] = [input.song[k], "song"];
    const run = input.run?.[k];
    if (run === undefined) continue;
    if (locked.includes(k)) {
      if (JSON.stringify(run) !== JSON.stringify(values[k])) ignored.push({ field: k, run, kept: values[k] });
    } else [values[k], sources[k]] = [run, "run"];
  }
  return { values: values as RecipeValues, sources, locked, ignored };
}

// "Save to song": the run's choices become the song's own (locked settings are left alone).
export function saveToSong(song: SongRecipe, run: Partial<RecipeValues>): SongRecipe {
  const next: SongRecipe = { ...song };
  for (const k of RECIPE_FIELDS) if (run[k] !== undefined && !(song.locked ?? []).includes(k)) (next as Record<string, unknown>)[k] = run[k];
  return next;
}

// "Reset": back to inherited (and unlocked).
export function resetField(song: SongRecipe, field: RecipeField): SongRecipe {
  const next: SongRecipe = { ...song };
  delete next[field];
  next.locked = (song.locked ?? []).filter((k) => k !== field);
  if (!next.locked.length) delete next.locked;
  return next;
}

// Lock: the current value (also an inherited one) becomes the song's own and stays.
export function lockField(song: SongRecipe, field: RecipeField, current: unknown): SongRecipe {
  const next = { ...song, [field]: song[field] ?? current } as SongRecipe;
  next.locked = [...new Set([...(song.locked ?? []), field])];
  return next;
}

export function unlockField(song: SongRecipe, field: RecipeField): SongRecipe {
  const next: SongRecipe = { ...song, locked: (song.locked ?? []).filter((k) => k !== field) };
  if (!next.locked!.length) delete next.locked;
  return next;
}

// ---- the levels below the song ---------------------------------------------------------------------

// Library defaults: what a song gets when neither its artist's brand nor song.json says otherwise.
export const LIBRARY_RECIPE: RecipeValues = {
  verseEffect: choiceText(DEFAULT_VERSE_EFFECT),
  hookEffect: choiceText(DEFAULT_HOOK_EFFECT),
  verseFont: DEFAULT_BRAND.verseFont.family,
  hookFont: DEFAULT_BRAND.hookFont.family,
  accentColour: DEFAULT_BRAND.accentColour,
  collections: [], // none: the song's own clips (or the collection it used last time)
  platforms: [], // none: the "standard" preset
  variations: {}, // none: each platform preset's number
  section: "auto",
  ep: "",
  youtubeLayout: "cover",
};

// The artist's brand.json (fonts, accent colour, lyric effects).
export function artistRecipe(brand: Pick<Brand, "verseFont" | "hookFont" | "accentColour" | "motion">): Partial<RecipeValues> {
  return {
    verseEffect: choiceText(brand.motion.verseEffect),
    hookEffect: choiceText(brand.motion.hookEffect),
    verseFont: brand.verseFont.family,
    hookFont: brand.hookFont.family,
    accentColour: brand.accentColour,
  };
}

// A run's choices ("pnpm make" options or the Generate panel). variations "*" = every platform.
export function runRecipe(o: {
  lineEffect?: string;
  hookEffect?: string;
  font?: string;
  fontHook?: string;
  collection?: string;
  platforms?: string;
  variations?: number;
  section?: string;
  ep?: string;
  layout?: RecipeValues["youtubeLayout"];
}): Partial<RecipeValues> {
  const list = (t?: string) => (t?.trim() ? t.split(/[\s,]+/).filter(Boolean) : undefined);
  const run: Partial<RecipeValues> = {
    verseEffect: o.lineEffect,
    hookEffect: o.hookEffect,
    verseFont: o.font,
    hookFont: o.fontHook,
    collections: list(o.collection),
    platforms: list(o.platforms?.toLowerCase()),
    variations: o.variations !== undefined ? { "*": o.variations } : undefined,
    section: o.section,
    ep: o.ep?.trim() || undefined,
    youtubeLayout: o.layout,
  };
  for (const k of RECIPE_FIELDS) if (run[k] === undefined) delete run[k];
  return run;
}

export function recipeText(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (v && typeof v === "object") return Object.entries(v).map(([k, n]) => `${k === "*" ? "every platform" : k} ${n}`).join(", ") || "preset";
  return v === "" || v === undefined ? "none" : String(v);
}

// "verse glide (artist), hook karaoke-highlight (artist), collections wedding (song, locked), ..."
export function recipeSummary(r: ResolvedRecipe): string {
  const show: RecipeField[] = ["verseEffect", "hookEffect", "verseFont", "hookFont", "accentColour", "collections", "section"];
  for (const k of ["platforms", "variations", "ep", "youtubeLayout"] as const) if (r.sources[k] !== "library") show.push(k);
  return show.map((k) => `${k} ${recipeText(r.values[k])} (${r.sources[k]}${r.locked.includes(k) ? ", locked" : ""})`).join(", ");
}
