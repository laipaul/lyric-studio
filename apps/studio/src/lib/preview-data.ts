// Server-side: prepares the /preview data once (song analysis, cuts, clips) by running the same
// code as "pnpm render:test" (packages/video/scripts/preview-data.ts), and keeps it in memory.
import { spawn } from "node:child_process";
import path from "node:path";

import type { MediaRoots } from "@lyric/video/media";
import type { RenderBase } from "@lyric/video";

export type PreviewData = {
  base: RenderBase;
  media: MediaRoots;
  defaultSeed: number;
  setupWarnings: string[];
  report: {
    song: string;
    bpm: number;
    downbeatConfidence: number;
    requestedSection: { start_ms: number; end_ms: number };
    section: { start_ms: number; end_ms: number };
    cuts: number;
    clipCount: number;
    lyricLines: number;
  };
};

// apps/studio -> project root
const REPO_ROOT = path.resolve(process.cwd(), "../..");

let cached: Promise<PreviewData> | null = null;

function load(): Promise<PreviewData> {
  return new Promise((resolve, reject) => {
    const tsx = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(process.execPath, [tsx, path.join(REPO_ROOT, "packages/video/scripts/preview-data.ts")], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => {
      err += d;
      process.stdout.write(String(d)); // show progress in the "pnpm dev" terminal
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        const data = JSON.parse(out);
        if (data.error) reject(new Error(data.error));
        else resolve(data as PreviewData);
      } catch {
        reject(new Error(`Preparing the preview failed:\n${err.slice(-2000)}`));
      }
    });
  });
}

export function getPreviewData(refresh = false): Promise<PreviewData> {
  if (refresh || !cached) {
    cached = load();
    cached.catch(() => (cached = null)); // retry next time after an error
  }
  return cached;
}
