// All fonts available to the video: the bundled @fontsource families and any .ttf/.otf/.woff/.woff2
// files in WORKSPACE_DIR\fonts. Used by render:test, the preview data, "pnpm fonts" and measuring.
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as fontkit from "fontkit";

import { LATIN_EXT_RANGE, LATIN_RANGE, type FontFileRef } from "../font-files";

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

export function bundledFontDirs(): Record<string, string> {
  const require = createRequire(import.meta.url);
  return Object.fromEntries(
    BUNDLED_FONTS.map(([slug]) => [slug, path.join(path.dirname(require.resolve(`@fontsource/${slug}/package.json`)), "files")]),
  );
}

export function loadFontCatalog(workspaceDir: string): FontCatalog {
  const fontDirs = bundledFontDirs();
  const families: FontFamilyInfo[] = [];

  for (const [slug, family] of BUNDLED_FONTS) {
    const dir = fontDirs[slug];
    const faces: FontFaceInfo[] = [];
    const pattern = new RegExp(`^${slug}-latin-(\\d+)-(normal|italic)\\.woff2$`);
    for (const file of readdirSync(dir).sort()) {
      const m = pattern.exec(file);
      if (!m) continue;
      const files: FontFaceFile[] = [{ path: path.join(dir, file), src: `_fonts/${file}`, unicodeRange: LATIN_RANGE }];
      const ext = file.replace("-latin-", "-latin-ext-");
      if (existsSync(path.join(dir, ext))) files.push({ path: path.join(dir, ext), src: `_fonts/${ext}`, unicodeRange: LATIN_EXT_RANGE });
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

export function fontFileRefs(face: FontFaceInfo): FontFileRef[] {
  return face.files.map((f) => ({ family: face.family, weight: face.weight, style: face.style, src: f.src, unicodeRange: f.unicodeRange }));
}

export const FRENCH_CHARACTERS = ["é", "è", "à", "ç", "œ", "É", "È", "À", "Ç", "Œ"];

// French characters with no glyph in this face (checked in all its files).
export function missingCharacters(face: FontFaceInfo, characters = FRENCH_CHARACTERS): string[] {
  const fonts = face.files.map((f) => fontkit.openSync(f.path) as fontkit.Font);
  return characters.filter((c) => !fonts.some((font) => font.hasGlyphForCodePoint(c.codePointAt(0)!)));
}
