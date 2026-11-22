// Themes (31 Oct 2026, decided by the user): a song's whole look in one place, "like a website theme":
// once a theme is active for a song, the user does not think about fonts or design again.
//   WORKSPACE_DIR\themes\<name>\theme.json   the look (versioned), checked when it is read
//   WORKSPACE_DIR\themes\<name>\fonts\       font files the theme brings (later step: the Theme editor)
//   WORKSPACE_DIR\themes\<name>\overlays\    transparent PNGs per format (later step)
//   WORKSPACE_DIR\themes\<name>\preview.png  the tile picture (optional)
//   WORKSPACE_DIR\themes\<name>\cover.jpg    the Theme cover (.jpg / .png / .webp; optional, set on the Themes page):
//                                              the picture its previews show; without one, a neutral backdrop
//                                              in the theme's colours (never a song's picture, 1 Nov 2026)
// A song points to its theme with song.json "theme". In the recipe the theme sits above the artist's brand
// and below the song: library -> brand -> brand (platform) -> theme -> theme (platform) -> song -> run.
// The first time a song without a theme is read, its look moves into a theme (ensureSongTheme): a song
// with no look of its own follows the artist's default theme (named after the artist, made from brand.json);
// a song with its own fonts / effects / colour gets a theme named after it (or an identical existing one).
// Nothing looks different afterwards.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ffmpegBin, project as projectTable, safeName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { brandDirFor, loadBrand } from "./brand";
import { THEME_MOODS, type ThemeMood } from "../theme-moods";
import type { FontCatalog } from "./font-catalog";
import { findFamily } from "./font-catalog";
import { checkPerPlatform, type PerPlatform, type PlatformValues } from "./per-platform";
import { artistRecipe, checkRecipe, LIBRARY_RECIPE, readRecipe, resolveRecipe, writeRecipe, type RecipeField, type RecipeValues, type SongRecipe } from "./recipe";
import { isRemovedSong, songPathsById } from "./song-folder";

export const THEME_VERSION = 1;
// What a theme decides: the fonts, the lyric effects, the accent colour and the add-ons.
export const THEME_FIELDS = ["verseFont", "verseWeight", "verseItalic", "hookFont", "hookWeight", "hookItalic", "verseEffect", "hookEffect", "accentColour", "breathe", "heldGlow", "chorusLift", "shine", "emphasis", "textColour", "grade", "vignette", "grain", "textBacking", "fallback", "fallbackColour", "gradeCanvas", "titleStyle", "titleWarp", "hookCard", "hookCardStyle", "endCard", "endCardStyle", "textLayout", "lineShape", "lineBuild", "finalHook"] as const satisfies readonly RecipeField[];
export type ThemeField = (typeof THEME_FIELDS)[number];
export type ThemeLook = Pick<RecipeValues, ThemeField>;
// A theme folder is self-contained, so it can later be shared or sold as one file (a zip of the folder):
// its own fonts in fonts\ (each listed with its licence), overlays in overlays\, the author and licence.
export type ThemeFont = { family: string; files: string[]; licence: string }; // files: inside fonts\; licence e.g. "OFL-1.1"
export type Theme = {
  version: number;
  name: string; // shown on the tile; the folder is its safe name
  description: string;
  author: string; // who designed it ("" = you)
  licence: string; // the theme's own terms, e.g. "personal use" ("" = yours)
  fonts: ThemeFont[]; // the font files the theme brings (fonts\)
  look: ThemeLook; // every field set: a theme never depends on the brand
  perPlatform: Record<string, Partial<ThemeLook>>; // e.g. { "youtube": { "verseEffect": "cinematic-fade" } }
  createdAt: string;
  moods: ThemeMood[]; // the Themes page's mood filters (1 Nov 2026), ticked on the theme's page
};

export { THEME_MOODS, type ThemeMood };
export type ThemeInfo = { name: string; folder: string; theme: Theme; problems: string[]; preview: string | null };

export const isThemeField = (k: string): k is ThemeField => (THEME_FIELDS as readonly string[]).includes(k);

const HELP =
  "A Lyric Studio theme: the whole look of a song (fonts, lyric effects, accent colour, add-ons). Songs point to it with " +
  'song.json "theme". look: verseFont / hookFont (a family from pnpm fonts), verseWeight / hookWeight (100-900), verseItalic / hookItalic (true / false), ' +
  'verseEffect / hookEffect ("glide", "soft-blur:subtle", ...), accentColour ("#E8A3B5"), breathe (off | gentle | beat), heldGlow / chorusLift / shine / emphasis (off | on), textColour ("#FFFFFF"), grade (natural | warm | cool | faded | mono | moody), vignette (off | soft | strong), grain (off | light | medium: film grain over the picture), textBacking (none | shadow | glow | band | box), fallback (gradient | colour | cover: where there is no clip), fallbackColour ("#101014"), gradeCanvas (on | off: the Spotify Canvas graded too), titleStyle (plain | outline | layered | extrude | label), titleWarp (none | arc | wave), hookCard / endCard (off | on: a card in the pause before the first chorus / a call to action at the end, Reels, TikTok, Shorts), hookCardStyle / endCardStyle (like titleStyle), textLayout (centre | lower | bighook: where and how big the lyrics sit), lineShape (subtitle | stacked: one or two long rows, or 2-4 short rows of 1-3 words), lineBuild (replace | build: a line appears whole, or row by row as it is sung), finalHook (off | on: the last chorus of the video larger, its last line larger still). ' +
  'perPlatform: values for one platform, e.g. { "youtube": { "verseEffect": "cinematic-fade" } }. author / licence: who made the theme and its terms; moods: the mood filters of the Themes page (Romantic, Night, Warm, Minimal, Bright, Moody); ' +
  'fonts: the font files in this folder\'s fonts\\ with their licence. The folder is self-contained (fonts\\, overlays\\, preview.png). Edit it in the studio (Shape → Theme), not here.';

export function themesDir(workspaceDir: string): string {
  return path.join(workspaceDir, "themes");
}
export function themeFolder(workspaceDir: string, name: string): string {
  return path.join(themesDir(workspaceDir), safeName(name));
}

function pickLook(values: Partial<RecipeValues>): Partial<ThemeLook> {
  const out: Record<string, unknown> = {};
  for (const k of THEME_FIELDS) if (values[k] !== undefined) out[k] = values[k];
  return out as Partial<ThemeLook>;
}

// Checks a theme.json; every problem in plain words. Missing look fields take the library defaults.
export function checkTheme(raw: unknown, catalog?: FontCatalog): { theme: Theme; problems: string[] } {
  const problems: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "";
  if (!name) problems.push("name is missing");
  const version = typeof r.version === "number" ? r.version : THEME_VERSION;
  if (version > THEME_VERSION) problems.push(`made by a newer Lyric Studio (version ${version}); update the app`);
  const lookRaw = r.look && typeof r.look === "object" ? (r.look as Record<string, unknown>) : {};
  for (const k of Object.keys(lookRaw)) if (!isThemeField(k)) problems.push(`look.${k} is not part of a theme`);
  const checked = checkRecipe(Object.fromEntries(Object.entries(lookRaw).filter(([k]) => isThemeField(k))));
  problems.push(...checked.problems.map((p) => `look: ${p}`));
  const look = { ...pickLook(LIBRARY_RECIPE), ...pickLook(checked.recipe) } as ThemeLook;
  const perPlatform: Record<string, Partial<ThemeLook>> = {};
  if (r.perPlatform !== undefined) {
    const pp = checkPerPlatform(r.perPlatform, "perPlatform");
    problems.push(...pp.problems);
    for (const [platform, values] of Object.entries(pp.values)) {
      const mine = pickLook(values as Partial<RecipeValues>);
      for (const k of Object.keys(values)) if (!isThemeField(k)) problems.push(`perPlatform.${platform}.${k} is not part of a theme`);
      if (Object.keys(mine).length) perPlatform[platform] = mine;
    }
  }
  if (catalog) {
    const fonts = [look.verseFont, look.hookFont, ...Object.values(perPlatform).flatMap((v) => [v.verseFont, v.hookFont])].filter(Boolean) as string[];
    for (const f of new Set(fonts)) if (!findFamily(catalog, f)) problems.push(`font "${f}" not found (put its files in the fonts folder, or pick another font)`);
  }
  const fonts: ThemeFont[] = [];
  if (r.fonts !== undefined) {
    if (!Array.isArray(r.fonts)) problems.push('fonts must be a list like [{ "family": "Inter", "files": ["Inter-400.woff2"], "licence": "OFL-1.1" }]');
    else
      for (const [i, f] of (r.fonts as unknown[]).entries()) {
        const x = (f ?? {}) as Record<string, unknown>;
        if (typeof x.family !== "string" || !x.family.trim()) problems.push(`fonts[${i}].family is missing`);
        else if (typeof x.licence !== "string" || !x.licence.trim()) problems.push(`fonts[${i}] (${x.family}): its licence is missing (e.g. "OFL-1.1")`);
        else fonts.push({ family: x.family.trim(), files: Array.isArray(x.files) ? x.files.filter((y): y is string => typeof y === "string") : [], licence: x.licence.trim() });
      }
  }
  const text = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  const moods: ThemeMood[] = [];
  if (r.moods !== undefined) {
    if (!Array.isArray(r.moods)) problems.push(`moods must be a list like ["Romantic", "Night"] (${THEME_MOODS.join(", ")})`);
    else
      for (const m of r.moods) {
        if ((THEME_MOODS as readonly unknown[]).includes(m)) moods.includes(m as ThemeMood) || moods.push(m as ThemeMood);
        else problems.push(`moods: "${String(m)}" is not one of ${THEME_MOODS.join(", ")}`);
      }
  }
  const theme: Theme = { version: THEME_VERSION, name, description: text("description"), author: text("author"), licence: text("licence"), fonts, look, perPlatform, createdAt: text("createdAt"), moods };
  return { theme, problems };
}

function themeJson(theme: Theme): string {
  const out: Record<string, unknown> = { _help: HELP, version: THEME_VERSION, name: theme.name };
  if (theme.description) out.description = theme.description;
  if (theme.author) out.author = theme.author;
  if (theme.licence) out.licence = theme.licence;
  if (theme.moods?.length) out.moods = theme.moods;
  if (theme.fonts.length) out.fonts = theme.fonts;
  out.look = Object.fromEntries(THEME_FIELDS.map((k) => [k, theme.look[k]]));
  if (Object.keys(theme.perPlatform).length) out.perPlatform = theme.perPlatform;
  if (theme.createdAt) out.createdAt = theme.createdAt;
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function writeTheme(workspaceDir: string, theme: Theme): string {
  const dir = themeFolder(workspaceDir, theme.name);
  mkdirSync(path.join(dir, "fonts"), { recursive: true });
  mkdirSync(path.join(dir, "overlays"), { recursive: true });
  const file = path.join(dir, "theme.json");
  writeFileSync(file, themeJson(theme));
  return file;
}

export function readThemeFile(workspaceDir: string, name: string, catalog?: FontCatalog): ThemeInfo | null {
  const dir = themeFolder(workspaceDir, name);
  const file = path.join(dir, "theme.json");
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { name, folder: dir, theme: checkTheme({ name }).theme, problems: [`theme.json is not valid JSON (${(error as Error).message})`], preview: null };
  }
  const { theme, problems } = checkTheme(raw, catalog);
  if (!theme.name) theme.name = name;
  const preview = path.join(dir, "preview.png");
  return { name: theme.name, folder: dir, theme, problems, preview: existsSync(preview) ? preview : null };
}

// A theme by name; a missing or broken one is named in plain words.
export function loadTheme(workspaceDir: string, name: string, catalog?: FontCatalog): Theme {
  const info = readThemeFile(workspaceDir, name, catalog);
  if (!info) throw new Error(`Theme "${name}" not found (themes\\${safeName(name)}\\theme.json). Pick another theme for this song.`);
  if (info.problems.length) throw new Error(`Theme "${name}" has problems:\n  - ${info.problems.join("\n  - ")}`);
  return info.theme;
}

export function listThemes(workspaceDir: string, catalog?: FontCatalog): ThemeInfo[] {
  const dir = themesDir(workspaceDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(path.join(dir, d.name, "theme.json")))
    .map((d) => readThemeFile(workspaceDir, d.name, catalog)!)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The look a theme gives one platform (or the default look).
export function themeValues(theme: Theme, platform?: string): ThemeLook {
  return { ...theme.look, ...(platform ? theme.perPlatform[platform] : {}) };
}

// The recipe layer of a theme.
export function themeLayer(theme: Theme): { look: Partial<RecipeValues>; perPlatform: PerPlatform } {
  return { look: theme.look, perPlatform: theme.perPlatform as PerPlatform };
}

const sameLook = (a: Theme, b: Pick<Theme, "look" | "perPlatform">) => JSON.stringify([a.look, sortKeys(a.perPlatform)]) === JSON.stringify([b.look, sortKeys(b.perPlatform)]);
function sortKeys(o: Record<string, Partial<ThemeLook>>): [string, Partial<ThemeLook>][] {
  return Object.keys(o)
    .sort()
    .map((k) => [k, Object.fromEntries(Object.entries(o[k]).sort(([x], [y]) => x.localeCompare(y)))]);
}

// A free theme name: "Hold On", "Hold On 2", ...
export function freeThemeName(workspaceDir: string, wanted: string): string {
  const base = wanted.trim() || "My theme";
  let name = base;
  for (let n = 2; existsSync(themeFolder(workspaceDir, name)); n++) name = `${base} ${n}`;
  return name;
}

// A theme made from a song's own look has a plain name, "<song> look", so it never reads as the song itself
// (asked by the user on 1 Nov 2026: a theme named like its song was taken for the song), and says where it
// came from in About.
export const songLookName = (title: string) => `${title.trim()} look`;
const day = (iso = new Date().toISOString()) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const songLookAbout = (title: string, iso?: string) => `Made from ${title.trim()}'s look on ${day(iso)}`;

// Themes made before 1 Nov 2026 from a song's look carry the song's very name ("The look X had"): they get
// the plain name and the About line. Renamed like the user's Rename (songs and brand.json follow); a theme
// the user named or renamed is left alone. Returns the renames done.
export function plainSongThemeNames(ws: Workspace): { from: string; to: string }[] {
  const done: { from: string; to: string }[] = [];
  for (const t of listThemes(ws.dir)) {
    const m = /^The look (.+) had$/.exec(t.theme.description);
    if (!m || safeName(m[1]) !== safeName(t.name)) continue;
    const to = renameTheme(ws, t.name, freeThemeName(ws.dir, songLookName(m[1])));
    writeTheme(ws.dir, { ...loadTheme(ws.dir, to), description: songLookAbout(m[1], t.theme.createdAt || undefined) });
    done.push({ from: t.name, to });
  }
  return done;
}

// Makes (or finds) a theme with this look: an existing theme with the very same look is reused.
export function themeForLook(workspaceDir: string, wanted: string, look: ThemeLook, perPlatform: Record<string, Partial<ThemeLook>>, description = ""): string {
  const existing = readThemeFile(workspaceDir, wanted);
  if (existing && sameLook(existing.theme, { look, perPlatform })) return existing.name;
  for (const t of listThemes(workspaceDir)) if (sameLook(t.theme, { look, perPlatform })) return t.name;
  const name = existing ? freeThemeName(workspaceDir, wanted) : wanted.trim() || freeThemeName(workspaceDir, "My theme");
  writeTheme(workspaceDir, { version: THEME_VERSION, name, description, author: "", licence: "", fonts: [], look, perPlatform, createdAt: new Date().toISOString(), moods: [] });
  return name;
}

// The look the brand gives (library + brand.json, per platform where the brand sets one).
function brandLook(brand: ReturnType<typeof loadBrand>["brand"], platforms: string[]): { look: ThemeLook; perPlatform: Record<string, Partial<ThemeLook>> } {
  const input = { library: LIBRARY_RECIPE, artist: artistRecipe(brand), artistPlatforms: brand.perPlatform, song: {} };
  const look = pickLook(resolveRecipe(input).values) as ThemeLook;
  const perPlatform: Record<string, Partial<ThemeLook>> = {};
  for (const p of platforms) {
    const own = pickLook((brand.perPlatform[p] ?? {}) as Partial<RecipeValues>);
    if (Object.keys(own).length) perPlatform[p] = own;
  }
  return { look, perPlatform };
}

// The artist's default theme (named after the artist, made from brand.json the first time); brand.json
// "theme" names it once it exists.
export function artistDefaultTheme(ws: Workspace, artist: string, catalog: FontCatalog): string {
  const brand = loadBrand(ws.dir, catalog, artist);
  const raw = JSON.parse(readFileSync(brand.file, "utf8")) as Record<string, unknown>;
  if (typeof raw.theme === "string" && readThemeFile(ws.dir, raw.theme)) return raw.theme;
  const platforms = Object.keys(brand.brand.perPlatform);
  const { look, perPlatform } = brandLook(brand.brand, platforms);
  const name = themeForLook(ws.dir, artist || "My theme", look, perPlatform, `${artist}'s default look (from the brand)`);
  writeFileSync(brand.file, `${JSON.stringify({ ...raw, theme: name }, null, 2)}\n`);
  return name;
}

// Moves a song's look into a theme the first time it is read without one (see the top of this file).
// Returns the song.json as it is now. Songs without a folder are left alone.
export function ensureSongTheme(ws: Workspace, projectId: string, catalog: FontCatalog): SongRecipe {
  const paths = songPathsById(ws, projectId);
  const song = paths.recipe ? readRecipe(paths.recipe) : {};
  if (song.theme || !paths.recipe) return song;
  const row = ws.db.select({ artist: projectTable.artist, title: projectTable.title }).from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!row) return song;
  const ownDefault = THEME_FIELDS.filter((k) => song[k] !== undefined);
  const ownPlatforms = Object.entries(song.perPlatform ?? {}).filter(([, v]) => THEME_FIELDS.some((k) => (v as Record<string, unknown>)[k] !== undefined));
  let name: string;
  if (!ownDefault.length && !ownPlatforms.length) name = artistDefaultTheme(ws, row.artist, catalog);
  else {
    const brand = loadBrand(ws.dir, catalog, row.artist);
    const platforms = [...new Set([...Object.keys(brand.brand.perPlatform), ...Object.keys(song.perPlatform ?? {})])];
    const input = { library: LIBRARY_RECIPE, artist: artistRecipe(brand.brand), artistPlatforms: brand.brand.perPlatform, song: { ...song, locked: [] } };
    const look = pickLook(resolveRecipe(input).values) as ThemeLook;
    const perPlatform: Record<string, Partial<ThemeLook>> = {};
    for (const p of platforms) {
      const at = pickLook(resolveRecipe(input, p).values) as ThemeLook;
      const diff = Object.fromEntries(THEME_FIELDS.filter((k) => JSON.stringify(at[k]) !== JSON.stringify(look[k])).map((k) => [k, at[k]]));
      if (Object.keys(diff).length) perPlatform[p] = diff as Partial<ThemeLook>;
    }
    name = themeForLook(ws.dir, songLookName(row.title), look, perPlatform, songLookAbout(row.title));
  }
  const next: SongRecipe = { ...song, theme: name };
  for (const k of THEME_FIELDS) delete next[k];
  if (next.perPlatform) {
    const pp: PerPlatform = {};
    for (const [p, v] of Object.entries(next.perPlatform)) {
      const rest = Object.fromEntries(Object.entries(v).filter(([k]) => !isThemeField(k)));
      if (Object.keys(rest).length) pp[p] = rest as PlatformValues;
    }
    if (Object.keys(pp).length) next.perPlatform = pp;
    else delete next.perPlatform;
  }
  if (next.locked) {
    next.locked = next.locked.filter((k) => !isThemeField(k));
    if (!next.locked.length) delete next.locked;
  }
  writeRecipe(paths.recipe, next);
  return next;
}

// Every song on a theme and every artist's default theme there, so that the theme list offers them all (the
// Theme panel shows the brand's theme even before another song was opened). A song that cannot be read is
// skipped here (its own page names the problem).
export function ensureAllThemes(ws: Workspace, catalog: FontCatalog): void {
  const artists = new Set<string>();
  for (const p of ws.db.select({ id: projectTable.id, artist: projectTable.artist, folder: projectTable.folder }).from(projectTable).all()) {
    if (isRemovedSong(p.folder)) continue; // a deleted song keeps its song.json as it was
    artists.add(p.artist);
    try {
      ensureSongTheme(ws, p.id, catalog);
    } catch {
      // named on that song's page
    }
  }
  for (const artist of artists) {
    try {
      artistDefaultTheme(ws, artist, catalog);
    } catch {
      // a broken brand.json is named on the song pages
    }
  }
  plainSongThemeNames(ws);
}

// The songs that use a theme (title and id).
export function themeUsers(ws: Workspace, name: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const p of ws.db.select({ id: projectTable.id, title: projectTable.title, folder: projectTable.folder }).from(projectTable).all()) {
    if (isRemovedSong(p.folder)) continue; // a deleted song (songs\_removed\)
    const file = songPathsById(ws, p.id).recipe;
    if (!file || !existsSync(file)) continue;
    try {
      if (readRecipe(file).theme === name) out.push(p);
    } catch {
      // a broken song.json is named where that song is opened
    }
  }
  return out;
}

// Points a song to a theme.
export function chooseTheme(ws: Workspace, projectId: string, name: string, catalog: FontCatalog): void {
  loadTheme(ws.dir, name, catalog);
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  writeRecipe(file, { ...ensureSongTheme(ws, projectId, catalog), theme: name });
}

// Changes to a song's theme (the Theme editor, a font pairing, Generate's "Save to song", a reaction).
// scope "all": the theme itself (every song using it); "song": when other songs use the theme too, a copy
// named after the song gets the change and this song uses the copy (a theme only this song uses is
// changed in place). A null value removes a per-platform value.
export function setThemeLook(
  ws: Workspace,
  o: { projectId: string; values: Partial<Record<ThemeField, unknown>>; platform?: string; scope: "all" | "song"; catalog: FontCatalog },
): { theme: string; copied: boolean } {
  const song = ensureSongTheme(ws, o.projectId, o.catalog);
  if (!song.theme) throw new Error("This song has no theme yet.");
  for (const k of Object.keys(o.values)) if (!isThemeField(k)) throw new Error(`${k} is not part of a theme.`);
  let theme = loadTheme(ws.dir, song.theme);
  let copied = false;
  if (o.scope === "song" && themeUsers(ws, theme.name).some((u) => u.id !== o.projectId)) {
    const row = ws.db.select({ title: projectTable.title }).from(projectTable).where(eq(projectTable.id, o.projectId)).get();
    theme = { ...theme, name: freeThemeName(ws.dir, row?.title ? songLookName(row.title) : theme.name), description: `Made from ${theme.name} for ${row?.title ?? "this song"} on ${day()}`, createdAt: new Date().toISOString() };
    copied = true;
  }
  const next: Theme = { ...theme, look: { ...theme.look }, perPlatform: { ...theme.perPlatform } };
  for (const [field, value] of Object.entries(o.values)) {
    if (o.platform) {
      const own = { ...next.perPlatform[o.platform] } as Record<string, unknown>;
      if (value === null || value === undefined) delete own[field];
      else own[field] = value;
      if (Object.keys(own).length) next.perPlatform[o.platform] = own as Partial<ThemeLook>;
      else delete next.perPlatform[o.platform];
    } else if (value !== null && value !== undefined) (next.look as Record<string, unknown>)[field] = value;
  }
  const { problems } = checkTheme(JSON.parse(themeJson(next)), o.catalog);
  if (problems.length) throw new Error(problems.join("\n"));
  writeTheme(ws.dir, next);
  if (copied) writeRecipe(songPathsById(ws, o.projectId).recipe!, { ...song, theme: next.name });
  return { theme: next.name, copied };
}

// Duplicates a theme (a new name; the song keeps its own until it is told to use the copy). Its Theme cover
// comes along.
export function duplicateTheme(workspaceDir: string, name: string, newName?: string): string {
  const theme = loadTheme(workspaceDir, name);
  const copy = freeThemeName(workspaceDir, newName?.trim() || `${theme.name} copy`);
  writeTheme(workspaceDir, { ...theme, name: copy, description: `Made from ${theme.name}`, createdAt: new Date().toISOString() });
  for (const cover of [themeCover(workspaceDir, name), themeCoverVideo(workspaceDir, name)]) if (cover) copyFileSync(cover, path.join(themeFolder(workspaceDir, copy), path.basename(cover)));
  return copy;
}

// ---- The Theme cover (1 Nov 2026): the theme's own picture or video, kept in its folder (portable with it) ----
// A picture stays a picture (cover.jpg|png|webp). A video (like Canva) is kept as cover-video.<ext> and its
// first frame becomes the still cover.jpg, shown wherever the theme stands still; the video loops on hover.

export const THEME_COVER_EXTS = [".jpg", ".jpeg", ".png", ".webp"] as const;
export const THEME_COVER_VIDEO_EXTS = [".mp4", ".mov", ".m4v", ".webm"] as const;

export function themeCover(workspaceDir: string, name: string): string | null {
  const dir = themeFolder(workspaceDir, name);
  for (const ext of THEME_COVER_EXTS) {
    const file = path.join(dir, `cover${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

export function themeCoverVideo(workspaceDir: string, name: string): string | null {
  const dir = themeFolder(workspaceDir, name);
  for (const ext of THEME_COVER_VIDEO_EXTS) {
    const file = path.join(dir, `cover-video${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

// The cover in use (picture and video) goes to the theme folder's _replaced\ (nothing the user made is deleted).
function retireCover(workspaceDir: string, name: string): string | null {
  const files = [themeCover(workspaceDir, name), themeCoverVideo(workspaceDir, name)].filter((f): f is string => !!f);
  if (!files.length) return null;
  const dir = path.join(themeFolder(workspaceDir, name), "_replaced");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  let first: string | null = null;
  for (const f of files) {
    const to = path.join(dir, `${path.basename(f, path.extname(f))}-${stamp}${path.extname(f)}`);
    renameSync(f, to);
    first ??= to;
  }
  return first;
}

// Sets the Theme cover from a picture or a video file (copied in; the file itself is left where it is).
export function setThemeCover(workspaceDir: string, name: string, file: string, originalName = file): string {
  loadTheme(workspaceDir, name);
  let ext = path.extname(originalName).toLowerCase();
  if (ext === ".jpeg") ext = ".jpg";
  const video = (THEME_COVER_VIDEO_EXTS as readonly string[]).includes(ext);
  if (!video && !(THEME_COVER_EXTS as readonly string[]).includes(ext)) throw new Error("A Theme cover is a picture (JPG, PNG, WebP) or a video (MP4, MOV, M4V, WebM).");
  const dir = themeFolder(workspaceDir, name);
  if (video) {
    // The still first: a file that is not a readable video changes nothing.
    const still = path.join(dir, "cover-new.jpg");
    try {
      execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", file, "-frames:v", "1", "-q:v", "3", still], { windowsHide: true, timeout: 60_000 });
    } catch {
      rmSync(still, { force: true });
      throw new Error("This video could not be read: try an MP4 or MOV.");
    }
    retireCover(workspaceDir, name);
    renameSync(still, path.join(dir, "cover.jpg"));
    const to = path.join(dir, `cover-video${ext}`);
    copyFileSync(file, to);
    return to;
  }
  retireCover(workspaceDir, name);
  const to = path.join(dir, `cover${ext}`);
  copyFileSync(file, to);
  return to;
}

// Takes the Theme cover off (kept in _replaced\): the previews show the neutral backdrop again.
export function removeThemeCover(workspaceDir: string, name: string): string | null {
  loadTheme(workspaceDir, name);
  return retireCover(workspaceDir, name);
}

// Renames a theme folder and every song.json pointing to it.
export function renameTheme(ws: Workspace, from: string, to: string): string {
  const theme = loadTheme(ws.dir, from);
  const name = to.trim();
  if (!name) throw new Error("A theme needs a name.");
  if (safeName(name) !== safeName(from) && existsSync(themeFolder(ws.dir, name))) throw new Error(`A theme called "${name}" already exists.`);
  const users = themeUsers(ws, from);
  if (safeName(name) !== safeName(from)) renameSync(themeFolder(ws.dir, from), themeFolder(ws.dir, name));
  writeTheme(ws.dir, { ...theme, name });
  for (const u of users) {
    const file = songPathsById(ws, u.id).recipe!;
    writeRecipe(file, { ...readRecipe(file), theme: name });
  }
  // An artist's default theme (brand.json "theme", "new songs start on it") keeps being the default under its
  // new name (1 Nov 2026: renaming "Life Lyrics" seemed to do nothing, the brand still named the old one).
  const artists = new Set(ws.db.select({ artist: projectTable.artist }).from(projectTable).all().map((r) => r.artist));
  const files = new Set([path.join(brandDirFor(ws.dir, null), "brand.json"), ...[...artists].map((a) => path.join(brandDirFor(ws.dir, a), "brand.json"))]);
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      if (raw.theme === from) writeFileSync(file, `${JSON.stringify({ ...raw, theme: name }, null, 2)}\n`);
    } catch {
      // a brand.json that is not valid JSON is reported where the brand is read
    }
  }
  return name;
}

// ---- The theme editor (31 Oct 2026): New theme, Save, Save as new theme, Delete / Restore ----

// The look a theme editor sends, checked like theme.json (plain-word problems).
function lookFrom(ws: Workspace, name: string, base: Theme, look: unknown, perPlatform: unknown, catalog: FontCatalog): Theme {
  const raw = { ...JSON.parse(themeJson(base)), name, look: look ?? base.look, perPlatform: perPlatform ?? base.perPlatform };
  const { theme, problems } = checkTheme(raw, catalog);
  if (problems.length) throw new Error(problems.join("\n"));
  return theme;
}

function mustBeFree(workspaceDir: string, name: string): string {
  const clean = name.trim();
  if (!clean) throw new Error("Give the theme a name.");
  if (clean.startsWith("_")) throw new Error("A theme name cannot start with _.");
  if (existsSync(themeFolder(workspaceDir, clean))) throw new Error(`A theme called "${clean}" already exists: pick another name.`);
  return clean;
}

// "+ New theme": a new theme named first, started from another theme (its look, fonts and overlays as they
// are); the song uses it straight away.
export function createTheme(ws: Workspace, o: { projectId: string; name: string; from: string; catalog: FontCatalog }): string {
  const name = mustBeFree(ws.dir, o.name);
  const from = loadTheme(ws.dir, o.from, o.catalog);
  writeTheme(ws.dir, { ...from, name, description: `Started from ${from.name}`, createdAt: new Date().toISOString() });
  chooseTheme(ws, o.projectId, name, o.catalog);
  return name;
}

// "Save": the editor's whole look into the theme being edited (the song's own unless the editor was opened
// on another theme from the Themes page); every song that uses it follows.
export function saveTheme(ws: Workspace, o: { projectId: string; theme?: string; look: unknown; perPlatform: unknown; catalog: FontCatalog }): string {
  const song = ensureSongTheme(ws, o.projectId, o.catalog);
  const name = o.theme || song.theme;
  if (!name) throw new Error("This song has no theme yet.");
  const base = loadTheme(ws.dir, name, o.catalog);
  writeTheme(ws.dir, lookFrom(ws, base.name, base, o.look, o.perPlatform, o.catalog));
  return base.name;
}

// "Save as new theme": the editor's look as a new theme (named first); the theme it came from stays as it
// was. When the editor was on the song's own theme, the song uses the new one.
export function saveThemeAs(ws: Workspace, o: { projectId: string; theme?: string; name: string; look: unknown; perPlatform: unknown; catalog: FontCatalog }): string {
  const name = mustBeFree(ws.dir, o.name);
  const song = ensureSongTheme(ws, o.projectId, o.catalog);
  const from = o.theme || song.theme!;
  const base = loadTheme(ws.dir, from, o.catalog);
  writeTheme(ws.dir, { ...lookFrom(ws, name, base, o.look, o.perPlatform, o.catalog), description: `Made from ${base.name}`, createdAt: new Date().toISOString() });
  if (from === song.theme) chooseTheme(ws, o.projectId, name, o.catalog);
  return name;
}

// The themes the artists' brands start new songs on (brand.json "theme").
export function brandThemes(ws: Workspace, catalog: FontCatalog): Map<string, string> {
  const out = new Map<string, string>(); // theme -> artist
  const artists = new Set(ws.db.select({ artist: projectTable.artist }).from(projectTable).all().map((r) => r.artist));
  for (const artist of artists) {
    try {
      const raw = JSON.parse(readFileSync(loadBrand(ws.dir, catalog, artist).file, "utf8")) as { theme?: unknown };
      if (typeof raw.theme === "string") out.set(raw.theme, artist);
    } catch {
      // no brand.json yet
    }
  }
  return out;
}

export type RemovedTheme = { folder: string; name: string; removedAt: string };
const pad2 = (n: number) => String(n).padStart(2, "0");
const REMOVED_THEME = /^(.*) \(removed (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\)$/;

// "Delete": the folder moves to themes\_removed\<name> (removed <date>); nothing is deleted. A theme that a
// song uses, or that an artist's new songs start on, is refused with what to do instead.
export function removeTheme(ws: Workspace, name: string, catalog: FontCatalog): string {
  const theme = loadTheme(ws.dir, name, catalog);
  const users = themeUsers(ws, theme.name);
  if (users.length) throw new Error(`${users.length} song${users.length === 1 ? "" : "s"} use${users.length === 1 ? "s" : ""} "${theme.name}" (${users.map((u) => u.title).join(", ")}): give ${users.length === 1 ? "it" : "them"} another theme first.`);
  const artist = brandThemes(ws, catalog).get(theme.name);
  if (artist !== undefined) throw new Error(`"${theme.name}" is the theme new songs of ${artist || "this artist"} start on: it cannot be deleted.`);
  const at = new Date();
  const label = `${safeName(theme.name)} (removed ${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())})`;
  const removed = path.join(themesDir(ws.dir), "_removed");
  mkdirSync(removed, { recursive: true });
  renameSync(themeFolder(ws.dir, theme.name), path.join(removed, label));
  return label;
}

export function removedThemes(workspaceDir: string): RemovedTheme[] {
  const dir = path.join(themesDir(workspaceDir), "_removed");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const m = REMOVED_THEME.exec(d.name);
      return m ? { folder: d.name, name: m[1], removedAt: new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]).toISOString() } : { folder: d.name, name: d.name, removedAt: "" };
    })
    .sort((a, b) => b.removedAt.localeCompare(a.removedAt));
}

// "Restore": back to themes\<name> ("<name> 2" when that name was taken since).
export function restoreTheme(workspaceDir: string, folder: string): string {
  const entry = removedThemes(workspaceDir).find((r) => r.folder === folder);
  if (!entry) throw new Error(`No removed theme "${folder}".`);
  const from = path.join(themesDir(workspaceDir), "_removed", folder);
  const theme = JSON.parse(readFileSync(path.join(from, "theme.json"), "utf8")) as { name?: string };
  const name = freeThemeName(workspaceDir, typeof theme.name === "string" ? theme.name : entry.name);
  renameSync(from, themeFolder(workspaceDir, name));
  if (name !== theme.name) writeFileSync(path.join(themeFolder(workspaceDir, name), "theme.json"), `${JSON.stringify({ ...theme, name }, null, 2)}\n`);
  return name;
}

// The theme's details on the Themes page: its description and who made it (the designer credit).
export function setThemeDetails(workspaceDir: string, name: string, d: { description?: string; author?: string; licence?: string; moods?: unknown }): void {
  const theme = loadTheme(workspaceDir, name);
  const moods = Array.isArray(d.moods) ? THEME_MOODS.filter((m) => (d.moods as unknown[]).includes(m)) : theme.moods;
  writeTheme(workspaceDir, { ...theme, description: d.description?.trim() ?? theme.description, author: d.author?.trim() ?? theme.author, licence: d.licence?.trim() ?? theme.licence, moods });
}

// "Use these colours" (colours from the Theme cover, 1 Nov 2026): the lyric text and the accent (the chorus
// words use the accent) of a theme. Only #RRGGBB colours; the rest of the look stays as it is.
export function setThemeColours(workspaceDir: string, name: string, c: { textColour?: unknown; accentColour?: unknown }): void {
  const theme = loadTheme(workspaceDir, name);
  const ok = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  if (!ok(c.textColour) && !ok(c.accentColour)) throw new Error("Give a colour as #RRGGBB.");
  writeTheme(workspaceDir, { ...theme, look: { ...theme.look, ...(ok(c.textColour) ? { textColour: c.textColour.toUpperCase() } : {}), ...(ok(c.accentColour) ? { accentColour: c.accentColour.toUpperCase() } : {}) } });
}

// The Themes page's "+ New theme": named first, a copy of another theme (no song changes).
export function newTheme(workspaceDir: string, name: string, from: string): string {
  const clean = mustBeFree(workspaceDir, name);
  const base = loadTheme(workspaceDir, from);
  writeTheme(workspaceDir, { ...base, name: clean, description: `Started from ${base.name}`, createdAt: new Date().toISOString() });
  return clean;
}
