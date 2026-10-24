// Real renders of the LyricVideo composition (headless Chrome via Remotion). Clips are solid colours
// so every frame's content can be checked exactly.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, ffprobeBin } from "@lyric/db";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COMPOSITION_ID,
  LYRIC_AREA,
  SAFE_ZONE,
  VIDEO,
  assignClips,
  getCutPoints,
  type LyricVideoProps,
  type ShotProps,
} from "../src";
import { defaultFontDirs, getBundle, isFaststart, layoutForStyle, renderLyricVideo, startMediaServer, type MediaServer } from "../src/node";
import { grid } from "./helpers";

const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-render-"));
const ffmpeg = (...args: string[]) => execFileSync(ffmpegBin(), ["-y", "-v", "error", ...args]);
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;

// Small clips are fine: the composition cover-scales them to 1080x1920.
function solidClip(name: string, segments: [string, number][]): string {
  const inputs = segments.flatMap(([c, d]) => ["-f", "lavfi", "-i", `color=c=${c}:s=108x192:r=30:d=${d}`]);
  const concat = segments.map((_, i) => `[${i}:v]`).join("") + `concat=n=${segments.length}:v=1:a=0,format=yuv420p[v]`;
  ffmpeg(...inputs, "-filter_complex", concat, "-map", "[v]", "-c:v", "libx264", "-g", "1", path.join(dir, name));
  return name;
}

const COLOURS: Record<string, [number, number, number]> = {
  red: [255, 0, 0],
  blue: [0, 0, 255],
  lime: [0, 255, 0],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  black: [0, 0, 0],
};

let server: MediaServer;
let browser: Awaited<ReturnType<typeof openBrowser>>;
let serveUrl: string;

const baseProps = (over: Partial<LyricVideoProps>): LyricVideoProps => ({
  mediaBaseUrl: server.url,
  audio: null,
  durationInFrames: 90,
  cutFrames: [],
  shots: [],
  lyrics: [],
  style: { name: "Simple", font: "Inter", weight: 600, textCase: "none", effect: "none", animation: "fade" },
  textSize: 64,
  colour: "#ffffff",
  cinematicBars: false,
  ...over,
});

// Renders one frame and returns its pixels (RGB) in the given rectangle.
async function frameRegion(props: LyricVideoProps, frame: number, rect = { x: 0, y: 0, w: 1080, h: 1920 }) {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props, puppeteerInstance: browser, logLevel: "error" });
  const file = path.join(dir, `still-${Math.random().toString(36).slice(2)}.png`);
  await renderStill({ serveUrl, composition, frame, output: file, inputProps: props, puppeteerInstance: browser, logLevel: "error" });
  const raw = execFileSync(ffmpegBin(), [
    "-v", "error", "-i", file, "-vf", `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { maxBuffer: 64 * 1024 * 1024 });
  rmSync(file);
  return { raw, w: rect.w, h: rect.h };
}

async function centreColour(props: LyricVideoProps, frame: number): Promise<string> {
  const { raw } = await frameRegion(props, frame, { x: 500, y: 300, w: 40, h: 40 });
  const avg = [0, 1, 2].map((c) => {
    let sum = 0;
    for (let i = c; i < raw.length; i += 3) sum += raw[i];
    return sum / (raw.length / 3);
  });
  let best = "?";
  let bestDistance = Infinity;
  for (const [name, rgb] of Object.entries(COLOURS)) {
    const d = Math.hypot(...rgb.map((v, i) => v - avg[i]));
    if (d < bestDistance) [best, bestDistance] = [name, d];
  }
  return bestDistance < 60 ? best : `?(${avg.map(Math.round).join(",")})`;
}

// Pixels of the lyric colour (#ff00ff): returns their bounding box, or null if there are none.
async function magentaBox(props: LyricVideoProps, frame: number) {
  const { raw, w, h } = await frameRegion(props, frame);
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      // Magenta-ish on black, also while fading in (>= 40% opacity).
      if (raw[i] > 70 && raw[i + 2] > 70 && raw[i + 1] < 40 && Math.abs(raw[i] - raw[i + 2]) < 40) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

const shot = (over: Partial<ShotProps> & Pick<ShotProps, "src" | "start" | "duration">): ShotProps => ({
  clipStartFrame: 0,
  clipDurationFrames: 90,
  playbackRate: 1,
  holdLastFrame: false,
  ...over,
});

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  for (const c of ["red", "blue", "lime", "yellow"]) solidClip(`${c}.mp4`, [[c, 3]]);
  solidClip("red-then-lime.mp4", [["red", 1], ["lime", 2]]); // switches colour at exactly 1.0 s (frame 30)
  solidClip("yellow-then-cyan.mp4", [["yellow", 0.5], ["cyan", 0.5]]); // 1 s, ends cyan
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=48000", "-ac", "2", path.join(dir, "tone.wav"));
  server = await startMediaServer({ workspaceDir: dir, fontDirs: defaultFontDirs() });
  serveUrl = await getBundle();
  browser = await openBrowser("chrome", { browserExecutable, logLevel: "error" });
}, 300_000);

afterAll(async () => {
  await browser?.close({ silent: true });
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("LyricVideo render", () => {
  it("renders a 3-second sample as 1080x1920 30 fps H.264 / AAC 192k / yuv420p / faststart", async () => {
    const out = path.join(dir, "sample.mp4");
    await renderLyricVideo({
      props: {
        ...baseProps({}),
        audio: { src: "tone.wav", startFrame: 15, fadeInFrames: 9, fadeOutFrames: 15 },
        shots: [shot({ src: "red.mp4", start: 0, duration: 45 }), shot({ src: "blue.mp4", start: 45, duration: 45 })],
        cutFrames: [45],
        lyrics: [{ text: "Sample line", startFrame: 10, endFrame: 80 }],
      },
      media: { workspaceDir: dir },
      outFile: out,
    });
    const probe = JSON.parse(
      execFileSync(ffprobeBin(), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]).toString(),
    );
    const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    expect(video.codec_name).toBe("h264");
    expect([video.width, video.height]).toEqual([1080, 1920]);
    expect(video.r_frame_rate).toBe("30/1");
    expect(video.pix_fmt).toBe("yuv420p");
    expect(audio.codec_name).toBe("aac");
    expect(Number(audio.bit_rate)).toBeGreaterThan(150_000);
    expect(Number(audio.bit_rate)).toBeLessThanOrEqual(200_000);
    expect(Number(probe.format.duration)).toBeCloseTo(3, 1);
    expect(isFaststart(out)).toBe(true);

    // Audio fades: quiet at the very start and end, full in the middle.
    const pcm = execFileSync(ffmpegBin(), ["-v", "error", "-i", out, "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { maxBuffer: 64 * 1024 * 1024 });
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    const rms = (fromS: number, toS: number) => {
      let sum = 0;
      const a = Math.floor(fromS * 48000), b = Math.floor(toS * 48000);
      for (let i = a; i < b; i++) sum += samples[i] ** 2;
      return Math.sqrt(sum / (b - a));
    };
    const middle = rms(1.2, 1.8);
    expect(middle).toBeGreaterThan(1000);
    expect(rms(0, 0.05)).toBeLessThan(middle * 0.3);
    expect(rms(2.95, 3.0)).toBeLessThan(middle * 0.3);
  }, 300_000);

  it("cuts on exactly the frames from getCutPoints", async () => {
    const beats = grid(120, 16, 500); // downbeats at 0.5 s, 2.5 s, ...
    const plan = getCutPoints(beats, { start_ms: 500, end_ms: 6_000 }, { cutRate: "2x" }); // every half bar
    const clips = ["red", "blue", "lime", "yellow"].map((c) => ({ id: `${c}.mp4`, duration_ms: 3_000 }));
    const shots = assignClips(plan, clips, 3).map((s) =>
      shot({ src: s.clip_id, start: s.start_frame - plan.start_frame, duration: s.duration_frames, clipStartFrame: s.clip_start_frame }),
    );
    const cutFrames = plan.cuts.map((c) => c.frame - plan.start_frame);
    const props = baseProps({ durationInFrames: plan.end_frame - plan.start_frame, shots, cutFrames });
    expect(cutFrames.length).toBeGreaterThanOrEqual(4);
    for (const [i, cut] of cutFrames.entries()) {
      expect(await centreColour(props, cut - 1)).toBe(shots[i].src.replace(".mp4", ""));
      expect(await centreColour(props, cut)).toBe(shots[i + 1].src.replace(".mp4", ""));
    }
  }, 300_000);

  it("shows a lyric line exactly from its first to its last frame", async () => {
    const props = baseProps({ colour: "#ff00ff", lyrics: [{ text: "Hello world", startFrame: 20, endFrame: 50 }] });
    expect(await magentaBox(props, 19)).toBeNull();
    expect(await magentaBox(props, 20)).not.toBeNull();
    expect(await magentaBox(props, 49)).not.toBeNull();
    expect(await magentaBox(props, 50)).toBeNull();
  }, 300_000);

  const SIMPLE = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
  const BOLD = { name: "Bold", font: "Montserrat", weight: 900, textCase: "upper" as const, effect: "shadow", animation: "pop" };

  // Renders `text` and checks: inside the safe zone and the lyric area, centred around 62.5% of the
  // height, and exactly as many lines as the Node-side layout predicts.
  async function checkLongLine(text: string, style: typeof SIMPLE | typeof BOLD, textSize: number, expectedLines: number) {
    const layout = layoutForStyle(text, style, textSize);
    expect(layout.lines).toHaveLength(expectedLines);
    const props = baseProps({ colour: "#ff00ff", style, textSize, lyrics: [{ text, startFrame: 0, endFrame: 90 }] });
    const box = (await magentaBox(props, 30))!;
    expect(box).not.toBeNull();
    expect(box.maxX).toBeLessThan(VIDEO.width * (1 - SAFE_ZONE.right));
    expect(box.maxY).toBeLessThan(VIDEO.height * (1 - SAFE_ZONE.bottom));
    expect(box.minX).toBeGreaterThanOrEqual(LYRIC_AREA.left - 2);
    expect(box.maxX).toBeLessThanOrEqual(LYRIC_AREA.right + 2);
    expect(Math.abs((box.minY + box.maxY) / 2 - LYRIC_AREA.centerY)).toBeLessThan(40);
    // Height of the text block matches the number of lines at the chosen font size.
    const lineHeight = LYRIC_AREA.lineHeight * layout.fontSize;
    expect(box.maxY - box.minY).toBeLessThan(expectedLines * lineHeight);
    expect(box.maxY - box.minY).toBeGreaterThan((expectedLines - 1) * lineHeight);
    return layout;
  }

  it("wraps a long line onto 2 balanced lines and shrinks it, inside the safe zone", async () => {
    const simple = await checkLongLine("Every single night I keep on dreaming of the summer days", SIMPLE, 64, 2);
    expect(simple.fontSize).toBeLessThan(64);
    const bold = await checkLongLine("Dancing in the moonlight with you", BOLD, 84, 2);
    expect(bold.fontSize).toBeLessThan(84);
  }, 300_000);

  it("uses 3 lines only as a last resort and never more, even for absurdly long lines", async () => {
    const layout = await checkLongLine("Every single night I keep on dreaming of the summer days we lost together", SIMPLE, 64, 3);
    expect(layout.tooLong).toBe(true);
    const absurd = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    await checkLongLine(absurd, BOLD, 84, 3);
  }, 300_000);

  it("applies playbackRate and the start offset inside the clip", async () => {
    const at = (rate: number, clipStartFrame = 0) =>
      baseProps({ shots: [shot({ src: "red-then-lime.mp4", start: 0, duration: 90, playbackRate: rate, clipStartFrame })] });
    // The clip turns lime at its 1.0 s mark (frame 30).
    expect(await centreColour(at(1), 25)).toBe("red");
    expect(await centreColour(at(1), 35)).toBe("lime");
    // At 0.5x the switch happens at shot frame 60.
    expect(await centreColour(at(0.5), 50)).toBe("red");
    expect(await centreColour(at(0.5), 70)).toBe("lime");
    // Starting 40 frames into the clip: lime from the first frame.
    expect(await centreColour(at(1, 40), 0)).toBe("lime");
  }, 300_000);

  it("holds the last frame when the clip is too short even at 0.5x", async () => {
    // 1 s clip (yellow, then cyan from 0.5 s) in a 3 s shot: 2 s at 0.5x, then hold the cyan last frame.
    const props = baseProps({
      shots: [shot({ src: "yellow-then-cyan.mp4", start: 0, duration: 90, clipDurationFrames: 30, playbackRate: 0.5, holdLastFrame: true })],
    });
    expect(await centreColour(props, 10)).toBe("yellow");
    expect(await centreColour(props, 45)).toBe("cyan");
    expect(await centreColour(props, 75)).toBe("cyan");
    expect(await centreColour(props, 89)).toBe("cyan");
  }, 300_000);
});
