// Renders LyricVideo to MP4 with Remotion: H.264, AAC 192 kbps, yuv420p, faststart (see CLAUDE.md).
import { execFile } from "node:child_process";
import { closeSync, openSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ffmpegBin } from "@lyric/db";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import { COMPOSITION_ID } from "../config";
import type { LyricVideoProps } from "../props";
import { defaultFontDirs } from "./font-dirs";
import { startMediaServer, type MediaRoots } from "./media";

export const ENTRY_POINT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../entry.ts");

// Optional: a Chrome/Chromium headless shell to use instead of Remotion's own download.
const browserExecutable = () => process.env.REMOTION_BROWSER_EXECUTABLE || null;

let bundled: Promise<string> | null = null;

// Webpack bundle of the composition, built once per process.
export function getBundle(log: (m: string) => void = () => {}): Promise<string> {
  bundled ??= (async () => {
    log("bundling the composition");
    return bundle({ entryPoint: ENTRY_POINT });
  })();
  return bundled;
}

export type RenderOptions = {
  props: Omit<LyricVideoProps, "mediaBaseUrl">;
  media: MediaRoots;
  outFile: string;
  onProgress?: (fraction: number) => void;
  log?: (message: string) => void;
  frameRange?: [number, number];
};

export async function renderLyricVideo(options: RenderOptions): Promise<string> {
  const log = options.log ?? (() => {});
  const server = await startMediaServer({ ...options.media, fontDirs: options.media.fontDirs ?? defaultFontDirs() });
  try {
    const inputProps: LyricVideoProps = { ...options.props, mediaBaseUrl: server.url, showSafeGuides: false };
    const serveUrl = await getBundle(log);
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      browserExecutable: browserExecutable(),
      logLevel: "error",
      onBrowserDownload: () => {
        log("downloading Remotion's headless Chrome (one time, ~100 MB)");
        return { version: null, onProgress: () => {} };
      },
    });
    const tmp = `${options.outFile}.part.mp4`;
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      audioBitrate: "192k",
      pixelFormat: "yuv420p",
      colorSpace: "bt709", // standard (limited) range: plain yuv420p, not full-range yuvj420p
      logLevel: "error",
      outputLocation: tmp,
      overwrite: true,
      browserExecutable: browserExecutable(),
      frameRange: options.frameRange ?? null,
      onProgress: ({ progress }) => options.onProgress?.(progress),
    });
    await ensureFaststart(tmp);
    rmSync(options.outFile, { force: true });
    renameSync(tmp, options.outFile);
    return options.outFile;
  } finally {
    await server.close();
  }
}

// True if the MP4 index ("moov") comes before the media data ("mdat"), so playback can start
// before the whole file has downloaded.
export function isFaststart(file: string): boolean {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    const header = Buffer.alloc(16);
    let offset = 0;
    while (offset + 8 <= size) {
      readSync(fd, header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (type === "moov") return true;
      if (type === "mdat") return false;
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
      if (boxSize < 8) return false;
      offset += boxSize;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

async function ensureFaststart(file: string): Promise<void> {
  if (isFaststart(file)) return;
  const fixed = `${file}.faststart.mp4`;
  await new Promise<void>((resolve, reject) =>
    execFile(ffmpegBin(), ["-y", "-v", "error", "-i", file, "-c", "copy", "-movflags", "+faststart", fixed], { windowsHide: true }, (error, _o, stderr) =>
      error ? reject(new Error(`ffmpeg faststart failed: ${stderr || error.message}`)) : resolve(),
    ),
  );
  renameSync(fixed, file);
}
