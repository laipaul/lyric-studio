// Font pairings (presets/font-pairings.json, plus the artist's own brand fonts as "Artist's fonts"): a
// verse font and a hook font (and optionally a title font), each with weight and italic. The Style tab
// previews each pair on the song's own lines over a frame of its clips, warns per card, applies a pair
// to the song ("This song", locks respected) and only on request to the brand ("Save to brand").
// Remotion-free, so the studio's server can use it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, project as projectTable, REPO_ROOT, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import type { FontFileRef } from "../font-files";
import { lyricArea, parsePresets, type LyricArea } from "../platform";
import { loadBrand, type Brand } from "./brand";
import { findFamily, fontFileRefs, forText, loadFontCatalog, missingCharacters, resolveFont, userFontsDir, type FontCatalog } from "./font-catalog";
import { anchorClips } from "./lyrics-view";
import { isWeight } from "./per-platform";
import { readRecipe, resetField, resolveRecipe, setField, writeRecipe, type RecipeField, type SongRecipe } from "./recipe";
import { songPathsById } from "./song-folder";
import { recipeInputFor } from "./style";
import { setThemeLook } from "./themes";
import { bandLuminance } from "./lyric-band";
import { isThinFace, lyricContrast, type Readability } from "../readability";

export type PairFont = { family: string; weight: number; italic: boolean; script?: "thin" };
export type Pairing = { id: string; name: string; note: string; warning?: string; recommended?: boolean; brand?: boolean; verse: PairFont; hook: PairFont; title?: PairFont };

export const PAIRINGS_FILE = path.join(REPO_ROOT, "presets", "font-pairings.json");
export const PAIRING_FIELDS = ["verseFont", "hookFont", "verseWeight", "hookWeight", "verseItalic", "hookItalic"] as const satisfies readonly RecipeField[];
export const ACCENTS = ["é", "è", "ç", "à", "ô"];
export const LONG_HOOK_CHARS = 24; // a thin script on a hook longer than this is hard to read on a phone

// presets/font-pairings.json, checked: every problem named (a font or weight that does not exist).
export function parsePairings(json: unknown, catalog?: FontCatalog): { pairings: Pairing[]; problems: string[] } {
  const problems: string[] = [];
  const pairings: Pairing[] = [];
  const list = (json as { pairings?: unknown })?.pairings;
  if (!Array.isArray(list)) return { pairings, problems: ['font-pairings.json must look like { "pairings": [ ... ] }'] };
  const font = (raw: unknown, at: string): PairFont | null => {
    const f = raw as Record<string, unknown> | undefined;
    if (!f || typeof f.family !== "string" || !f.family.trim()) {
      problems.push(`${at}: needs a "family"`);
      return null;
    }
    const weight = f.weight === undefined ? 400 : f.weight;
    if (!isWeight(weight)) {
      problems.push(`${at}.weight must be 100, 200, ... 900`);
      return null;
    }
    const out: PairFont = { family: f.family.trim(), weight, italic: f.italic === true, ...(f.script === "thin" ? { script: "thin" as const } : {}) };
    if (catalog) {
      const fam = findFamily(catalog, out.family);
      if (!fam) problems.push(`${at}: font "${out.family}" not found (see pnpm fonts)`);
      else if (!fam.faces.some((x) => x.weight === out.weight && x.style === (out.italic ? "italic" : "normal"))) {
        problems.push(`${at}: ${out.family} has no ${out.weight}${out.italic ? " italic" : ""} (it has ${fam.faces.map((x) => `${x.weight}${x.style === "italic" ? " italic" : ""}`).join(", ")})`);
      }
    }
    return out;
  };
  list.forEach((raw, i) => {
    const p = raw as Record<string, unknown>;
    const at = `pairings[${i}]${typeof p?.id === "string" ? ` (${p.id})` : ""}`;
    if (!p || typeof p.id !== "string" || !/^[a-z0-9-]+$/.test(p.id)) return problems.push(`${at}: id must be lower case letters, digits and "-"`);
    if (p.id === "brand") return problems.push(`${at}: "brand" is the artist's own fonts; choose another id`);
    const verse = font(p.verse, `${at}.verse`);
    const hook = font(p.hook, `${at}.hook`);
    const title = p.title === undefined ? undefined : font(p.title, `${at}.title`);
    if (!verse || !hook || title === null) return;
    pairings.push({
      id: p.id, name: typeof p.name === "string" ? p.name : p.id, note: typeof p.note === "string" ? p.note : "",
      ...(typeof p.warning === "string" ? { warning: p.warning } : {}), ...(p.recommended === true ? { recommended: true } : {}),
      verse, hook, ...(title ? { title } : {}),
    });
  });
  return { pairings, problems };
}

// "Artist's fonts" (the artist's brand.json fonts) first, then the file's pairings.
export function loadPairings(catalog: FontCatalog, brand: Brand, file = PAIRINGS_FILE): { pairings: Pairing[]; problems: string[] } {
  const parsed = existsSync(file) ? parsePairings(JSON.parse(readFileSync(file, "utf8")), catalog) : { pairings: [], problems: [`${file} not found`] };
  const f = (b: Brand["verseFont"]): PairFont => ({ family: b.family, weight: b.weight, italic: b.italic === true });
  const own: Pairing = { id: "brand", name: "Artist's fonts", brand: true, note: "Your artist's own fonts (brand.json).", verse: f(brand.verseFont), hook: f(brand.hookFont), title: f(brand.titleFont) };
  return { pairings: [own, ...parsed.pairings], problems: parsed.problems };
}

export function findPairing(pairings: readonly Pairing[], id: string): Pairing {
  const p = pairings.find((x) => x.id === id.trim().toLowerCase());
  if (!p) throw new Error(`Unknown pairing "${id}". Known: ${pairings.map((x) => x.id).join(", ")}`);
  return p;
}

// ---------------------------------------------------------------- warnings

// WCAG contrast helpers live in ../readability (pure; the render's automatic backing uses them too).
export { contrastWith, relativeLuminance } from "../readability";

export type CardContext = {
  catalog: FontCatalog;
  lyricsText: string; // the song's lyrics.txt (its characters are checked)
  hookLines: string[];
  background: number | null; // relative luminance of the brightest part behind the lyrics (null: no frame)
  colour: string; // the lyric colour
  accent: string; // the hook effect's accent colour
  readability?: Readability; // the song's Lyric readability (auto: the app adds the backing by itself)
};

// One thing to know about a pair: in plain words (shown under the cards for the chosen pair) and the
// technical detail (one click away). kind "fonts" needs a creative choice (another pair); "contrast" is
// the app's job (the automatic backing); "script" is advice on the pair.
export type PairingNote = { kind: "fonts" | "contrast" | "script" | "pairing"; plain: string; detail: string };

const isThin = (f: PairFont) => isThinFace(f.family, 400, f.script);
const list = (chars: string[]) => `${chars.slice(0, 8).join(" ")}${chars.length > 8 ? " …" : ""}`;

// The card's notes: French accents, the song's own characters (e.g. Japanese), contrast over the
// sample frame, a thin script on long hook lines; plus the pairing's own warning.
export function pairingNotes(p: Pairing, ctx: CardContext): PairingNote[] {
  const out: PairingNote[] = [];
  const own = [...new Set([...ctx.lyricsText.replace(/\s/g, "")])].filter((c) => c.codePointAt(0)! > 0x7f && !ACCENTS.includes(c.toLowerCase()));
  const sung = new Set([...ctx.lyricsText.toLowerCase()]);
  const seen = new Set<string>();
  for (const [role, f] of [["verse", p.verse], ["hook", p.hook]] as const) {
    const key = `${f.family}|${f.weight}|${f.italic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let face;
    try {
      face = resolveFont(ctx.catalog, f.family, f.weight, f.italic).face;
    } catch (error) {
      const m = (error as Error).message;
      out.push({ kind: "fonts", plain: `${f.family} is not installed: choose another pair.`, detail: m });
      continue;
    }
    const accents = missingCharacters(forText(face, ACCENTS.join("")), ACCENTS);
    if (accents.length) {
      const used = accents.filter((a) => sung.has(a));
      out.push({
        kind: "fonts",
        plain: used.length
          ? `${f.family} cannot draw ${used.join(" ")} in this song's lyrics: those letters would show in another font. Choose another pair.`
          : `${f.family} has no French accents (${accents.join(" ")}): fine for this song, but choose another pair for French lyrics.`,
        detail: `${f.family} (${role}) has no ${accents.join(" ")}: French lyrics would show those in another font`,
      });
    }
    const missing = own.length ? missingCharacters(forText(face, own.join("")), own) : [];
    if (missing.length) {
      out.push({
        kind: "fonts",
        plain: `${f.family} cannot draw ${missing.length === 1 ? "a character" : `${missing.length} characters`} this song uses (${list(missing)}): they would show in another font. Choose another pair.`,
        detail: `${f.family} (${role}) lacks ${missing.length} character${missing.length === 1 ? "" : "s"} this song uses (${list(missing)}): they would show in another font`,
      });
    }
  }
  if (ctx.background !== null) {
    // Thin strokes need more contrast than regular text.
    const c = lyricContrast(ctx.background, { colour: ctx.colour, accent: ctx.accent, verseThin: isThinFace(p.verse.family, p.verse.weight, p.verse.script), hookThin: isThinFace(p.hook.family, p.hook.weight, p.hook.script) });
    // One short line: the frame is the same on every card, the need depends on the pair (thin strokes 4.5:1).
    const low = [
      ...(c.verse < c.verseNeed ? [`verse ${c.verse.toFixed(1)}:1${c.verseNeed > 3 ? " (thin)" : ""}`] : []),
      ...(c.accent < c.accentNeed ? [`hook accent ${c.accent.toFixed(1)}:1${c.accentNeed > 3 ? " (thin script)" : ""}`] : []),
    ];
    if (low.length) {
      const mode = ctx.readability ?? "auto";
      out.push({
        kind: "contrast",
        plain:
          mode === "strong"
            ? "Lyrics may be hard to read over this clip: the soft backing behind them is on."
            : mode === "normal"
              ? "Lyrics may be hard to read over this clip, and Lyric readability is set to normal (no backing): reset it under Automatic to let the app add a soft backing when needed."
              : "Lyrics may be hard to read over bright clips like this one: the app adds a soft backing behind them when your clips need it.",
        detail: `low contrast over this frame: ${low.join(", ")}; aim for 3:1, thin strokes 4.5:1`,
      });
    }
  }
  if (isThin(p.hook)) {
    const long = ctx.hookLines.filter((l) => l.length > LONG_HOOK_CHARS);
    if (long.length) {
      out.push({
        kind: "script",
        plain: `${p.hook.family} is a thin script: best on short hooks, and this song's hook is long.`,
        detail: `${p.hook.family} is a thin script on ${long.length === 1 ? "a long hook line" : `${long.length} long hook lines`} ("${long[0]}", ${long[0].length} characters): hard to read on a phone; best on short hooks, set large`,
      });
    }
  }
  if (p.warning) out.push({ kind: "pairing", plain: p.warning, detail: p.warning });
  return out;
}

// The notes' technical text (the card's tooltip, and the tests).
export function pairingWarnings(p: Pairing, ctx: CardContext): string[] {
  return pairingNotes(p, ctx).map((n) => n.detail);
}

// The plain line(s) under the cards for the chosen pair: font problems first (they need another pair),
// then the script advice (the pair's own warning only when it says nothing new), then readability.
export function plainNotes(notes: readonly PairingNote[]): string[] {
  const order = { fonts: 0, script: 1, pairing: 2, contrast: 3 } as const;
  const hasScript = notes.some((n) => n.kind === "script");
  return [...notes]
    .filter((n) => !(n.kind === "pairing" && hasScript))
    .sort((a, b) => order[a.kind] - order[b.kind])
    .map((n) => n.plain);
}

// ---------------------------------------------------------------- applying

// "This song": the pair's fonts, weights and italic into song.json; locked fields keep their value (named).
// The pair's fonts, weights and italic go into the song's theme (scope: see setThemeLook).
export function applyPairing(ws: Workspace, projectId: string, id: string, scope: "all" | "song" = "all"): { pairing: Pairing; applied: RecipeField[]; kept: RecipeField[] } {
  const { pairings } = context(ws, projectId);
  const p = findPairing(pairings, id);
  const values: Record<(typeof PAIRING_FIELDS)[number], unknown> = {
    verseFont: p.verse.family, hookFont: p.hook.family, verseWeight: p.verse.weight, hookWeight: p.hook.weight, verseItalic: p.verse.italic, hookItalic: p.hook.italic,
  };
  setThemeLook(ws, { projectId, values, scope, catalog: loadFontCatalog(ws.dir) });
  return { pairing: p, applied: [...PAIRING_FIELDS], kept: [] };
}

// "Back to the brand": the song's theme gets the brand's fonts again.
export function resetPairing(ws: Workspace, projectId: string, scope: "all" | "song" = "all"): { reset: RecipeField[]; kept: RecipeField[] } {
  const catalog = loadFontCatalog(ws.dir);
  const brand = loadBrand(ws.dir, catalog, artistOf(ws, projectId)).brand;
  const values = { verseFont: brand.verseFont.family, verseWeight: brand.verseFont.weight, verseItalic: brand.verseFont.italic === true, hookFont: brand.hookFont.family, hookWeight: brand.hookFont.weight, hookItalic: brand.hookFont.italic === true };
  setThemeLook(ws, { projectId, values, scope, catalog });
  return { reset: [...PAIRING_FIELDS], kept: [] };
}

// "Save to brand" (an explicit action): the pair becomes the artist's brand.json fonts (every song of
// the artist that does not set its own). The title font too when the pairing has one.
export function savePairingToBrand(ws: Workspace, projectId: string, id: string): { file: string; pairing: Pairing } {
  const catalog = loadFontCatalog(ws.dir);
  const artist = artistOf(ws, projectId);
  const brand = loadBrand(ws.dir, catalog, artist);
  const p = findPairing(loadPairings(catalog, brand.brand).pairings, id);
  const before = readFileSync(brand.file, "utf8");
  const raw = JSON.parse(before) as Record<string, Record<string, unknown> | unknown>;
  const set = (key: string, f: PairFont) => (raw[key] = { ...((raw[key] as Record<string, unknown>) ?? {}), family: f.family, weight: f.weight, italic: f.italic });
  set("verseFont", p.verse);
  set("hookFont", p.hook);
  if (p.title) set("titleFont", p.title);
  writeFileSync(brand.file, `${JSON.stringify(raw, null, 2)}\n`);
  try {
    loadBrand(ws.dir, catalog, artist); // checked like any brand.json; a bad value is put back
  } catch (error) {
    writeFileSync(brand.file, before);
    throw error;
  }
  return { file: path.relative(ws.dir, brand.file).split(path.sep).join("/"), pairing: p };
}

function artistOf(ws: Workspace, projectId: string): string {
  const row = ws.db.select({ artist: projectTable.artist }).from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!row) throw new Error("Song not found.");
  return row.artist;
}

function context(ws: Workspace, projectId: string) {
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const catalog = loadFontCatalog(ws.dir);
  const brand = loadBrand(ws.dir, catalog, artistOf(ws, projectId));
  return { file, song: readRecipe(file), pairings: loadPairings(catalog, brand.brand).pairings, catalog, brand };
}

// ---------------------------------------------------------------- the Style tab's cards

export type PairingCard = Pairing & {
  warnings: string[]; // the technical text (tooltip, details)
  plain: string[]; // the same in plain words (shown under the cards when this pair is the song's)
  fonts: FontFileRef[]; // the exact files (for the preview), relative to /api/fonts
  current: boolean; // this song's fonts are this pair now
};
export type PairingsView = {
  cards: PairingCard[];
  problems: string[]; // in presets/font-pairings.json
  verseLine: string;
  hookLine: string;
  highlightWords: number; // karaoke hook effect: the words sung so far in the preview (0: another hook effect)
  background: string | null; // workspace-relative image (a clip frame or the cover)
  backgroundFrom: string | null;
  bandLuminance: number | null; // how bright that frame is behind the lyrics (relative luminance, 0-1; null: no frame): the Look preview's backing
  textSize: number;
  area: LyricArea;
  colour: string;
  accent: string;
  locked: RecipeField[]; // of the pairing fields
  userFonts: string; // the folder for the user's own fonts (shown in the Style tab)
  platform: string; // the preview's layout
  readability: Readability; // the song's Lyric readability (auto: the app adds the backing when the clips need it)
};

// The song's verse and hook lines for the preview: the first sung verse line of 3+ words and the first hook.
export function sampleLines(lyricsText: string): { verse: string; hook: string; hooks: string[] } {
  const lines = lyricsText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[[(].*[\])]$/.test(l) && !/:\s*$/.test(l));
  const hooks = lines.filter((l) => l.startsWith("* ")).map((l) => l.slice(2).trim());
  const hookKeys = new Set(hooks.map((h) => h.toLowerCase()));
  const verses = lines.filter((l) => !l.startsWith("* ") && !hookKeys.has(l.toLowerCase()));
  const verse = verses.find((l) => l.split(/\s+/).length >= 3) ?? verses[0] ?? "Where the river meets the light";
  return { verse, hook: hooks[0] ?? lines.find((l) => l !== verse) ?? "You had a heart for two", hooks };
}

// The brightest part behind the lyric band (bandLuminance) lives in ./lyric-band (the render uses it too).
export { bandLuminance } from "./lyric-band";

export async function pairingsView(ws: Workspace, projectId: string, platformName = "reels"): Promise<PairingsView> {
  const { song, pairings, catalog, brand } = context(ws, projectId);
  const parsed = loadPairings(catalog, brand.brand);
  const paths = songPathsById(ws, projectId);
  const lyricsText = existsSync(paths.lyricsTxt) ? readFileSync(paths.lyricsTxt, "utf8") : "";
  const sample = sampleLines(lyricsText);
  const presetsFile = path.join(REPO_ROOT, "presets", "platforms.json");
  const presets = parsePresets(JSON.parse(readFileSync(presetsFile, "utf8")), presetsFile);
  const preset = presets[platformName] ?? presets.standard;
  const format = { width: preset.width, height: preset.height };
  const area = lyricArea(format, preset.safeZone, preset.lyricsAt);
  const { input } = recipeInputFor(ws, projectId, catalog);
  const recipe = resolveRecipe(input, preset.name);
  // A frame from the song's clips (its own first, then its collections), else its cover.
  const clips = await anchorClips(ws, projectId).catch(() => ({ clips: [] }));
  const frame = clips.clips.find((c) => c.thumb);
  const cover = paths.cover && existsSync(paths.cover) ? path.relative(ws.dir, paths.cover).split(path.sep).join("/") : null;
  const background = frame?.thumb ?? cover;
  const backgroundFrom = frame ? `a frame of ${frame.name}` : cover ? "the cover" : null;
  const luminance = background ? bandLuminance(absPath(ws, background), area, format.height) : null;
  const accent = recipe.values.accentColour;
  const ctx: CardContext = { catalog, lyricsText, hookLines: sample.hooks.length ? sample.hooks : [sample.hook], background: luminance, colour: "#ffffff", accent, readability: recipe.values.readability };
  const v = recipe.values;
  const cards = pairings.map((p) => {
    const files = (f: PairFont) => {
      try {
        return fontFileRefs(forText(resolveFont(catalog, f.family, f.weight, f.italic).face, `${sample.verse}${sample.hook}`));
      } catch {
        return [];
      }
    };
    const notes = pairingNotes(p, ctx);
    return {
      ...p,
      warnings: notes.map((n) => n.detail),
      plain: plainNotes(notes),
      fonts: [...files(p.verse), ...files(p.hook)],
      current:
        v.verseFont.toLowerCase() === p.verse.family.toLowerCase() && v.hookFont.toLowerCase() === p.hook.family.toLowerCase() &&
        v.verseWeight === p.verse.weight && v.hookWeight === p.hook.weight && v.verseItalic === p.verse.italic && v.hookItalic === p.hook.italic,
    };
  });
  return {
    cards,
    problems: parsed.problems,
    verseLine: sample.verse,
    hookLine: sample.hook,
    highlightWords: /karaoke/.test(v.hookEffect) ? Math.ceil(sample.hook.split(/\s+/).length / 2) : 0,
    background,
    backgroundFrom,
    bandLuminance: luminance,
    textSize: Math.round(64 * preset.textScale), // the Simple style's size, as in the video
    area,
    colour: "#ffffff",
    accent,
    locked: PAIRING_FIELDS.filter((k) => (song.locked ?? []).includes(k)),
    userFonts: userFontsDir(ws.dir),
    platform: preset.label,
    readability: recipe.values.readability,
  };
}
