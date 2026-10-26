// The song's recipe: song.json in its folder. Every setting is inherited unless the song sets it:
//   library defaults -> the artist's brand (brand\<artist>\brand.json) -> the song (song.json)
//   -> this run (Generate / command-line options; kept only with "save to song").
// A locked setting keeps the song's value: a later brand change does not reach it, and a run cannot
// change it (the run's choice is ignored, with a note).
// Per platform (Step 6.2c-2a): brand.json and song.json may hold "perPlatform": { "youtube": {
// "verseEffect": "cinematic-fade" } } for the PLATFORM_FIELDS. For one platform the order is (weakest
// first): library -> artist -> platforms.json motion -> artist (that platform) -> song -> song (that
// platform) -> run. A locked field uses only the song's values (its default and per-platform ones).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { choiceText, DEFAULT_HOOK_EFFECT, DEFAULT_VERSE_EFFECT, parseEffectChoice } from "../effects/names";
import type { PlatformPreset } from "../platform";
import { DEFAULT_BRAND, type Brand } from "./brand";
import { checkPerPlatform, isPlatformField, PLATFORM_FIELDS, type PerPlatform, type PlatformField } from "./per-platform";

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

export { isPlatformField, PLATFORM_FIELDS, type PerPlatform, type PlatformField, type PlatformValues } from "./per-platform";

export type SongRecipe = Partial<RecipeValues> & { perPlatform?: PerPlatform; locked?: RecipeField[] };
// library | artist | platforms.json | artist:<platform> | song | song:<platform> | run
export type RecipeSource = string;

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
  '"0:11-1:10"), ep, youtubeLayout ("cover", "stills", "clips"). perPlatform: values for one platform only, e.g. ' +
  '{ "youtube": { "verseEffect": "cinematic-fade" } } (verseEffect, hookEffect, verseFont, hookFont, accentColour, section).';

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
  for (const k of ["verseEffect", "hookEffect"] as const) {
    if (recipe[k] === undefined) continue;
    try {
      parseEffectChoice(recipe[k]!, k);
    } catch (error) {
      problems.push((error as Error).message);
      delete recipe[k];
    }
  }
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
  if (r.perPlatform !== undefined) {
    const { values, problems: more } = checkPerPlatform(r.perPlatform, "perPlatform");
    problems.push(...more);
    if (Object.keys(values).length) recipe.perPlatform = values;
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

// song.json's text: the help line, the fields in a fixed order, then locked.
export function recipeJson(recipe: SongRecipe): string {
  const ordered: Record<string, unknown> = { _help: RECIPE_HELP };
  for (const k of RECIPE_FIELDS) if (recipe[k] !== undefined) ordered[k] = recipe[k];
  if (recipe.perPlatform && Object.keys(recipe.perPlatform).length) ordered.perPlatform = recipe.perPlatform;
  if (recipe.locked?.length) ordered.locked = recipe.locked;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function writeRecipe(file: string, recipe: SongRecipe): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, recipeJson(recipe));
}

// Each setting's value and where it comes from; with `platform`, the values for that platform.
export type RecipeInput = {
  library: RecipeValues;
  artist: Partial<RecipeValues>;
  artistPlatforms?: PerPlatform; // brand.json perPlatform
  presets?: PerPlatform; // platforms.json motion (lyric effects) per platform
  song: SongRecipe;
  run?: Partial<RecipeValues>;
};

export function resolveRecipe(input: RecipeInput, platform?: string): ResolvedRecipe {
  const locked = input.song.locked ?? [];
  const values = {} as Record<RecipeField, unknown>;
  const sources = {} as Record<RecipeField, RecipeSource>;
  const ignored: ResolvedRecipe["ignored"] = [];
  for (const k of RECIPE_FIELDS) {
    const each = !!platform && isPlatformField(k);
    let layers: [RecipeSource, unknown][] = [
      ["library", input.library[k]],
      ["artist", input.artist[k]],
      ...(each ? ([["platforms.json", input.presets?.[platform]?.[k as PlatformField]], [`artist:${platform}`, input.artistPlatforms?.[platform]?.[k as PlatformField]]] as [RecipeSource, unknown][]) : []),
      ["song", input.song[k]],
      ...(each ? ([[`song:${platform}`, input.song.perPlatform?.[platform]?.[k as PlatformField]]] as [RecipeSource, unknown][]) : []),
    ];
    if (locked.includes(k)) layers = layers.filter(([source]) => source === "song" || source.startsWith("song:"));
    for (const [source, value] of layers) if (value !== undefined) [values[k], sources[k]] = [value, source];
    const run = input.run?.[k];
    if (run === undefined) continue;
    if (locked.includes(k)) {
      if (JSON.stringify(run) !== JSON.stringify(values[k])) ignored.push({ field: k, run, kept: values[k] });
    } else [values[k], sources[k]] = [run, "run"];
  }
  return { values: values as RecipeValues, sources, locked, ignored };
}

// The song's own value of a field (its default, or for one platform), or undefined.
export function songValue(song: SongRecipe, field: RecipeField, platform?: string): unknown {
  return platform ? song.perPlatform?.[platform]?.[field as PlatformField] : song[field];
}

// Sets the song's own value (Style tab), as default or for one platform.
export function setField(song: SongRecipe, field: RecipeField, value: unknown, platform?: string): SongRecipe {
  if (!platform) return { ...song, [field]: value } as SongRecipe;
  if (!isPlatformField(field)) throw new Error(`${field} cannot differ per platform`);
  return { ...song, perPlatform: { ...song.perPlatform, [platform]: { ...song.perPlatform?.[platform], [field]: value } } };
}

// "Save to song": the run's choices become the song's own (locked settings are left alone).
export function saveToSong(song: SongRecipe, run: Partial<RecipeValues>): SongRecipe {
  const next: SongRecipe = { ...song };
  for (const k of RECIPE_FIELDS) if (run[k] !== undefined && !(song.locked ?? []).includes(k)) (next as Record<string, unknown>)[k] = run[k];
  return next;
}

// "Reset": back to inherited (and unlocked); with `platform`, only that platform's own value goes.
export function resetField(song: SongRecipe, field: RecipeField, platform?: string): SongRecipe {
  if (platform) {
    const own = { ...song.perPlatform?.[platform] };
    delete own[field as PlatformField];
    const perPlatform = { ...song.perPlatform, [platform]: own };
    if (!Object.keys(own).length) delete perPlatform[platform];
    const next: SongRecipe = { ...song, perPlatform };
    if (!Object.keys(perPlatform).length) delete next.perPlatform;
    return next;
  }
  const next: SongRecipe = { ...song };
  delete next[field];
  next.locked = (song.locked ?? []).filter((k) => k !== field);
  if (!next.locked.length) delete next.locked;
  return next;
}

// Lock: the current value (also an inherited one) becomes the song's own and stays; for a field that
// can differ per platform, the current per-platform values that differ from it are kept too.
export function lockField(song: SongRecipe, field: RecipeField, current: unknown, perPlatformNow: Record<string, unknown> = {}): SongRecipe {
  let next = { ...song, [field]: song[field] ?? current } as SongRecipe;
  if (isPlatformField(field)) {
    for (const [platform, value] of Object.entries(perPlatformNow)) {
      if (value !== undefined && JSON.stringify(value) !== JSON.stringify(next[field]) && songValue(next, field, platform) === undefined) next = setField(next, field, value, platform);
    }
  }
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

// platforms.json motion (lyric effects per platform) as recipe values.
export function presetMotion(presets: Record<string, Pick<PlatformPreset, "name" | "motion">>): PerPlatform {
  const out: PerPlatform = {};
  for (const p of Object.values(presets)) {
    if (!p.motion) continue;
    out[p.name] = {
      ...(p.motion.verseEffect ? { verseEffect: choiceText(p.motion.verseEffect) } : {}),
      ...(p.motion.hookEffect ? { hookEffect: choiceText(p.motion.hookEffect) } : {}),
    };
  }
  return out;
}

