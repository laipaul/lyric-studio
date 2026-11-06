// Frame accuracy of a renderer (Theme Engine v2 step 1, decision D1): a test clip whose every frame carries its
// own number (12 black / white blocks across the top), a plan that plays it trimmed, slowed, jumping back and
// running out (its last frame held), and a reader that decodes the number from every frame of the output.
// Each output frame must show exactly the source frame the plan asks for.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { VIDEO } from "../config";
import { SIMPLE_STYLE, type LyricVideoProps } from "../props";

export const TEST_CLIP_FRAMES = 300;
const BITS = 12;
const BLOCK = 80; // px, at 1080 wide
const ROW_Y = 160;
const ROW_X = Math.round((VIDEO.width - BITS * BLOCK) / 2);

// A 10 s clip at 30 fps, 1080x1920, each frame with its number in binary.
export async function makeNumberedClip(file: string, ffmpeg: string): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const w = VIDEO.width;
  const h = VIDEO.height;
  await new Promise<void>((ok, bad) => {
    const child = spawn(ffmpeg, ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${w}x${h}`, "-r", String(VIDEO.fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", "60", "-pix_fmt", "yuv420p", file], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", bad);
    child.on("close", (code) => (code === 0 ? ok() : bad(new Error(`ffmpeg (test clip) failed: ${err}`))));
    for (let n = 0; n < TEST_CLIP_FRAMES; n++) {
      const frame = Buffer.alloc(w * h, 60); // grey background
      for (let b = 0; b < BITS; b++) {
        const on = (n >> (BITS - 1 - b)) & 1;
        for (let y = ROW_Y; y < ROW_Y + BLOCK; y++) frame.fill(on ? 235 : 16, y * w + ROW_X + b * BLOCK, y * w + ROW_X + (b + 1) * BLOCK);
      }
      child.stdin.write(frame);
    }
    child.stdin.end();
  });
}

// The plan: (start, length, where in the clip, speed); the last shot runs out and holds the clip's last frame.
export const FRAME_TEST_SHOTS = [
  { start: 0, duration: 45, clipStartFrame: 0, playbackRate: 1 },
  { start: 45, duration: 60, clipStartFrame: 200, playbackRate: 0.5 },
  { start: 105, duration: 45, clipStartFrame: 30, playbackRate: 0.75 }, // jumps back
  { start: 150, duration: 60, clipStartFrame: 270, playbackRate: 1 }, // 30 frames left: then held
  { start: 210, duration: 30, clipStartFrame: 100, playbackRate: 1 },
];
export const FRAME_TEST_LENGTH = 240;

export function frameTestProps(src: string): Omit<LyricVideoProps, "mediaBaseUrl"> {
  return {
    audio: null,
    durationInFrames: FRAME_TEST_LENGTH,
    cutFrames: FRAME_TEST_SHOTS.slice(1).map((s) => s.start),
    shots: FRAME_TEST_SHOTS.map((s) => ({ ...s, src, clipDurationFrames: TEST_CLIP_FRAMES, holdLastFrame: s.clipStartFrame + s.duration * s.playbackRate > TEST_CLIP_FRAMES })),
    lyrics: [],
    style: SIMPLE_STYLE,
    fonts: [],
    textSize: 64,
    colour: "#ffffff",
    cinematicBars: false,
    format: { width: VIDEO.width, height: VIDEO.height },
  };
}

// The source frame each output frame should show (a slowed shot may land between two frames: either counts).
export function expectedFrames(): { lo: number; hi: number }[] {
  const out: { lo: number; hi: number }[] = [];
  for (const s of FRAME_TEST_SHOTS) {
    for (let k = 0; k < s.duration; k++) {
      const e = Math.min(TEST_CLIP_FRAMES - 1, s.clipStartFrame + k * s.playbackRate);
      out.push({ lo: Math.floor(e), hi: Math.min(TEST_CLIP_FRAMES - 1, Math.ceil(e)) });
    }
  }
  return out;
}

// The number on every frame of a rendered video (null: unreadable).
export async function readFrameNumbers(video: string, ffmpeg: string): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  await new Promise<void>((ok, bad) => {
    const child = spawn(ffmpeg, ["-v", "error", "-i", video, "-vf", `crop=${BITS * BLOCK}:${BLOCK - 20}:${ROW_X}:${ROW_Y + 10},scale=${BITS}:1:flags=area,format=gray`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = Buffer.alloc(0);
    child.stdout.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= BITS) {
        const px = buf.subarray(0, BITS);
        const unclear = [...px].some((v) => v > 90 && v < 170);
        out.push(unclear ? null : [...px].reduce((n, v) => (n << 1) | (v >= 128 ? 1 : 0), 0));
        buf = buf.subarray(BITS);
      }
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", bad);
    child.on("close", (code) => (code === 0 ? ok() : bad(new Error(`ffmpeg (reading frames) failed: ${err}`))));
  });
  return out;
}

export type FrameAccuracy = { frames: number; exact: number; off: { frame: number; got: number | null; want: string }[]; accurate: boolean };

export function checkFrames(got: (number | null)[]): FrameAccuracy {
  const want = expectedFrames();
  const off: FrameAccuracy["off"] = [];
  want.forEach((w, f) => {
    const g = got[f] ?? null;
    if (g === null || g < w.lo || g > w.hi) off.push({ frame: f, got: g, want: w.lo === w.hi ? String(w.lo) : `${w.lo}-${w.hi}` });
  });
  if (got.length !== want.length) off.push({ frame: -1, got: got.length, want: `${want.length} frames` });
  return { frames: want.length, exact: want.length - off.filter((o) => o.frame >= 0).length, off, accurate: off.length === 0 };
}

export const frameAccuracyText = (a: FrameAccuracy) =>
  a.accurate ? `${a.exact} of ${a.frames} frames exactly as planned` : `${a.exact} of ${a.frames} frames as planned; off: ${a.off.slice(0, 6).map((o) => (o.frame < 0 ? `${o.got} frames instead of ${o.want}` : `frame ${o.frame} shows ${o.got ?? "?"} (want ${o.want})`)).join(", ")}${a.off.length > 6 ? ` and ${a.off.length - 6} more` : ""}`;
