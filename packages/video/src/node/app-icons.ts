// The app's icons (PWA window and taskbar, desktop shortcut) made with FFmpeg from the brand logo
// WORKSPACE_DIR\brand\logo.png (the Life Lyrics flower). Cached by the logo's content, so a new logo
// gives new icons automatically. Without a logo: a plain pink circle on the dark background.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";

import { ffmpegBin } from "@lyric/db";

import { brandDir } from "./brand";

export const APP_BACKGROUND = "#0b0b0d";
export const APP_ACCENT = "#E8A3B5";
export type IconKind = "any" | "maskable" | "ico";

const run = (args: string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile(ffmpegBin(), ["-y", "-v", "error", ...args], { windowsHide: true, timeout: 60_000 }, (e, _o, err) => (e ? reject(new Error(`ffmpeg could not make the app icon: ${err || e.message}`)) : resolve())),
  );

// "any": the logo on a transparent square (8% padding); "maskable": the logo inside the middle 60% on
// the dark background (Android/Windows may cut the corners); "ico": 256 px for the desktop shortcut.
export async function appIcon(workspaceDir: string, size: number, kind: IconKind = "any"): Promise<string> {
  const logo = path.join(brandDir(workspaceDir), "logo.png");
  const hasLogo = existsSync(logo);
  const key = createHash("sha256").update(hasLogo ? readFileSync(logo) : "default").update(`${size}-${kind}-v1`).digest("hex").slice(0, 16);
  const out = path.join(workspaceDir, "cache", "app-icons", `${kind}-${size}-${key}.${kind === "ico" ? "ico" : "png"}`);
  if (existsSync(out)) return out;
  mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.part${kind === "ico" ? ".ico" : ".png"}`;
  const bg = APP_BACKGROUND.replace("#", "0x");
  const share = kind === "maskable" ? 0.6 : 0.84;
  const inner = Math.round(size * share);
  if (hasLogo) {
    const fit = `scale=${inner}:${inner}:force_original_aspect_ratio=decrease,format=rgba`;
    const base = kind === "maskable" ? `color=c=${bg}:s=${size}x${size}` : `color=c=black@0.0:s=${size}x${size},format=rgba`;
    await run(["-f", "lavfi", "-i", base, "-i", logo, "-filter_complex", `[1:v]${fit}[l];[0:v][l]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgba`, "-frames:v", "1", tmp]);
  } else {
    const r = size * (kind === "maskable" ? 0.26 : 0.36);
    const inside = `lte(hypot(X-W/2\\,Y-H/2)\\,${r})`;
    await run([
      "-f", "lavfi", "-i", `color=c=${bg}:s=${size}x${size},format=rgba`,
      "-vf", `geq=r='if(${inside}\\,232\\,11)':g='if(${inside}\\,163\\,11)':b='if(${inside}\\,181\\,13)':a='255'`,
      "-frames:v", "1", tmp,
    ]);
  }
  renameSync(tmp, out);
  return out;
}
