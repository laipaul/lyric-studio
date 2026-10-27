// All fonts available to the video: the bundled @fontsource families and any .ttf/.otf/.woff/.woff2
// files in WORKSPACE_DIR\fonts. Used by render:test, the preview data, "pnpm fonts" and measuring.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";
import * as fontkit from "fontkit";

import { LATIN_EXT_RANGE, LATIN_RANGE, rangeCovers, type FontFileRef } from "../font-files";

// [npm package slug, family name]
export const BUNDLED_FONTS: [string, string][] = [
  ["inter", "Inter"],
  ["montserrat", "Montserrat"],
  ["cormorant-garamond", "Cormorant Garamond"],
  ["playfair-display", "Playfair Display"],
  ["dm-serif-display", "DM Serif Display"],
  ["fraunces", "Fraunces"],
  ["manrope", "Manrope"],
  ["bebas-neue", "Bebas Neue"],
  ["caveat", "Caveat"],
  ["kalam", "Kalam"],
  ["patrick-hand", "Patrick Hand"],
  ["kaushan-script", "Kaushan Script"],
  ["caveat-brush", "Caveat Brush"],
  ["yellowtail", "Yellowtail"],
  ["special-elite", "Special Elite"],
  ["courier-prime", "Courier Prime"],
  ["cinzel", "Cinzel"], // brand title font (OFL)
  // Font pairings (all SIL Open Font License; each package keeps its LICENSE file, see fonts/LICENSES.md).
  ["great-vibes", "Great Vibes"],
  ["eb-garamond", "EB Garamond"],
  ["spline-sans", "Spline Sans"],
  ["space-mono", "Space Mono"],
  ["bitter", "Bitter"],
  ["grand-hotel", "Grand Hotel"],
  ["lato", "Lato"],
  ["abril-fatface", "Abril Fatface"],
  ["poppins", "Poppins"],
  ["arima", "Arima"],
  ["mulish", "Mulish"],
  ["noto-sans-jp", "Noto Sans JP"], // Japanese in ~120 small pieces: a video loads only the ones its lyrics use
  ["noto-serif-jp", "Noto Serif JP"],
];

export type FontFaceFile = { path: string; src: string; unicodeRange?: string };
export type FontFaceInfo = { family: string; weight: number; style: "normal" | "italic"; files: FontFaceFile[] };
export type FontFamilyInfo = { family: string; source: "bundled" | "user"; faces: FontFaceInfo[] };

export type FontCatalog = {
  families: FontFamilyInfo[];
  fontDirs: Record<string, string>; // package slug -> folder with the .woff2 files (for the media server)
  problems: string[]; // user font files that could not be read
};

const USER_FONT_FILE = /\.(ttf|otf|woff2?)$/i;

// The folders with the bundled font files. Found from the project root first: inside the studio's
// server bundle require.resolve returns a module number, not a path.
export function bundledFontDirs(): Record<string, string> {
  const require = createRequire(import.meta.url);
  const find = (slug: string) => {
    for (const base of [path.join(REPO_ROOT, "packages", "video", "node_modules"), path.join(REPO_ROOT, "node_modules")]) {
      const dir = path.join(base, "@fontsource", slug, "files");
      if (existsSync(dir)) return dir;
    }
    const resolved: unknown = require.resolve(`@fontsource/${slug}/package.json`);
    if (typeof resolved !== "string") throw new Error(`Bundled font ${slug} not found (run pnpm install).`);
    return path.join(path.dirname(resolved), "files");
  };
  return Object.fromEntries(BUNDLED_FONTS.map(([slug]) => [slug, find(slug)]));
}

export function loadFontCatalog(workspaceDir: string): FontCatalog {
  const fontDirs = bundledFontDirs();
  const families: FontFamilyInfo[] = [];

  for (const [slug, family] of BUNDLED_FONTS) {
    const dir = fontDirs[slug];
    const faces: FontFaceInfo[] = [];
    const pattern = new RegExp(`^${slug}-latin-(\\d+)-(normal|italic)\\.woff2$`);
    const all = readdirSync(dir).sort();
    // CJK families come in numbered pieces ("noto-sans-jp-12-400-normal.woff2"), each with its range.
    const unicodeFile = path.join(dir, "..", "unicode.json");
    const pieces = existsSync(unicodeFile) ? (JSON.parse(readFileSync(unicodeFile, "utf8")) as Record<string, string>) : {};
    for (const file of all) {
      const m = pattern.exec(file);
      if (!m) continue;
      const files: FontFaceFile[] = [{ path: path.join(dir, file), src: `_fonts/${file}`, unicodeRange: LATIN_RANGE }];
      const ext = file.replace("-latin-", "-latin-ext-");
      if (existsSync(path.join(dir, ext))) files.push({ path: path.join(dir, ext), src: `_fonts/${ext}`, unicodeRange: LATIN_EXT_RANGE });
      for (const [key, range] of Object.entries(pieces)) {
        const n = /^\[(\d+)\]$/.exec(key)?.[1];
        const piece = n !== undefined ? `${slug}-${n}-${m[1]}-${m[2]}.woff2` : null;
        if (piece && existsSync(path.join(dir, piece))) files.push({ path: path.join(dir, piece), src: `_fonts/${piece}`, unicodeRange: range });
      }
      faces.push({ family, weight: Number(m[1]), style: m[2] as "normal" | "italic", files });
    }
    families.push({ family, source: "bundled", faces });
  }

  const problems: string[] = [];
  const userDir = path.join(workspaceDir, "fonts");
  if (existsSync(userDir)) {
    for (const file of readdirSync(userDir).filter((f) => USER_FONT_FILE.test(f)).sort()) {
      const full = path.join(userDir, file);
      try {
        const font = fontkit.openSync(full) as fontkit.Font;
        if (!("familyName" in font)) throw new Error("font collections (.ttc) are not supported");
        const os2 = font["OS/2"] as { usWeightClass?: number; fsSelection?: { italic?: boolean } } | undefined;
        const italic = !!os2?.fsSelection?.italic || font.italicAngle !== 0 || /italic|oblique/i.test(font.subfamilyName ?? "");
        const face: FontFaceInfo = {
          family: font.familyName,
          weight: os2?.usWeightClass ?? 400,
          style: italic ? "italic" : "normal",
          files: [{ path: full, src: `fonts/${file}` }],
        };
        let entry = families.find((f) => f.source === "user" && f.family.toLowerCase() === face.family.toLowerCase());
        if (!entry) {
          entry = { family: face.family, source: "user", faces: [] };
          families.push(entry);
        }
        entry.faces.push(face);
      } catch (error) {
        problems.push(`${file}: ${(error as Error).message}`);
      }
    }
  }
  return { families, fontDirs, problems };
}

// A user font with the same name as a bundled one wins.
export function findFamily(catalog: FontCatalog, family: string): FontFamilyInfo | undefined {
  const matches = catalog.families.filter((f) => f.family.toLowerCase() === family.trim().toLowerCase());
  return matches.find((f) => f.source === "user") ?? matches[0];
}

// The face of `family` closest to the requested weight (upright unless italic is asked for).
export function resolveFace(catalog: FontCatalog, family: string, weight: number, style: "normal" | "italic" = "normal"): FontFaceInfo {
  const entry = findFamily(catalog, family);
  if (!entry || !entry.faces.length) {
    throw new Error(`Font "${family}" not found. Run "pnpm fonts" to see the available fonts.`);
  }
  const sameStyle = entry.faces.filter((f) => f.style === style);
  const pool = sameStyle.length ? sameStyle : entry.faces;
  return [...pool].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || b.weight - a.weight)[0];
}

// The face with only the files a text needs (always the first, latin one): CJK families have ~120
// pieces, a video loads the ones its lyrics use. Without `text`: unchanged.
export function forText(face: FontFaceInfo, text?: string): FontFaceInfo {
  if (text === undefined || face.files.length <= 2) return face;
  return { ...face, files: face.files.filter((f, i) => i === 0 || !f.unicodeRange || rangeCovers(f.unicodeRange, text)) };
}

// The user's own fonts: WORKSPACE_DIR\fonts (D:\videomaker\workspace\fonts on the PC).
export const userFontsDir = (workspaceDir: string) => path.join(workspaceDir, "fonts");

export type ResolvedFont = { face: FontFaceInfo; warnings: string[] };
// The exact weight and italic of `family`, never a synthetic one: when the family lacks it, the nearest
// weight (and upright when it has no italic), with a warning naming what was used instead.
export function resolveFont(catalog: FontCatalog, family: string, weight: number, italic = false, role = "font"): ResolvedFont {
  const entry = findFamily(catalog, family);
  if (!entry || !entry.faces.length) throw new Error(`Font "${family}" not found. Run "pnpm fonts" to see the available fonts.`);
  const warnings: string[] = [];
  const want = italic ? "italic" : "normal";
  let pool = entry.faces.filter((f) => f.style === want);
  if (!pool.length) {
    warnings.push(`${role} ${entry.family} has no italic: upright used (never a synthetic italic)`);
    pool = entry.faces.filter((f) => f.style === "normal");
    if (!pool.length) pool = entry.faces;
  }
  const face = [...pool].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || b.weight - a.weight)[0];
  if (face.weight !== weight) {
    const has = [...new Set(pool.map((f) => f.weight))].sort((a, b) => a - b).join(", ");
    warnings.push(`${role} ${entry.family} has no weight ${weight}${face.style === "italic" ? " italic" : ""}: ${face.weight} used (it has ${has}; never a synthetic bold)`);
  }
  return { face, warnings };
}

export function fontFileRefs(face: FontFaceInfo): FontFileRef[] {
  return face.files.map((f) => ({ family: face.family, weight: face.weight, style: face.style, src: f.src, unicodeRange: f.unicodeRange }));
}

export const FRENCH_CHARACTERS = ["é", "è", "à", "ç", "œ", "É", "È", "À", "Ç", "Œ"];

// French characters with no glyph in this face (checked in all its files).
export function missingCharacters(face: FontFaceInfo, characters = FRENCH_CHARACTERS): string[] {
  const fonts = face.files.map((f) => fontkit.openSync(f.path) as fontkit.Font);
  return characters.filter((c) => !fonts.some((font) => font.hasGlyphForCodePoint(c.codePointAt(0)!)));
}
