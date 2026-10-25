// Spotify Canvas in "pnpm make": scores the clips with FFmpeg (motion, colour, contrast; sampled 10
// times a second), picks the strongest window per clip and builds a seamless loop of whole bars.
// No lyrics, no text, no logo, no audio.
import { execFile } from "node:child_process";

import { absPath, ffmpegBin, ffprobeBin, type Workspace } from "@lyric/db";

import { CANVAS, CANVAS_MIN_RATE, canvasLengths, chooseCanvasFit, lengthText, parseSignalStats, strongestWindows, type CanvasFit, type CanvasLength, type FrameStats } from "../canvas";
import { VIDEO } from "../config";
import { kenBurns } from "../photo";
import { mulberry32 } from "../prng";
import type { ShotProps } from "../props";
import type { PreparedForFormat } from "./collection";

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(bin, args, { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60_000 }, (error, stdout, stderr) =>
      error ? reject(new Error(`${bin} failed: ${stderr.trim() || error.message}`)) : resolve(`${stdout}\n${stderr}`),
    ),
  );
}

// Per-frame statistics of a (prepared, 30 fps) clip, sampled CANVAS.sampleFps times a second.
export async function clipStats(file: string): Promise<FrameStats[]> {
  const out = await run(ffmpegBin(), ["-hide_banner", "-nostats", "-v", "info", "-i", file, "-an", "-vf", `fps=${CANVAS.sampleFps},scale=108:192,signalstats,metadata=mode=print`, "-f", "null", "-"]);
  return parseSignalStats(out);
}

export type CanvasLoop = { shot: ShotProps; clip: string; atSeconds: number; score: number | null; rate: number };

export type CanvasPlan = {
  lengthFrames: number;
  seconds: number;
  bars: number | null;
  loops: CanvasLoop[];
  fallback: CanvasFit["fallback"];
  reason: string;
  warnings: string[];
};

// One loop per variation: the strongest window of the best clips (one per clip). If no clip is long
// enough: fewer bars, then the clips slowed down (to 0.6x), then a photo moving out and back; only
// then an error saying what would work.
export async function planCanvas(
  ws: Workspace,
  clips: PreparedForFormat["clips"],
  options: { bpm: number; count: number; min?: number; max?: number },
): Promise<CanvasPlan> {
  const lengths = canvasLengths(options.bpm, options.min, options.max);
  const blend = Math.round(CANVAS.blendSeconds * VIDEO.fps);
  const step = VIDEO.fps / CANVAS.sampleFps; // clip frames per sample
  const videos = clips.filter((c) => c.kind === "video" && c.fit === "cover");
  const photos = clips.filter((c) => c.kind === "photo" && c.fit === "cover");
  const fit = chooseCanvasFit(lengths, videos.map((v) => v.durationFrames), blend, photos.length, VIDEO.fps);
  const length = fit.length;
  const lengthFrames = Math.round(length.seconds * VIDEO.fps);
  const longest = Math.max(0, ...videos.map((v) => v.durationFrames)) / VIDEO.fps;
  const needS = (l: CanvasLength) => (Math.round(l.seconds * VIDEO.fps) + blend) / VIDEO.fps;
  const warnings: string[] = [];
  const tooShort = `no vertical clip is long enough for ${lengthText(lengths[0])} (it needs ${needS(lengths[0]).toFixed(1)} s${videos.length ? `, the longest is ${longest.toFixed(1)} s` : ""})`;

  if (fit.fallback === "fail") {
    const shortest = lengths[lengths.length - 1];
    throw new Error(
      `canvas: ${tooShort}, not even for ${lengthText(shortest)} slowed down to ${CANVAS_MIN_RATE}x, and there is no vertical photo. ` +
        `What would work: a vertical clip of at least ${(needS(shortest) * CANVAS_MIN_RATE).toFixed(1)} s (or ${needS(lengths[0]).toFixed(1)} s for ${lengthText(lengths[0])} at normal speed), ` +
        "or a vertical photo (jpg/png/webp) in the collection.",
    );
  }

  const loops: CanvasLoop[] = [];
  if (fit.fallback !== "photo") {
    const usable = videos.map((v, i) => ({ v, rate: fit.rates[i] })).filter((x): x is { v: (typeof videos)[number]; rate: number } => x.rate !== null);
    const stats = await Promise.all(
      usable.map(async ({ v, rate }) => ({
        name: v.name,
        stats: await clipStats(absPath(ws, v.path)),
        windowSamples: Math.ceil(((lengthFrames + blend) * rate) / step), // its own frames this loop takes
      })),
    );
    for (const w of strongestWindows(stats, 1).slice(0, options.count)) {
      const { v: c, rate } = usable.find((u) => u.v.name === w.name)!;
      const start = Math.round(w.startSample * step); // the blend uses the frames before the loop's own start
      const blendClipFrames = Math.round(blend * rate);
      loops.push({
        clip: c.name,
        atSeconds: (start + blendClipFrames) / VIDEO.fps,
        score: w.score,
        rate,
        shot: {
          start: 0,
          duration: lengthFrames,
          src: c.path,
          clipStartFrame: start + blendClipFrames,
          clipDurationFrames: c.durationFrames,
          playbackRate: rate,
          holdLastFrame: false,
          loopBlend: { frames: blend, fromClipFrame: start },
        },
      });
    }
  } else {
    photos.slice(0, options.count).forEach((p, i) => {
      loops.push({
        clip: p.name,
        atSeconds: 0,
        score: null,
        rate: 1,
        shot: {
          start: 0, duration: lengthFrames, src: p.path, clipStartFrame: 0, clipDurationFrames: lengthFrames, playbackRate: 1, holdLastFrame: false,
          kind: "photo", motion: kenBurns(mulberry32(1013 + i)), motionLoop: true,
        },
      });
    });
  }

  const first = loops[0];
  let fallbackText = "";
  if (fit.fallback === "fewer-bars") fallbackText = `fallback 1 (fewer bars): ${lengthText(length)} instead of ${lengthText(lengths[0])}, because ${tooShort}`;
  if (fit.fallback === "slow") {
    const slowest = Math.min(...loops.map((l) => l.rate));
    fallbackText = `fallback 2 (slowed down): ${lengthText(length)} with the clip${loops.length > 1 ? "s" : ""} slowed to ${slowest.toFixed(2)}x, because ${tooShort} (not even for ${lengthText(length)} at normal speed)`;
  }
  if (fit.fallback === "photo") fallbackText = `fallback 3 (photo): a vertical photo moving out and back, because ${tooShort} (not even slowed down to ${CANVAS_MIN_RATE}x)`;
  if (fallbackText) warnings.push(fallbackText);
  if (loops.length < options.count) warnings.push(`only ${loops.length} clip(s) give a loop, so ${loops.length} variation(s) instead of ${options.count}`);
  const moment = first.score !== null ? ` from ${first.atSeconds.toFixed(1)} s${first.rate < 1 ? ` at ${first.rate.toFixed(2)}x` : ""}` : " (photo, moving out and back)";
  const reason = `a seamless loop of ${lengthText(length)} at ${options.bpm} BPM; strongest moment: ${first.clip}${moment}${fallbackText ? `; ${fallbackText.split(":")[0]}` : ""}`;
  return { lengthFrames, seconds: lengthFrames / VIDEO.fps, bars: length.bars, loops, fallback: fit.fallback, reason, warnings };
}

// For QA: how different the last frame is from the first (mean absolute difference, 0-255) compared
// with an ordinary step between two neighbouring frames, whether the file has an audio stream, and
// its length.
export async function loopCheck(file: string): Promise<{ lastToFirst: number; typicalStep: number; hasAudio: boolean; seconds: number }> {
  const output = (bin: string, args: string[]) =>
    new Promise<Buffer>((resolve, reject) =>
      execFile(bin, args, { windowsHide: true, encoding: "buffer", maxBuffer: 512 * 1024 * 1024, timeout: 10 * 60_000 }, (error, stdout, stderr) =>
        error ? reject(new Error(`${bin} failed: ${stderr.toString().trim() || error.message}`)) : resolve(stdout),
      ),
    );
  const probe = JSON.parse((await output(ffprobeBin(), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file])).toString()) as {
    streams: { codec_type: string }[];
    format: { duration: string };
  };
  const raw = await output(ffmpegBin(), ["-v", "error", "-i", file, "-an", "-vf", "scale=54:96,format=gray", "-f", "rawvideo", "-"]);
  const size = 54 * 96;
  const count = Math.floor(raw.length / size);
  const diff = (a: number, b: number) => {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Math.abs(raw[a * size + i] - raw[b * size + i]);
    return sum / size;
  };
  const steps: number[] = [];
  for (let f = 1; f < count; f++) steps.push(diff(f - 1, f));
  steps.sort((x, y) => x - y);
  return {
    lastToFirst: count > 1 ? diff(count - 1, 0) : 0,
    typicalStep: steps.length ? steps[Math.floor(steps.length * 0.75)] : 0,
    hasAudio: probe.streams.some((s) => s.codec_type === "audio"),
    seconds: Number(probe.format.duration),
  };
}
