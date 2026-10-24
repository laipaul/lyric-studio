// Beats from the audio analysis (services/audio), via the same command as "pnpm analyze --json".
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";

import type { Beat } from "../beats";

export type Analysis = {
  bpm: number;
  duration_ms: number;
  downbeat_confidence: number;
  downbeat_offset: number; // already applied to `beats`
  beats: Beat[];
};

export function analyzeSong(song: string, options: { downbeatOffset?: number } = {}): Analysis {
  if (!existsSync(song)) throw new Error(`Song not found: ${song}`);
  const args = [path.join(REPO_ROOT, "services/audio/scripts/analyze.mjs"), song, "--json"];
  if (options.downbeatOffset !== undefined) args.push("--downbeat-offset", String(options.downbeatOffset));
  const run = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  if (run.status !== 0) throw new Error("The audio analysis failed (see the messages above).");
  return JSON.parse(run.stdout) as Analysis;
}
