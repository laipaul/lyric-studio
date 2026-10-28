// The artist's brand: WORKSPACE_DIR\brand\brand.json (+ logo.png). Created with the Life Lyrics
// defaults the first time. Lyrics use the verse and hook fonts (unless --font / --font-hook);
// thumbnails and title cards (Step 5g.2) use the title font, accent colour and logo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkEffectChoice, DEFAULT_HOOK_EFFECT, DEFAULT_VERSE_EFFECT, type EffectChoice } from "../effects/names";
import { safeName } from "@lyric/db";

import type { Corner } from "../youtube";
import type { FontCatalog } from "./font-catalog";
import { checkPerPlatform, isWeight, SHOT_LENGTH_VALUES, type PerPlatform } from "./per-platform";
import { findFamily } from "./font-catalog";

export type BrandFont = { family: string; weight: number; italic?: boolean; letterSpacing?: number };
export type Brand = {
  titleFont: BrandFont;
  verseFont: BrandFont;
  hookFont: BrandFont;
  accentColour: string;
  // youtube: the corner on YouTube videos; vertical: the corner inside the platform's safe zone on
  // 9:16 videos ("auto" = bottom right inside the safe zone). The old "position" is no longer used.
  // platforms: which platforms show the logo (default YouTube only); always in a frame corner.
  logo: { file: string; size: number; youtube: Corner; vertical: Corner | "auto"; platforms: string[]; position?: string };
  useForLyrics: boolean;
  // Lyric effects (Step 5j): "glide", "karaoke-highlight:subtle" or { name, intensity, durationMs, easing }.
  // gapHideS / gapLeadInS: during an instrumental gap longer than gapHideS no lyric is shown (not
  // even the waiting next line); the next line fades in gapLeadInS before its first sung word.
  motion: { verseEffect: EffectChoice; hookEffect: EffectChoice; gapHideS: number; gapLeadInS: number };
  // The app's icon (shortcut, window, taskbar): "logo" = the logo alone, "tile" = on a rounded square
  // in the accent colour.
  appIcon: { style: "logo" | "tile" };
  // Per platform (Step 6.2c-2a): { "youtube": { "verseEffect": "cinematic-fade" } } for the effects,
  // fonts, accent colour and section; above the defaults here and platforms.json, below the song.
  perPlatform: PerPlatform;
  shotLength?: string; // the artist's pace: "1" | "2" | "4" | "8" bars per shot, or "story"
};

export const DEFAULT_BRAND: Brand = {
  titleFont: { family: "Cinzel", weight: 700, letterSpacing: 0.18 },
  verseFont: { family: "Cormorant Garamond", weight: 600 },
  hookFont: { family: "Kaushan Script", weight: 400 },
  accentColour: "#E8A3B5",
  logo: { file: "logo.png", size: 0.08, youtube: "bottom-right", vertical: "auto", platforms: ["youtube"] },
  useForLyrics: true,
  motion: { verseEffect: DEFAULT_VERSE_EFFECT, hookEffect: DEFAULT_HOOK_EFFECT, gapHideS: 3, gapLeadInS: 1 },
  appIcon: { style: "logo" },
  perPlatform: {},
};

const HELP =
  "Brand for Lyric Studio. Fonts: any family from 'pnpm fonts' (your own .ttf/.otf/.woff/.woff2 go in WORKSPACE_DIR\\fonts); weight 100-900 (400 = regular, 600 = semibold, 700 = bold; the nearest the family has, with a warning); italic: true / false (the family's italic file, never a synthetic one). letterSpacing in em (0.18 = wide). " +
  "accentColour: #RRGGBB. logo.file: inside this folder; logo.youtube: top-left | top-right | bottom-left | bottom-right " +
  "(YouTube videos; it fades out before the end screen); logo.vertical: auto (bottom right) or a corner " +
  "(9:16 videos); logo.platforms: the platforms that show the logo, e.g. [\"youtube\"] (default) or [\"youtube\", \"reels\"]; " +
  "the logo always sits in a frame corner with a fixed margin; size: logo width as a fraction of the video width. " +
  "useForLyrics: false = lyrics keep the Simple/Bold style fonts. " +
  "motion.verseEffect / motion.hookEffect: glide, cinematic-fade, soft-blur, dreamy-glow, word-reveal, karaoke-highlight, floating, typewriter " +
  '(optionally ":subtle" or ":expressive", or { "name": ..., "intensity": ..., "durationMs": ..., "easing": ... }); see pnpm effects:preview. ' +
  "motion.gapHideS: during an instrumental gap longer than this (seconds, default 3) no lyric is shown; motion.gapLeadInS: the next line then fades in this long before its first sung word (default 1). " +
  'appIcon.style: "logo" (the logo alone, default) or "tile" (the logo on a rounded square in the accent colour); run Create Desktop Shortcut.cmd again after a change. ' +
  'perPlatform: values for one platform only, e.g. { "youtube": { "verseEffect": "cinematic-fade" }, "reels": { "verseEffect": "glide" } } ' +
  "(verseEffect, hookEffect, verseFont, hookFont, accentColour, section); a song's song.json can still override them.";

export function brandDir(workspaceDir: string): string {
  return path.join(workspaceDir, "brand");
}

export const DEFAULT_ARTIST = "Life Lyrics";

// The brand folder for an artist: brand\<artist>\ when it has a brand.json (e.g. brand\Pômé\),
// otherwise the default brand\ (Life Lyrics).
export function brandDirFor(workspaceDir: string, artist?: string | null): string {
  const base = brandDir(workspaceDir);
  if (artist && artist.trim() && artist.trim() !== DEFAULT_ARTIST) {
    const own = path.join(base, safeName(artist.trim()));
    if (existsSync(path.join(own, "brand.json"))) return own;
  }
  return base;
}

export function loadBrand(
  workspaceDir: string,
  catalog: FontCatalog,
  artist?: string | null,
): { brand: Brand; file: string; dir: string; created: boolean; logoFile: string | null } {
  const dir = brandDirFor(workspaceDir, artist);
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
    motion: { ...DEFAULT_BRAND.motion },
    appIcon: { ...DEFAULT_BRAND.appIcon, ...raw.appIcon },
    perPlatform: {},
  };
  const problems: string[] = [];
  if (!["logo", "tile"].includes(brand.appIcon.style)) problems.push('appIcon.style must be "logo" (the logo alone) or "tile" (on a rounded square in the accent colour)');
  const rawMotion = (raw.motion ?? {}) as Record<string, unknown>;
  for (const key of ["verseEffect", "hookEffect"] as const) {
    if (rawMotion[key] === undefined) continue;
    try {
      brand.motion[key] = checkEffectChoice(rawMotion[key], `motion.${key}`);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  for (const [key, min, max] of [
    ["gapHideS", 1.5, 30],
    ["gapLeadInS", 0.25, 3],
  ] as const) {
    const v = rawMotion[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !(v >= min && v <= max)) problems.push(`motion.${key} must be a number of seconds from ${min} to ${max}`);
    else brand.motion[key] = v;
  }
  for (const key of ["titleFont", "verseFont", "hookFont"] as const) {
    if (!findFamily(catalog, brand[key].family)) problems.push(`${key}: font "${brand[key].family}" not found (see pnpm fonts)`);
    if (!isWeight(brand[key].weight)) problems.push(`${key}.weight must be a font weight: 100, 200, ... 900 (400 = regular, 600 = semibold, 700 = bold)`);
    if (brand[key].italic !== undefined && typeof brand[key].italic !== "boolean") problems.push(`${key}.italic must be true or false`);
  }
  if (raw.perPlatform !== undefined) {
    const checked = checkPerPlatform(raw.perPlatform, "perPlatform");
    problems.push(...checked.problems);
    brand.perPlatform = checked.values;
    for (const [platform, v] of Object.entries(checked.values)) {
      for (const k of ["verseFont", "hookFont"] as const) if (v[k] && !findFamily(catalog, v[k]!)) problems.push(`perPlatform.${platform}.${k}: font "${v[k]}" not found (see pnpm fonts)`);
    }
  }
  if (brand.shotLength !== undefined && !(SHOT_LENGTH_VALUES as readonly string[]).includes(String(brand.shotLength))) problems.push(`shotLength must be ${SHOT_LENGTH_VALUES.join(", ")} (bars per shot, or "story")`);
  if (!/^#[0-9a-fA-F]{6}$/.test(brand.accentColour)) problems.push(`accentColour must look like #E8A3B5 (found ${JSON.stringify(brand.accentColour)})`);
  const corners = ["top-left", "top-right", "bottom-left", "bottom-right"];
  if (!corners.includes(brand.logo.youtube)) problems.push("logo.youtube must be top-left, top-right, bottom-left or bottom-right");
  if (![...corners, "auto"].includes(brand.logo.vertical)) problems.push("logo.vertical must be auto, top-left, top-right, bottom-left or bottom-right");
  if (!Array.isArray(brand.logo.platforms) || !brand.logo.platforms.every((p) => typeof p === "string")) problems.push('logo.platforms must be a list of platform names, e.g. ["youtube"]');
  if (!(brand.logo.size > 0 && brand.logo.size <= 0.5)) problems.push("logo.size must be between 0 and 0.5 (a fraction of the video width)");
  if (problems.length) throw new Error(`Problems in ${file}:\n  - ${problems.join("\n  - ")}`);
  const logo = path.join(dir, brand.logo.file);
  return { brand, file, dir, created, logoFile: existsSync(logo) ? logo : null };
}
