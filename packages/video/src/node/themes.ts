// Themes (31 Oct 2026, decided by the user): a song's whole look in one place, "like a website theme":
// once a theme is active for a song, the user does not think about fonts or design again.
//   WORKSPACE_DIR\themes\<name>\theme.json   the look (versioned), checked when it is read
//   WORKSPACE_DIR\themes\<name>\fonts\       font files the theme brings (later step: the Theme editor)
//   WORKSPACE_DIR\themes\<name>\overlays\    transparent PNGs per format (later step)
//   WORKSPACE_DIR\themes\<name>\preview.png  the tile picture (optional)
// A song points to its theme with song.json "theme". In the recipe the theme sits above the artist's brand
// and below the song: library -> brand -> brand (platform) -> theme -> theme (platform) -> song -> run.
// The first time a song without a theme is read, its look moves into a theme (ensureSongTheme): a song
// with no look of its own follows the artist's default theme (named after the artist, made from brand.json);
// a song with its own fonts / effects / colour gets a theme named after it (or an identical existing one).
// Nothing looks different afterwards.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { project as projectTable, safeName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { loadBrand } from "./brand";
import type { FontCatalog } from "./font-catalog";
import { findFamily } from "./font-catalog";
import { checkPerPlatform, type PerPlatform, type PlatformValues } from "./per-platform";
import { artistRecipe, checkRecipe, LIBRARY_RECIPE, readRecipe, resolveRecipe, writeRecipe, type RecipeField, type RecipeValues, type SongRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export const THEME_VERSION = 1;
// What a theme decides: the fonts, the lyric effects, the accent colour and the add-ons.
export const THEME_FIELDS = ["verseFont", "verseWeight", "verseItalic", "hookFont", "hookWeight", "hookItalic", "verseEffect", "hookEffect", "accentColour", "breathe", "heldGlow", "chorusLift", "shine"] as const satisfies readonly RecipeField[];
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
};
export type ThemeInfo = { name: string; folder: string; theme: Theme; problems: string[]; preview: string | null };

export const isThemeField = (k: string): k is ThemeField => (THEME_FIELDS as readonly string[]).includes(k);

const HELP =
  "A Lyric Studio theme: the whole look of a song (fonts, lyric effects, accent colour, add-ons). Songs point to it with " +
  'song.json "theme". look: verseFont / hookFont (a family from pnpm fonts), verseWeight / hookWeight (100-900), verseItalic / hookItalic (true / false), ' +
  'verseEffect / hookEffect ("glide", "soft-blur:subtle", ...), accentColour ("#E8A3B5"), breathe (off | gentle | beat), heldGlow / chorusLift / shine (off | on). ' +
  'perPlatform: values for one platform, e.g. { "youtube": { "verseEffect": "cinematic-fade" } }. author / licence: who made the theme and its terms; ' +
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
  const theme: Theme = { version: THEME_VERSION, name, description: text("description"), author: text("author"), licence: text("licence"), fonts, look, perPlatform, createdAt: text("createdAt") };
  return { theme, problems };
}

function themeJson(theme: Theme): string {
  const out: Record<string, unknown> = { _help: HELP, version: THEME_VERSION, name: theme.name };
  if (theme.description) out.description = theme.description;
  if (theme.author) out.author = theme.author;
  if (theme.licence) out.licence = theme.licence;
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

// Makes (or finds) a theme with this look: an existing theme with the very same look is reused.
export function themeForLook(workspaceDir: string, wanted: string, look: ThemeLook, perPlatform: Record<string, Partial<ThemeLook>>, description = ""): string {
  const existing = readThemeFile(workspaceDir, wanted);
  if (existing && sameLook(existing.theme, { look, perPlatform })) return existing.name;
  for (const t of listThemes(workspaceDir)) if (sameLook(t.theme, { look, perPlatform })) return t.name;
  const name = existing ? freeThemeName(workspaceDir, wanted) : wanted.trim() || freeThemeName(workspaceDir, "My theme");
  writeTheme(workspaceDir, { version: THEME_VERSION, name, description, author: "", licence: "", fonts: [], look, perPlatform, createdAt: new Date().toISOString() });
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
  const ownPlatforms = Object.entries(song.perPlatform ?? {}).filter(([, v]) => THEME_FIELDS.some((k) => (v as PlatformValues)[k] !== undefined));
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
    name = themeForLook(ws.dir, row.title, look, perPlatform, `The look ${row.title} had`);
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

// The songs that use a theme (title and id).
export function themeUsers(ws: Workspace, name: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const p of ws.db.select({ id: projectTable.id, title: projectTable.title }).from(projectTable).all()) {
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
    theme = { ...theme, name: freeThemeName(ws.dir, row?.title ?? theme.name), description: `Made from ${theme.name}`, createdAt: new Date().toISOString() };
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

// Duplicates a theme (a new name; the song keeps its own until it is told to use the copy).
export function duplicateTheme(workspaceDir: string, name: string, newName?: string): string {
  const theme = loadTheme(workspaceDir, name);
  const copy = freeThemeName(workspaceDir, newName?.trim() || `${theme.name} copy`);
  writeTheme(workspaceDir, { ...theme, name: copy, description: `Made from ${theme.name}`, createdAt: new Date().toISOString() });
  return copy;
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
  return name;
}
