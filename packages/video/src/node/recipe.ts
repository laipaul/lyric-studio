// The song's recipe: song.json in its folder. Every setting is inherited unless the song sets it:
//   library defaults -> the artist's brand (brand\<artist>\brand.json) -> the song (song.json)
//   -> this run (Generate / command-line options; kept only with "save to song").
// A locked setting keeps the song's value: a later brand change does not reach it, and a run cannot
// change it (the run's choice is ignored, with a note).
// Per platform (Step 6.2c-2a): brand.json and song.json may hold "perPlatform": { "youtube": {
// "verseEffect": "cinematic-fade" } } for the PLATFORM_FIELDS. For one platform the order is (weakest
// first): library -> artist -> artist (that platform) -> song -> song (that platform) -> run.
// platforms.json is format only (size, length, safe zones, ...): it never sets the style.
// A locked field uses only the song's values (its default and per-platform ones).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkAnchors, type AnchorSpec, type GapOrder } from "../anchors";
import { ENDING_VALUES, type EndingChoice } from "../ending";
import { TRANSITION_STYLES, type TransitionStyle } from "../transitions";
import { READABILITY_VALUES, type Readability } from "../readability";
import { FALLBACKS, GRADES, TEXT_BACKINGS, TITLE_STYLES, TITLE_WARPS, VIGNETTES, type Fallback, type Grade, type TextBacking, type TitleStyle, type TitleWarp, type Vignette } from "../picture";
import { TEXT_LAYOUTS, type TextLayout } from "../text-layout";
import { choiceText, DEFAULT_HOOK_EFFECT, DEFAULT_VERSE_EFFECT, parseEffectChoice } from "../effects/names";
import { DEFAULT_BRAND, type Brand } from "./brand";
import { checkPerPlatform, isPlatformField, isWeight, SHOT_LENGTH_VALUES, PLATFORM_FIELDS, type PerPlatform, type PlatformField } from "./per-platform";

export const RECIPE_FIELDS = ["verseEffect", "hookEffect", "verseFont", "hookFont", "verseWeight", "hookWeight", "verseItalic", "hookItalic", "accentColour", "shotLength", "tempo", "collections", "platforms", "variations", "section", "length", "ending", "transitions", "paceShift", "readability", "breathe", "heldGlow", "chorusLift", "shine", "emphasis", "titleOpening", "tagline", "ep", "youtubeLayout", "textColour", "grade", "vignette", "textBacking", "fallback", "fallbackColour", "gradeCanvas", "titleStyle", "titleWarp", "hookCard", "hookCardStyle", "endCard", "endCardStyle", "hookText", "endText", "textLayout"] as const;
export type RecipeField = (typeof RECIPE_FIELDS)[number];

export type RecipeValues = {
  verseEffect: string; // "glide", "soft-blur:subtle"
  hookEffect: string;
  verseFont: string; // font family
  hookFont: string;
  verseWeight: number; // 100-900: the exact weight file (the nearest the family has, with a warning)
  hookWeight: number;
  verseItalic: boolean; // the family's italic file (never a synthetic italic)
  hookItalic: boolean;
  accentColour: string; // #RRGGBB
  shotLength: string | null; // "auto" (default: the app chooses), "1" | "2" | "4" | "8" bars per shot, "story", or "rate" (the cut rate)
  tempo: number | null; // BPM override for this song (the beats are re-tracked around it); null: as detected
  collections: string[]; // shared collections used with the song's own clips
  platforms: string[]; // the platforms Generate starts with
  variations: Record<string, number>; // videos per platform
  section: string; // auto | full | 0:11-1:10
  length: number | null; // target seconds for an "auto" section (null: the platform preset's length)
  paceShift: number; // bars added to (+) or taken from (-) the automatic pacing (reactions "cuts too fast / slow"), -3..+4
  readability: Readability; // auto (default): the app adds the soft backing when the clips need it; normal: never; strong: always
  breathe: "off" | "gentle" | "beat"; // the lyrics swell softly while on screen: every 4 s, or once a bar on the downbeats
  heldGlow: "off" | "on"; // a held note's word brightens in the accent colour while it is held
  chorusLift: "off" | "on"; // the first line of each chorus arrives a touch bigger and brighter
  shine: "off" | "on"; // one soft light sweep across each chorus line, on a downbeat
  emphasis: "off" | "on"; // the key word of each line (the longest held) in the hook font, bigger and in the accent colour
  titleOpening: "off" | "on"; // Reels / TikTok / Shorts: the title, byline and tagline before the first hook (the app places and times them)
  tagline: string; // the song's own tagline (a short line under the title); empty: none (never taken from the EP) // strong: a soft dark band behind the lyrics (reaction "lyrics hard to read")
  transitions: TransitionStyle; // between shots: "auto" (the app chooses cuts, dissolves and dips from the music), "crisp" (cuts), "flowing" (dissolves)
  ending: EndingChoice; // Reels / TikTok / Shorts: "auto" (the app chooses: tight loop, soft fade or ring-out), or one of them
  ep: string;
  youtubeLayout: "cover" | "stills" | "clips";
  // The theme's picture (src/picture.ts): drawn over the clips and around the words, never changing a clip.
  textColour: string; // #RRGGBB: the lyrics' colour (the accent stays for highlights, glow, the hook's touches)
  grade: Grade; // one colour grade on every clip
  vignette: Vignette;
  textBacking: TextBacking; // behind the words (readability "auto" still adds the band by itself when needed)
  textLayout: TextLayout; // where and how big the lyrics sit (src/text-layout.ts): centre | lower | bighook
  fallback: Fallback; // where there is no clip
  fallbackColour: string; // #RRGGBB, for fallback "colour"
  gradeCanvas: "off" | "on"; // the Spotify Canvas gets the grade too (on) or keeps the clips' colours (off)
  titleStyle: TitleStyle; // the title card: plain, outline, layered (outline over an accent copy), extrude (3D), label (on an accent bar)
  titleWarp: TitleWarp; // the title card's shape: none, arc, wave
  // The theme's extra cards (Reels / TikTok / Shorts; the app places and times them, never over a lyric line):
  hookCard: "off" | "on"; // a big card in the pause before the first chorus (hookText, else the chorus's first line)
  hookCardStyle: TitleStyle;
  endCard: "off" | "on"; // the call to action at the end (endText)
  endCardStyle: TitleStyle;
  hookText: string; // the song's hook card text; empty: the first chorus line
  endText: string; // the end card's text; {title} and {artist} are filled in
};

export { isPlatformField, isWeight, ITALIC_FIELDS, PLATFORM_FIELDS, WEIGHT_FIELDS, type PerPlatform, type PlatformField, type PlatformValues } from "./per-platform";

// anchors and gapOrder belong to the song only (story anchors, the Lyrics tab): never from the brand,
// outside Reset / Lock.
// canvas: the clip (and moment, seconds) chosen for the Spotify Canvas (the clip editor's "Use for Canvas").
// theme: the song's theme (themes\<name>\theme.json): its fonts, effects, accent colour and add-ons.
export type SongRecipe = Partial<RecipeValues> & { theme?: string; perPlatform?: PerPlatform; locked?: RecipeField[]; anchors?: AnchorSpec[]; gapOrder?: GapOrder; canvas?: { clip: string; at?: number }; instrumental?: boolean };
// library | artist | artist:<platform> | song | song:<platform> | run
export type RecipeSource = string;

export type ResolvedRecipe = {
  values: RecipeValues;
  sources: Record<RecipeField, RecipeSource>;
  locked: RecipeField[];
  ignored: { field: RecipeField; run: unknown; kept: unknown }[]; // run choices a lock kept out
};

export const RECIPE_HELP =
  'The recipe of this song. "theme": the name of the song\'s theme (themes\\<name>\\theme.json), which sets its fonts, lyric effects, accent colour and add-ons; pick or edit it in the studio (Shape → Theme). ' +
  "The other settings: A setting that is not here is inherited from the artist's brand (brand.json) " +
  "or the library defaults; a setting here is this song's own. \"locked\": settings that keep this song's value " +
  "(a brand change does not reach them, and Generate cannot change them for one run). Fields: verseEffect, hookEffect " +
  '("glide", "soft-blur:subtle", ...), verseFont, hookFont, verseWeight / hookWeight (400 = regular, 600 = semibold, 700 = bold), verseItalic / hookItalic (true / false), accentColour ("#E8A3B5"), shotLength ("auto" = the app chooses from the song and your clips; or "1", "2", "4", "8" bars per shot, "story": 2 bars on hooks, 4 on verses, never under 3 s, or "rate": the cut rate), tempo (the real BPM of this song when the detected one is wrong, e.g. 92), collections (shared collections used ' +
  'with the clips in clips\\), platforms (["reels", "youtube"]), variations ({ "reels": 3 }), section ("auto", "full", ' +
  '"0:11-1:10"), length (seconds an "auto" section aims for, e.g. 90; empty = the platform preset), transitions ("auto" = the app chooses cuts, dissolves and dips from the music; "crisp" = cuts; "flowing" = dissolves), paceShift (bars added to the automatic pacing, e.g. 1 = calmer; set by the reactions), readability ("auto" = the app adds a soft dark band behind the lyrics when the clips are bright behind them; "strong" = always; "normal" = never), titleOpening ("on" = the title, byline and tagline before the first hook on Reels, TikTok and Shorts), tagline (a short line under the title; empty = none), ending ("auto" = the app chooses how a Reel / TikTok / Short ends: a tight loop, a soft fade or a ring-out; or "loop", "fade", "ring-out"), ep, youtubeLayout ("cover", "stills", "clips"). perPlatform: values for one platform only, e.g. ' +
  '{ "youtube": { "verseEffect": "cinematic-fade" } } (verseEffect, hookEffect, verseFont, hookFont, accentColour, section, length), e.g. { "reels": { "length": 90 }, "tiktok": { "length": 30 } }. ' +
  'Story anchors (the Lyrics tab sets them): anchors [{ "line": 9, "clip": "hands.mp4", "clipIn": 1.5, "transition": "dissolve" }] = that clip lands on lyrics.txt line 9 ' +
  '(cut in on the downbeat before the line, held until it ends); gapOrder "story" (default with anchors: the other clips in file-name order in every video) or "shuffle".';

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
  if (r.shotLength !== undefined && r.shotLength !== null) {
    if ((SHOT_LENGTH_VALUES as readonly string[]).includes(String(r.shotLength))) recipe.shotLength = String(r.shotLength);
    else problems.push(`shotLength must be ${SHOT_LENGTH_VALUES.join(", ")} (auto = the app chooses; bars per shot; "story": 2 bars on hooks, 4 on verses; "rate": the cut rate)`);
  }
  if (r.titleOpening !== undefined) {
    if (r.titleOpening === "off" || r.titleOpening === "on") recipe.titleOpening = r.titleOpening;
    else problems.push("titleOpening must be off or on");
  }
  for (const k of ["hookText", "endText"] as const) {
    if (r[k] === undefined) continue;
    if (typeof r[k] === "string" && (r[k] as string).length <= 80) recipe[k] = (r[k] as string).trim();
    else problems.push(`${k} must be a short text (at most 80 characters)`);
  }
  if (r.tagline !== undefined) {
    if (typeof r.tagline === "string" && r.tagline.length <= 120) recipe.tagline = r.tagline.trim();
    else problems.push("tagline must be a short text (at most 120 characters)");
  }
  if (r.paceShift !== undefined) {
    if (Number.isInteger(r.paceShift) && (r.paceShift as number) >= -3 && (r.paceShift as number) <= 4) recipe.paceShift = r.paceShift as number;
    else problems.push("paceShift must be a whole number of bars from -3 to 4 (added to the automatic pacing)");
  }
  if (r.readability !== undefined) {
    if ((READABILITY_VALUES as readonly unknown[]).includes(r.readability)) recipe.readability = r.readability as Readability;
    else problems.push("readability must be auto, normal or strong (auto = the app adds a soft backing behind the lyrics when the clips need it)");
  }
  if (r.breathe !== undefined) {
    if (r.breathe === "off" || r.breathe === "gentle" || r.breathe === "beat") recipe.breathe = r.breathe;
    else problems.push('breathe must be off, gentle or beat (the lyrics swell softly while on screen; beat: once a bar, on the downbeats)');
  }
  for (const k of ["heldGlow", "chorusLift", "shine", "emphasis"] as const) {
    if (r[k] === undefined) continue;
    if (r[k] === "off" || r[k] === "on") recipe[k] = r[k];
    else problems.push(`${k} must be off or on`);
  }
  if (r.transitions !== undefined) {
    if ((TRANSITION_STYLES as readonly string[]).includes(String(r.transitions))) recipe.transitions = r.transitions as TransitionStyle;
    else problems.push(`transitions must be ${TRANSITION_STYLES.join(", ")} (auto = the app chooses cuts, dissolves and dips from the music)`);
  }
  if (r.ending !== undefined) {
    if ((ENDING_VALUES as readonly string[]).includes(String(r.ending))) recipe.ending = r.ending as EndingChoice;
    else problems.push(`ending must be ${ENDING_VALUES.join(", ")} (auto = the app chooses how a Reel / TikTok / Short ends)`);
  }
  if (r.tempo !== undefined && r.tempo !== null) {
    if (typeof r.tempo === "number" && r.tempo >= 30 && r.tempo <= 300) recipe.tempo = Math.round(r.tempo * 100) / 100;
    else problems.push("tempo must be a number of BPM from 30 to 300 (the song's real tempo)");
  }
  for (const k of ["verseWeight", "hookWeight"] as const) {
    if (r[k] === undefined) continue;
    if (isWeight(r[k])) recipe[k] = r[k] as number;
    else problems.push(`${k} must be a font weight: 100, 200, ... 900 (400 = regular, 600 = semibold, 700 = bold)`);
  }
  for (const k of ["verseItalic", "hookItalic"] as const) {
    if (r[k] === undefined) continue;
    if (typeof r[k] === "boolean") recipe[k] = r[k] as boolean;
    else problems.push(`${k} must be true or false`);
  }
  if (r.length !== undefined && r.length !== null) {
    if (typeof r.length === "number" && Number.isFinite(r.length) && r.length >= 3 && r.length <= 600) recipe.length = Math.round(r.length);
    else problems.push("length must be a number of seconds from 3 to 600 (the target for an auto section)");
  }
  for (const k of ["textColour", "fallbackColour"] as const) {
    if (r[k] === undefined) continue;
    if (typeof r[k] === "string" && /^#[0-9a-fA-F]{6}$/.test(r[k] as string)) recipe[k] = r[k] as string;
    else problems.push(`${k} must look like "#FFFFFF"`);
  }
  for (const [k, list] of [["grade", GRADES], ["vignette", VIGNETTES], ["textBacking", TEXT_BACKINGS], ["fallback", FALLBACKS], ["gradeCanvas", ["off", "on"]], ["titleStyle", TITLE_STYLES], ["titleWarp", TITLE_WARPS], ["hookCard", ["off", "on"]], ["endCard", ["off", "on"]], ["hookCardStyle", TITLE_STYLES], ["endCardStyle", TITLE_STYLES], ["textLayout", TEXT_LAYOUTS]] as const) {
    if (r[k] === undefined) continue;
    if ((list as readonly unknown[]).includes(r[k])) (recipe as Record<string, unknown>)[k] = r[k];
    else problems.push(`${k} must be ${list.join(", ")}`);
  }
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
  if (r.anchors !== undefined) {
    const checked = checkAnchors(r.anchors);
    problems.push(...checked.problems);
    if (checked.anchors.length) recipe.anchors = checked.anchors;
  }
  if (r.canvas !== undefined && r.canvas !== null) {
    const c = r.canvas as { clip?: unknown; at?: unknown };
    if (typeof c.clip === "string" && c.clip.trim() && (c.at === undefined || (typeof c.at === "number" && c.at >= 0))) recipe.canvas = { clip: c.clip.trim(), ...(c.at !== undefined ? { at: Math.round((c.at as number) * 100) / 100 } : {}) };
    else problems.push('canvas must look like { "clip": "05_flowers.mp4", "at": 2.5 } (the clip chosen for the Spotify Canvas; at: seconds)');
  }
  if (r.instrumental !== undefined) {
    if (r.instrumental === true) recipe.instrumental = true;
    else if (r.instrumental !== false) problems.push("instrumental must be true or false (true: no sung lyrics; the text is story.txt)");
  }
  if (r.theme !== undefined) {
    if (typeof r.theme === "string" && r.theme.trim()) recipe.theme = r.theme.trim();
    else problems.push("theme must be the name of a theme");
  }
  if (r.gapOrder !== undefined) {
    if (r.gapOrder === "story" || r.gapOrder === "shuffle") recipe.gapOrder = r.gapOrder;
    else problems.push('gapOrder must be "story" or "shuffle"');
  }
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
  if (recipe.instrumental) ordered.instrumental = true;
  if (recipe.theme) ordered.theme = recipe.theme;
  for (const k of RECIPE_FIELDS) if (recipe[k] !== undefined) ordered[k] = recipe[k];
  if (recipe.perPlatform && Object.keys(recipe.perPlatform).length) ordered.perPlatform = recipe.perPlatform;
  if (recipe.locked?.length) ordered.locked = recipe.locked;
  if (recipe.gapOrder) ordered.gapOrder = recipe.gapOrder;
  if (recipe.anchors?.length) ordered.anchors = recipe.anchors;
  if (recipe.canvas) ordered.canvas = recipe.canvas;
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
  theme?: { look: Partial<RecipeValues>; perPlatform: PerPlatform }; // the song's theme (themes.ts)
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
      ...(each ? ([[`artist:${platform}`, input.artistPlatforms?.[platform]?.[k as PlatformField]]] as [RecipeSource, unknown][]) : []),
      ["theme", input.theme?.look[k]],
      ...(each ? ([[`theme:${platform}`, input.theme?.perPlatform[platform]?.[k as PlatformField]]] as [RecipeSource, unknown][]) : []),
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
  verseWeight: DEFAULT_BRAND.verseFont.weight,
  hookWeight: DEFAULT_BRAND.hookFont.weight,
  verseItalic: false,
  hookItalic: false,
  accentColour: DEFAULT_BRAND.accentColour,
  shotLength: "auto",
  tempo: null,
  collections: [], // none: the song's own clips (or the collection it used last time)
  platforms: [], // none: the "standard" preset
  variations: {}, // none: each platform preset's number
  section: "auto",
  length: null,
  ending: "auto",
  transitions: "auto",
  paceShift: 0,
  readability: "auto",
  breathe: "off",
  heldGlow: "off",
  chorusLift: "off",
  shine: "off",
  emphasis: "off",
  titleOpening: "off",
  tagline: "",
  ep: "",
  youtubeLayout: "cover",
  textColour: "#FFFFFF",
  grade: "natural",
  vignette: "off",
  textBacking: "none",
  textLayout: "centre",
  fallback: "gradient",
  fallbackColour: "#101014",
  gradeCanvas: "on",
  titleStyle: "plain",
  titleWarp: "none",
  hookCard: "off",
  hookCardStyle: "plain",
  endCard: "off",
  endCardStyle: "label",
  hookText: "",
  endText: "Stream {title} on Spotify",
};

// The artist's brand.json (fonts, accent colour, lyric effects).
export function artistRecipe(brand: Pick<Brand, "verseFont" | "hookFont" | "accentColour" | "motion" | "shotLength">): Partial<RecipeValues> {
  return {
    verseEffect: choiceText(brand.motion.verseEffect),
    hookEffect: choiceText(brand.motion.hookEffect),
    verseFont: brand.verseFont.family,
    hookFont: brand.hookFont.family,
    verseWeight: brand.verseFont.weight,
    hookWeight: brand.hookFont.weight,
    verseItalic: brand.verseFont.italic === true,
    hookItalic: brand.hookFont.italic === true,
    accentColour: brand.accentColour,
    ...(brand.shotLength ? { shotLength: brand.shotLength } : {}),
  };
}

// A run's choices ("pnpm make" options or the Generate panel). variations "*" = every platform.
export function runRecipe(o: {
  lineEffect?: string;
  hookEffect?: string;
  font?: string;
  fontHook?: string;
  weight?: number;
  hookWeight?: number;
  italic?: boolean;
  hookItalic?: boolean;
  shotLength?: string;
  tempo?: number;
  collection?: string;
  platforms?: string;
  variations?: number;
  section?: string;
  length?: number;
  ending?: EndingChoice;
  transitions?: TransitionStyle;
  ep?: string;
  layout?: RecipeValues["youtubeLayout"];
}): Partial<RecipeValues> {
  const list = (t?: string) => (t?.trim() ? t.split(/[\s,]+/).filter(Boolean) : undefined);
  const run: Partial<RecipeValues> = {
    verseEffect: o.lineEffect,
    hookEffect: o.hookEffect,
    verseFont: o.font,
    hookFont: o.fontHook,
    verseWeight: o.weight,
    hookWeight: o.hookWeight,
    verseItalic: o.italic,
    hookItalic: o.hookItalic,
    shotLength: o.shotLength,
    tempo: o.tempo,
    collections: list(o.collection),
    platforms: list(o.platforms?.toLowerCase()),
    variations: o.variations !== undefined ? { "*": o.variations } : undefined,
    section: o.section,
    length: o.length,
    ending: o.ending,
    transitions: o.transitions,
    ep: o.ep?.trim() || undefined,
    youtubeLayout: o.layout,
  };
  for (const k of RECIPE_FIELDS) if (run[k] === undefined) delete run[k];
  return run;
}

export function recipeText(v: unknown): string {
  if (v === null) return "preset";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (v && typeof v === "object") return Object.entries(v).map(([k, n]) => `${k === "*" ? "every platform" : k} ${n}`).join(", ") || "preset";
  return v === "" || v === undefined ? "none" : String(v);
}

// "verse glide (artist), hook karaoke-highlight (artist), collections wedding (song, locked), ..."
export function recipeSummary(r: ResolvedRecipe): string {
  const show: RecipeField[] = ["verseEffect", "hookEffect", "verseFont", "hookFont", "verseWeight", "hookWeight", "verseItalic", "hookItalic", "accentColour", "shotLength", "collections", "section"];
  for (const k of ["platforms", "variations", "ep", "youtubeLayout", "tempo", "ending", "transitions", "paceShift", "readability", "breathe", "heldGlow", "chorusLift", "shine", "emphasis", "titleOpening", "tagline"] as const) if (r.sources[k] !== "library") show.push(k);
  return show.map((k) => `${k} ${recipeText(r.values[k])} (${r.sources[k]}${r.locked.includes(k) ? ", locked" : ""})`).join(", ");
}


