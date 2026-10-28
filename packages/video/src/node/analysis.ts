// Beats from the audio analysis (services/audio), via the same command as "pnpm analyze --json".
import { spawn, spawnSync } from "node:child_process";
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

// bpm: the song's real tempo when the detected one is wrong (song.json "tempo"): the beats are re-tracked
// around it (half / double from the detected beats, any other tempo by tracking again).
export function analyzeSong(song: string, options: { downbeatOffset?: number; bpm?: number } = {}): Analysis {
  if (!existsSync(song)) throw new Error(`Song not found: ${song}`);
  const args = [path.join(REPO_ROOT, "services/audio/scripts/analyze.mjs"), song, "--json"];
  if (options.downbeatOffset !== undefined) args.push("--downbeat-offset", String(options.downbeatOffset));
  if (options.bpm !== undefined) args.push("--bpm", String(options.bpm));
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

export type TempoCheck = { bpm: number; downbeat_confidence: number; candidates: { bpm: number; strength: number; ratio: string | null }[] };

// The detected tempo and the likeliest other tempi (ratio "x2/3": a 3:2 error), as "pnpm tempo:check"
// prints them; for the Style tab's tempo check. Asynchronous: the studio keeps answering meanwhile.
export function tempoCheck(song: string): Promise<TempoCheck> {
  if (!existsSync(song)) return Promise.reject(new Error(`Song not found: ${song}`));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "services/audio/scripts/analyze.mjs"), song, "--json", "--candidates"], { cwd: REPO_ROOT, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`The tempo check failed: ${err.trim().split("\n").pop() ?? code}`));
      const r = JSON.parse(out) as { bpm: number; downbeat_confidence: number; tempo_candidates?: TempoCheck["candidates"] };
      resolve({ bpm: r.bpm, downbeat_confidence: r.downbeat_confidence, candidates: r.tempo_candidates ?? [] });
    });
  });
}
