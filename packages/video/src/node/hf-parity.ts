// The picture check (Theme Engine v2 on HyperFrames, step 2a): the same plan drawn by the current renderer
// (Remotion) and by HyperFrames, without the words, compared frame by frame. The lyric look differs on purpose
// until step 2b, so the lyrics are left out (a line kept after the end, so the readability band is still
// drawn by both) together with the title cards; everything else is the plan as it is.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { VIDEO } from "../config";
import type { LyricVideoProps } from "../props";

type Props = Omit<LyricVideoProps, "mediaBaseUrl">;

export function parityProps(props: Props): Props {
  const after = props.durationInFrames + 30;
  return {
    ...props,
    lyrics: props.lyrics.length ? [{ text: "x", startFrame: after, endFrame: after + 30 }] : [],
    lyricEffects: null,
    textCards: [],
    titleOverlay: null,
    nextLine: false,
    glow: null,
  };
}

export type Parity = { frames: number; mean: number; min: number; worst: { frame: number; ssim: number }[] };
// A frame this similar or more looks the same (SSIM 1 = identical; the two encodes alone differ by ~0.005).
export const PARITY_FRAME_MIN = 0.95;
export const PARITY_MEAN_MIN = 0.98;
export const parityPasses = (p: Parity) => p.mean >= PARITY_MEAN_MIN && p.min >= PARITY_FRAME_MIN;

// SSIM of every frame of `a` against the same frame of `b`.
export async function compareVideos(a: string, b: string, ffmpeg: string, workDir: string): Promise<Parity> {
  mkdirSync(workDir, { recursive: true });
  const stats = path.join(workDir, "ssim.txt");
  // FFmpeg's filter options use ':' and '\'; the stats file is given relative to the work folder (no drive letter).
  await new Promise<void>((ok, bad) => {
    const child = spawn(ffmpeg, ["-v", "error", "-i", a, "-i", b, "-lavfi", "[0:v][1:v]ssim=stats_file=ssim.txt", "-f", "null", "-"], { cwd: workDir, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", bad);
    child.on("close", (code) => (code === 0 ? ok() : bad(new Error(`ffmpeg (ssim) failed: ${err}`))));
  });
  const per = readFileSync(stats, "utf8")
    .split(/\r?\n/)
    .map((l) => ({ n: Number(l.match(/n:(\d+)/)?.[1]), v: Number(l.match(/All:([\d.]+)/)?.[1]) }))
    .filter((x) => Number.isFinite(x.n) && Number.isFinite(x.v));
  const vals = per.map((x) => x.v);
  return {
    frames: per.length,
    mean: vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length),
    min: vals.length ? Math.min(...vals) : 0,
    worst: [...per].sort((x, y) => x.v - y.v).slice(0, 5).map((x) => ({ frame: x.n - 1, ssim: x.v })),
  };
}

const t = (frame: number) => `${Math.floor(frame / VIDEO.fps / 60)}:${((frame / VIDEO.fps) % 60).toFixed(2).padStart(5, "0")}`;
export const parityText = (p: Parity) =>
  `${parityPasses(p) ? "the same picture" : "DIFFERENT"}: mean similarity ${p.mean.toFixed(4)}, lowest ${p.min.toFixed(4)} over ${p.frames} frames (lowest at ${p.worst.map((w) => `${t(w.frame)} ${w.ssim.toFixed(3)}`).join(", ")})`;
