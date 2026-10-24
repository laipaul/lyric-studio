// The artist's brand: WORKSPACE_DIR\brand\brand.json (+ logo.png). Created with the Life Lyrics
// defaults the first time. Lyrics use the verse and hook fonts (unless --font / --font-hook);
// thumbnails and title cards (Step 5g.2) use the title font, accent colour and logo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { FontCatalog } from "./font-catalog";
import { findFamily } from "./font-catalog";

export type BrandFont = { family: string; weight: number; letterSpacing?: number };
export type Brand = {
  titleFont: BrandFont;
  verseFont: BrandFont;
  hookFont: BrandFont;
  accentColour: string;
  logo: { file: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; size: number };
  useForLyrics: boolean;
};

export const DEFAULT_BRAND: Brand = {
  titleFont: { family: "Cinzel", weight: 700, letterSpacing: 0.18 },
  verseFont: { family: "Cormorant Garamond", weight: 600 },
  hookFont: { family: "Kaushan Script", weight: 400 },
  accentColour: "#E8A3B5",
  logo: { file: "logo.png", position: "bottom-left", size: 0.08 },
  useForLyrics: true,
};

const HELP =
  "Brand for Lyric Studio. Fonts: any family from 'pnpm fonts'. letterSpacing in em (0.18 = wide). " +
  "accentColour: #RRGGBB. logo.file: inside this folder; position: top-left | top-right | bottom-left | bottom-right; " +
  "size: logo width as a fraction of the video width. useForLyrics: false = lyrics keep the Simple/Bold style fonts.";

export function brandDir(workspaceDir: string): string {
  return path.join(workspaceDir, "brand");
}

export function loadBrand(workspaceDir: string, catalog: FontCatalog): { brand: Brand; file: string; created: boolean; logoFile: string | null } {
  const dir = brandDir(workspaceDir);
  const file = path.join(dir, "brand.json");
  let created = false;
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ _help: HELP, ...DEFAULT_BRAND }, null, 2)}\n`);
    created = true;
  }
  let raw: Partial<Brand>;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Brand>;
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message})`);
  }
  const brand: Brand = {
    ...DEFAULT_BRAND,
    ...raw,
    titleFont: { ...DEFAULT_BRAND.titleFont, ...raw.titleFont },
    verseFont: { ...DEFAULT_BRAND.verseFont, ...raw.verseFont },
    hookFont: { ...DEFAULT_BRAND.hookFont, ...raw.hookFont },
    logo: { ...DEFAULT_BRAND.logo, ...raw.logo },
  };
  const problems: string[] = [];
  for (const key of ["titleFont", "verseFont", "hookFont"] as const) {
    if (!findFamily(catalog, brand[key].family)) problems.push(`${key}: font "${brand[key].family}" not found (see pnpm fonts)`);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(brand.accentColour)) problems.push(`accentColour must look like #E8A3B5 (found ${JSON.stringify(brand.accentColour)})`);
  if (!["top-left", "top-right", "bottom-left", "bottom-right"].includes(brand.logo.position)) problems.push("logo.position must be top-left, top-right, bottom-left or bottom-right");
  if (!(brand.logo.size > 0 && brand.logo.size <= 0.5)) problems.push("logo.size must be between 0 and 0.5 (a fraction of the video width)");
  if (problems.length) throw new Error(`Problems in ${file}:\n  - ${problems.join("\n  - ")}`);
  const logo = path.join(dir, brand.logo.file);
  return { brand, file, created, logoFile: existsSync(logo) ? logo : null };
}
