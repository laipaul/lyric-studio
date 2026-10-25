// The app's icons (desktop shortcut, Edge app window, installed PWA) made with FFmpeg from the brand
// logo WORKSPACE_DIR\brand\logo.png (the Life Lyrics flower):
//   - the logo's transparent padding is cropped away, so it fills ~90% of the square;
//   - every size is rendered straight from the full-size logo (Lanczos), so small sizes stay sharp;
//   - the Windows .ico holds 16, 24, 32, 48, 64, 128 and 256 px.
// brand.json "appIcon": { "style": "logo" } (default: the logo alone) or "tile" (the logo on a rounded
// square in the accent colour). Cached by the logo, the style and the colour: a change gives new icons.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ffmpegBin, ffprobeBin } from "@lyric/db";

import { brandDir } from "./brand";

export const APP_BACKGROUND = "#0b0b0d";
export const APP_ACCENT = "#E8A3B5";
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
export const LOGO_FILL = 0.9; // share of the icon the logo fills (style "logo")
export const TILE_LOGO_FILL = 0.7; // the logo on the tile (style "tile")
export type IconKind = "any" | "maskable" | "ico";
export type IconStyle = "logo" | "tile";

const run = (args: string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile(ffmpegBin(), ["-y", "-v", "error", ...args], { windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (e, _o, err) =>
      e ? reject(new Error(`ffmpeg could not make the app icon: ${err || e.message}`)) : resolve(),
    ),
  );

// brand.json appIcon.style and accentColour (read directly: the icon must work even if other brand
// settings have a mistake).
export function appIconSettings(workspaceDir: string): { style: IconStyle; accent: string } {
  try {
    const raw = JSON.parse(readFileSync(path.join(brandDir(workspaceDir), "brand.json"), "utf8")) as { appIcon?: { style?: string }; accentColour?: string };
    return {
      style: raw.appIcon?.style === "tile" ? "tile" : "logo",
      accent: typeof raw.accentColour === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.accentColour) ? raw.accentColour : APP_ACCENT,
    };
  } catch {
    return { style: "logo", accent: APP_ACCENT };
  }
}

// The visible part of the logo: pixels that are not transparent (or, for a logo without
// transparency, pixels that differ from its corner colour). Returns the crop box.
export function visibleBox(rgba: Buffer, width: number, height: number): { x: number; y: number; w: number; h: number } {
  let transparent = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) { transparent = true; break; }
  const bg = [rgba[0], rgba[1], rgba[2]];
  const visible = (i: number) =>
    transparent ? rgba[i + 3] > 12 : Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i + 1] - bg[1]) + Math.abs(rgba[i + 2] - bg[2]) > 36;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visible((y * width + x) * 4)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function logoBox(logo: string): { x: number; y: number; w: number; h: number } {
  const [w, h] = execFileSync(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", logo]).toString().trim().split(",").map(Number);
  const rgba = execFileSync(ffmpegBin(), ["-v", "error", "-i", logo, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 256 * 1024 * 1024 });
  return visibleBox(rgba, w, h);
}

const hexToFfmpeg = (hex: string) => `0x${hex.replace("#", "")}`;

// A rounded square (anti-aliased edge) as the alpha channel: radius 22% of the side.
const roundedAlpha = (size: number) => {
  const r = Math.round(size * 0.22);
  const d = `hypot(max(0\\,max(${r}-X\\,X-(W-1-${r})))\\,max(0\\,max(${r}-Y\\,Y-(H-1-${r}))))`;
  return `255*clip(${r}+0.5-${d}\\,0\\,1)`;
};

// One PNG icon of `size` px.
async function renderPng(logo: string | null, box: { x: number; y: number; w: number; h: number } | null, size: number, kind: "any" | "maskable", style: IconStyle, accent: string, out: string): Promise<void> {
  const tile = style === "tile";
  // Maskable icons may be cut to a circle: the logo stays inside the middle ~60%, on a full background.
  const fill = kind === "maskable" ? 0.6 : tile ? TILE_LOGO_FILL : LOGO_FILL;
  const inner = Math.max(1, Math.round(size * fill));
  const bgColour = kind === "maskable" ? (tile ? accent : APP_BACKGROUND) : tile ? accent : null;
  const base = bgColour
    ? `color=c=${hexToFfmpeg(bgColour)}:s=${size}x${size},format=rgba${tile && kind !== "maskable" ? `,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${roundedAlpha(size)}'` : ""}`
    : `color=c=black@0.0:s=${size}x${size},format=rgba`;
  if (logo && box) {
    const fit = `crop=${box.w}:${box.h}:${box.x}:${box.y},scale=${inner}:${inner}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba`;
    await run(["-f", "lavfi", "-i", base, "-i", logo, "-filter_complex", `[1:v]${fit}[l];[0:v][l]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgba`, "-frames:v", "1", out]);
  } else {
    // No logo yet: a pink circle on the dark background.
    const r = size * (kind === "maskable" ? 0.26 : 0.4);
    const inside = `lte(hypot(X-W/2\\,Y-H/2)\\,${r})`;
    await run(["-f", "lavfi", "-i", `color=c=${hexToFfmpeg(APP_BACKGROUND)}:s=${size}x${size},format=rgba`, "-vf", `geq=r='if(${inside}\\,232\\,11)':g='if(${inside}\\,163\\,11)':b='if(${inside}\\,181\\,13)':a='255'`, "-frames:v", "1", out]);
  }
}

// A Windows .ico holding several PNG images (supported by Windows Vista and later at every size).
export function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); // 0 = 256
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); // no palette
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

// The sizes inside an .ico (for checks).
export function icoSizes(ico: Buffer): number[] {
  const n = ico.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => ico.readUInt8(6 + 16 * i) || 256);
}

// "any" / "maskable": one PNG of `size` px; "ico": the multi-size .ico (size is ignored).
export async function appIcon(workspaceDir: string, size: number, kind: IconKind = "any"): Promise<string> {
  const logo = path.join(brandDir(workspaceDir), "logo.png");
  const hasLogo = existsSync(logo);
  const { style, accent } = appIconSettings(workspaceDir);
  const key = createHash("sha256")
    .update(hasLogo ? readFileSync(logo) : "default")
    .update(`${kind === "ico" ? "ico" : size}-${kind}-${style}-${accent}-v2`)
    .digest("hex")
    .slice(0, 16);
  const out = path.join(workspaceDir, "cache", "app-icons", kind === "ico" ? `lyric-studio-${key}.ico` : `${kind}-${size}-${key}.png`);
  if (existsSync(out)) return out;
  mkdirSync(path.dirname(out), { recursive: true });
  const box = hasLogo ? logoBox(logo) : null;
  if (kind === "ico") {
    const images: { size: number; png: Buffer }[] = [];
    for (const s of ICO_SIZES) {
      const part = `${out}.${s}.part.png`;
      await renderPng(hasLogo ? logo : null, box, s, "any", style, accent, part);
      images.push({ size: s, png: readFileSync(part) });
      rmSync(part, { force: true });
    }
    writeFileSync(`${out}.part`, buildIco(images));
    renameSync(`${out}.part`, out);
    return out;
  }
  const tmp = `${out}.part.png`;
  await renderPng(hasLogo ? logo : null, box, size, kind, style, accent, tmp);
  renameSync(tmp, out);
  return out;
}
