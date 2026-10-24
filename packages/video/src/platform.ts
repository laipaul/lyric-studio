// Platform presets (presets/platforms.json): size, length, variations, safe zones, text scale,
// bitrate and special rules per platform. Pure: the file is read in Node and validated here, and the
// lyric area of every platform is computed from its safe zones (never a fixed percentage).
import { VIDEO } from "./config";

export type SafeZone = { top: number; bottom: number; left: number; right: number }; // fractions of the frame
export type Format = { width: number; height: number };

export type PlatformPreset = {
  name: string;
  label: string;
  width: number;
  height: number;
  aspect: string; // "9:16" (checked against width/height)
  layout: "vertical" | "youtube" | "canvas";
  length: { mode: "target"; seconds: number; tolerance: number } | { mode: "range"; min: number; max: number; hardMax: number } | { mode: "full" } | { mode: "loop"; min: number; max: number };
  anchor: "lead-in" | "centre"; // section starts one bar before the first hook, or is centred on the first chorus
  variations: number;
  safeZone: SafeZone;
  lyricsAt: number; // vertical position of the lyrics inside the usable area: 0 = top, 0.5 = middle
  textScale: number;
  videoBitrate: string | null; // e.g. "10M"; null = constant quality (CRF)
  fadeOutSeconds: number;
  loopEnding: boolean; // last shot continues into the first one (Reels loop)
  lyrics: boolean;
  audio: boolean;
  available: boolean; // false: comes in a later step
  note?: string;
};

// Applies when "pnpm make" runs without --platforms: today's behaviour (45-60 s, 6 variations).
export const STANDARD = "standard";

// Lyric block geometry on a frame: horizontally inside the usable width, vertically centred on
// centerY = top of the usable area + lyricsAt x its height ("slightly above middle" with 0.45).
export type LyricArea = { left: number; right: number; centerY: number; top: number; bottom: number; minScale: number; lineHeight: number };

export const LYRIC_LAYOUT = { minScale: 0.75, lineHeight: 1.15, leftMargin: 64 / 1080, rightMargin: 32 / 1080, barShare: 0.1 } as const;

export function cinematicBarHeight(format: Format): number {
  return Math.round(format.height * LYRIC_LAYOUT.barShare);
}

export function lyricArea(format: Format, safe: SafeZone, lyricsAt = 0.45, cinematicBars = false): LyricArea {
  const bar = cinematicBars ? cinematicBarHeight(format) : 0;
  const top = Math.max(Math.round(format.height * safe.top), bar);
  const bottom = Math.min(Math.round(format.height * (1 - safe.bottom)), format.height - bar);
  const left = Math.round(format.width * safe.left) + Math.round(format.width * LYRIC_LAYOUT.leftMargin);
  const right = Math.round(format.width * (1 - safe.right)) - Math.round(format.width * LYRIC_LAYOUT.rightMargin);
  return {
    left,
    right,
    top,
    bottom,
    centerY: Math.round(top + (bottom - top) * lyricsAt),
    minScale: LYRIC_LAYOUT.minScale,
    lineHeight: LYRIC_LAYOUT.lineHeight,
  };
}

// The format and safe zones used when nothing else is given (preview page, render:test).
export const DEFAULT_FORMAT: Format = { width: VIDEO.width, height: VIDEO.height };
export const DEFAULT_SAFE_ZONE: SafeZone = { top: 0.1, bottom: 0.2, left: 0, right: 0.12 };
export const DEFAULT_LYRIC_AREA = lyricArea(DEFAULT_FORMAT, DEFAULT_SAFE_ZONE);

// Section length window in ms for a preset (target +-tolerance; hard max = only to avoid cutting a line).
export function sectionWindow(preset: PlatformPreset): { minMs: number; maxMs: number; hardMaxMs: number; targetMs: number } | null {
  const l = preset.length;
  if (l.mode === "target") {
    const t = l.seconds * 1000;
    return { minMs: Math.round(t * (1 - l.tolerance)), maxMs: Math.round(t * (1 + l.tolerance)), hardMaxMs: Math.round(t * (1 + l.tolerance)), targetMs: t };
  }
  if (l.mode === "range") return { minMs: l.min * 1000, maxMs: l.max * 1000, hardMaxMs: l.hardMax * 1000, targetMs: ((l.min + l.max) / 2) * 1000 };
  return null;
}

// ---------------------------------------------------------------- reading presets/platforms.json

const isNum = (v: unknown, min = -Infinity, max = Infinity): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export function parsePresets(json: unknown, file = "presets/platforms.json"): Record<string, PlatformPreset> {
  const errors: string[] = [];
  const root = json as { platforms?: Record<string, Record<string, unknown>> };
  if (!root || typeof root !== "object" || !root.platforms || typeof root.platforms !== "object") {
    throw new Error(`${file}: expected { "platforms": { "reels": { ... }, ... } }`);
  }
  const out: Record<string, PlatformPreset> = {};
  for (const [name, raw] of Object.entries(root.platforms)) {
    const where = `${file}: platform "${name}"`;
    const p = raw as Record<string, unknown>;
    const bad = (field: string, expected: string) => errors.push(`${where}: "${field}" ${expected} (found ${JSON.stringify(p[field])})`);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`${where}: names use lower-case letters, digits and "-"`);
    if (!isNum(p.width, 144, 4096) || !Number.isInteger(p.width)) bad("width", "must be a whole number of pixels (144-4096)");
    if (!isNum(p.height, 144, 4096) || !Number.isInteger(p.height)) bad("height", "must be a whole number of pixels (144-4096)");
    if (typeof p.aspect !== "string" || !/^\d+:\d+$/.test(p.aspect)) bad("aspect", 'must look like "9:16"');
    else if (isNum(p.width) && isNum(p.height)) {
      const [a, b] = p.aspect.split(":").map(Number);
      if (Math.abs(a / b - (p.width as number) / (p.height as number)) > 0.01) errors.push(`${where}: aspect ${p.aspect} does not match ${p.width}x${p.height}`);
      if ((p.width as number) % 2 || (p.height as number) % 2) errors.push(`${where}: width and height must be even numbers (H.264)`);
    }
    if (!["vertical", "youtube", "canvas"].includes(p.layout as string)) bad("layout", 'must be "vertical", "youtube" or "canvas"');
    const len = p.length as Record<string, unknown> | undefined;
    if (!len || typeof len !== "object") bad("length", 'must be an object, e.g. { "mode": "target", "seconds": 30, "tolerance": 0.15 }');
    else if (len.mode === "target") {
      if (!isNum(len.seconds, 3, 600)) errors.push(`${where}: length.seconds must be 3-600`);
      if (!isNum(len.tolerance, 0, 0.5)) errors.push(`${where}: length.tolerance must be 0-0.5 (0.15 = +-15%)`);
    } else if (len.mode === "range") {
      if (!isNum(len.min, 3, 600) || !isNum(len.max, 3, 600) || !isNum(len.hardMax, 3, 600) || !((len.min as number) <= (len.max as number) && (len.max as number) <= (len.hardMax as number))) {
        errors.push(`${where}: length range needs min <= max <= hardMax (seconds)`);
      }
    } else if (len.mode === "loop") {
      if (!isNum(len.min, 1, 60) || !isNum(len.max, 1, 60) || (len.min as number) > (len.max as number)) errors.push(`${where}: loop length needs min <= max (seconds)`);
    } else if (len.mode !== "full") errors.push(`${where}: length.mode must be "target", "range", "full" or "loop"`);
    if (!["lead-in", "centre"].includes((p.anchor as string) ?? "lead-in")) bad("anchor", 'must be "lead-in" or "centre"');
    if (!isNum(p.variations, 1, 24) || !Number.isInteger(p.variations)) bad("variations", "must be a whole number 1-24");
    const safe = p.safeZone as Record<string, unknown> | undefined;
    if (!safe || typeof safe !== "object") bad("safeZone", "must be { top, bottom, left, right } as fractions (0.2 = 20%)");
    else {
      for (const side of ["top", "bottom", "left", "right"]) if (!isNum(safe[side] ?? 0, 0, 0.45)) errors.push(`${where}: safeZone.${side} must be 0-0.45 (a fraction of the frame)`);
    }
    if (!isNum(p.lyricsAt ?? 0.45, 0.1, 0.9)) bad("lyricsAt", "must be 0.1-0.9 (0.45 = slightly above the middle of the usable area)");
    if (!isNum(p.textScale ?? 1, 0.5, 2)) bad("textScale", "must be 0.5-2");
    if (p.videoBitrate !== null && p.videoBitrate !== undefined && !(typeof p.videoBitrate === "string" && /^\d+(\.\d+)?[kKmM]$/.test(p.videoBitrate))) bad("videoBitrate", 'must be like "10M", "8000k" or null');
    if (!isNum(p.fadeOutSeconds ?? 0.5, 0, 3)) bad("fadeOutSeconds", "must be 0-3");
    if (errors.length) continue;
    out[name] = {
      name,
      label: typeof p.label === "string" ? p.label : name,
      width: p.width as number,
      height: p.height as number,
      aspect: p.aspect as string,
      layout: p.layout as PlatformPreset["layout"],
      length: len as PlatformPreset["length"],
      anchor: ((p.anchor as string) ?? "lead-in") as PlatformPreset["anchor"],
      variations: p.variations as number,
      safeZone: { top: 0, bottom: 0, left: 0, right: 0, ...(safe as Partial<SafeZone>) },
      lyricsAt: (p.lyricsAt as number) ?? 0.45,
      textScale: (p.textScale as number) ?? 1,
      videoBitrate: (p.videoBitrate as string | null) ?? null,
      fadeOutSeconds: (p.fadeOutSeconds as number) ?? 0.5,
      loopEnding: p.loopEnding === true,
      lyrics: p.lyrics !== false,
      audio: p.audio !== false,
      available: p.available !== false,
      ...(typeof p.note === "string" ? { note: p.note } : {}),
    };
  }
  if (!out[STANDARD] && !errors.length) errors.push(`${file}: the "${STANDARD}" platform is missing (used when --platforms is not given)`);
  if (errors.length) throw new Error(`Problems in ${file}:\n  - ${errors.join("\n  - ")}`);
  return out;
}

// "--platforms reels,tiktok" or "all" -> preset names (in the file's order for "all").
export function choosePlatforms(text: string | undefined, presets: Record<string, PlatformPreset>): { names: string[]; skipped: string[] } {
  if (!text) return { names: [STANDARD], skipped: [] };
  const all = Object.keys(presets).filter((n) => n !== STANDARD);
  const asked = text.trim().toLowerCase() === "all" ? all : text.split(/[\s,]+/).filter(Boolean).map((n) => n.toLowerCase());
  const unknown = asked.filter((n) => !presets[n]);
  if (unknown.length) throw new Error(`Unknown platform(s): ${unknown.join(", ")}. Known: ${all.join(", ")} (or "all")`);
  const isAll = text.trim().toLowerCase() === "all";
  const notYet = asked.filter((n) => !presets[n].available);
  if (notYet.length && !isAll) {
    throw new Error(notYet.map((n) => `${n}: ${presets[n].note ?? "not available yet"}`).join("; "));
  }
  return { names: [...new Set(asked.filter((n) => presets[n].available))], skipped: notYet };
}

// Can a source of this size fill the format by cover-cropping? Vertical outputs take vertical or
// square sources (and horizontal ones only when at least twice the output height, so the crop still
// has enough pixels); horizontal outputs the other way round. Otherwise "fill" with --allow-fill.
export function sourceFit(width: number, height: number, format: Format, allowFill: boolean): "cover" | "fill" | null {
  const vertical = format.height > format.width;
  const matches = vertical ? height >= width : width >= height;
  const bigEnough = vertical ? height >= 2 * format.height : width >= 2 * format.width;
  if (matches || bigEnough) return "cover";
  return allowFill ? "fill" : null;
}
