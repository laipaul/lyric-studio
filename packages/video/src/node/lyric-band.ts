// How bright the picture is behind the lyrics: the brightest part of the lyric band of a frame (the 90th
// percentile of a small grey copy, FFmpeg), as relative luminance (0-1). The Style tab's pairing cards
// measure one frame of the song's clips; the render measures each clip of a video (readability "auto":
// the soft backing behind the lyrics when the clips are bright there). Cached per file in
// workspace/cache/lyric-band.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ffmpegBin } from "@lyric/db";

import type { LyricArea } from "../platform";

// One frame (an image, or a video at `seekS` seconds); null when it cannot be read.
export function bandLuminance(file: string, area: Pick<LyricArea, "top" | "bottom">, height = 1920, seekS = 0): number | null {
  try {
    const w = 36;
    const h = 64;
    const seek = seekS > 0 ? ["-ss", seekS.toFixed(2)] : [];
    const raw = execFileSync(ffmpegBin(), ["-v", "error", ...seek, "-i", file, "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=gray`, "-frames:v", "1", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 });
    const from = Math.max(0, Math.floor((area.top / height) * h));
    const to = Math.min(h, Math.ceil((area.bottom / height) * h));
    const values = [...raw.subarray(from * w, to * w)].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length * 0.9)] : null;
  } catch {
    return null;
  }
}

// Each clip behind the lyric band, at its best moment (where its first shot is centred), else 1 s in
// (photos: the image). Cached: a clip is measured once per file version, band and moment.
export function clipBandLuminances(
  workspaceDir: string,
  clips: readonly { file: string; atS: number }[],
  area: Pick<LyricArea, "top" | "bottom">,
  height: number,
): (number | null)[] {
  const cacheFile = path.join(workspaceDir, "cache", "lyric-band.json");
  let cache: Record<string, number | null> = {};
  try {
    cache = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, number | null>) : {};
  } catch {
    cache = {};
  }
  let changed = false;
  const out = clips.map(({ file, atS }) => {
    if (!existsSync(file)) return null;
    const st = statSync(file);
    const key = `${file}|${st.size}|${Math.round(st.mtimeMs)}|${area.top}-${area.bottom}/${height}|${atS.toFixed(1)}`;
    if (!(key in cache)) {
      cache[key] = bandLuminance(file, area, height, atS);
      changed = true;
    }
    return cache[key];
  });
  if (changed) {
    try {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      // a cache that cannot be written only means measuring again next time
    }
  }
  return out;
}
