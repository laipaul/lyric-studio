// Spotify Canvas in "pnpm make": scores the clips with FFmpeg (motion, colour, contrast; sampled 10
// times a second), picks the strongest window per clip and builds a seamless loop of whole bars.
// No lyrics, no text, no logo, no audio.
import { execFile } from "node:child_process";

import { absPath, ffmpegBin, ffprobeBin, type Workspace } from "@lyric/db";

import { CANVAS, canvasLength, parseSignalStats, strongestWindows, type FrameStats } from "../canvas";
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

export type CanvasLoop = { shot: ShotProps; clip: string; atSeconds: number; score: number | null };

export type CanvasPlan = { lengthFrames: number; seconds: number; bars: number | null; loops: CanvasLoop[]; reason: string; warnings: string[] };

// One loop per variation: the strongest window of the best clips (one per clip), or, with photos
// only, a photo whose move goes out and back.
export async function planCanvas(
  ws: Workspace,
  clips: PreparedForFormat["clips"],
  options: { bpm: number; count: number; min?: number; max?: number },
): Promise<CanvasPlan> {
  const length = canvasLength(options.bpm, options.min, options.max);
  const lengthFrames = Math.round(length.seconds * VIDEO.fps);
  const blend = Math.round(CANVAS.blendSeconds * VIDEO.fps);
  const step = VIDEO.fps / CANVAS.sampleFps; // clip frames per sample
  const windowSamples = Math.ceil((lengthFrames + blend) / step);
  const lengthText = length.bars ? `${length.bars} bar${length.bars > 1 ? "s" : ""} (${length.seconds.toFixed(2)} s)` : `${length.beats} beats (${length.seconds.toFixed(2)} s)`;
  const warnings: string[] = [];

  const videos = clips.filter((c) => c.kind === "video" && c.fit === "cover");
  const stats = await Promise.all(videos.map(async (c) => ({ name: c.name, stats: await clipStats(absPath(ws, c.path)) })));
  const windows = strongestWindows(stats, windowSamples);
  const loops: CanvasLoop[] = windows.slice(0, options.count).map((w) => {
    const c = videos.find((v) => v.name === w.name)!;
    const start = Math.round(w.startSample * step); // the blend uses the frames before the loop's own start
    return {
      clip: c.name,
      atSeconds: (start + blend) / VIDEO.fps,
      score: w.score,
      shot: {
        start: 0,
        duration: lengthFrames,
        src: c.path,
        clipStartFrame: start + blend,
        clipDurationFrames: c.durationFrames,
        playbackRate: 1,
        holdLastFrame: false,
        loopBlend: { frames: blend, fromClipFrame: start },
      },
    };
  });

  if (!loops.length) {
    const photos = clips.filter((c) => c.kind === "photo" && c.fit === "cover");
    if (!photos.length) {
      const longest = Math.max(0, ...videos.map((v) => v.durationFrames)) / VIDEO.fps;
      throw new Error(
        `canvas: a loop of ${lengthText} needs a vertical clip of at least ${((lengthFrames + blend) / VIDEO.fps).toFixed(1)} s` +
          (videos.length ? ` (the longest is ${longest.toFixed(1)} s)` : "") +
          " or a vertical photo",
      );
    }
    warnings.push(`no vertical clip is long enough for ${lengthText}; looping photo(s) instead`);
    photos.slice(0, options.count).forEach((p, i) => {
      loops.push({
        clip: p.name,
        atSeconds: 0,
        score: null,
        shot: {
          start: 0, duration: lengthFrames, src: p.path, clipStartFrame: 0, clipDurationFrames: lengthFrames, playbackRate: 1, holdLastFrame: false,
          kind: "photo", motion: kenBurns(mulberry32(1013 + i)), motionLoop: true,
        },
      });
    });
  }
  if (loops.length < options.count) warnings.push(`only ${loops.length} clip(s) give a loop, so ${loops.length} variation(s) instead of ${options.count}`);
  const first = loops[0];
  const reason = `a seamless loop of ${lengthText} at ${options.bpm} BPM; strongest moment: ${first.clip}${first.score !== null ? ` from ${first.atSeconds.toFixed(1)} s` : " (photo, moving out and back)"}`;
  return { lengthFrames, seconds: lengthFrames / VIDEO.fps, bars: length.bars, loops, reason, warnings };
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
