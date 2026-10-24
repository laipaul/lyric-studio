import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin } from "../src";

export function tempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), `lyric-${prefix}-`));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const ffmpeg = (args: string[]) => execFileSync(ffmpegBin(), ["-y", "-v", "error", ...args]);

// A 3-second 440 Hz tone.
export function makeSong(file: string): string {
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", file]);
  return file;
}

// A 9:16 (360x640) clip: black for the first `blackSeconds`, then white until `totalSeconds`.
export function makeClip(file: string, totalSeconds: number, blackSeconds = 0.5): string {
  const white = totalSeconds - blackSeconds;
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=black:s=360x640:r=30:d=${blackSeconds}`,
    "-f", "lavfi", "-i", `color=c=white:s=360x640:r=30:d=${white}`,
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]",
    "-map", "[v]", "-c:v", "libx264", file,
  ]);
  return file;
}

// Average brightness of an image, 0 (black) to 255 (white).
export function brightness(imageFile: string): number {
  const raw = execFileSync(ffmpegBin(), [
    "-v", "error", "-i", imageFile, "-vf", "scale=1:1,format=gray", "-f", "rawvideo", "-",
  ]);
  return raw[0];
}
