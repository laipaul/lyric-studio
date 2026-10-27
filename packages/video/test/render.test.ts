// Real renders of the LyricVideo composition (headless Chrome via Remotion). Clips are solid colours
// so every frame's content can be checked exactly.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, ffprobeBin } from "@lyric/db";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COMPOSITION_ID,
  DEFAULT_LYRIC_AREA,
  DEFAULT_SAFE_ZONE,
  VIDEO,
  assignClips,
  composeProps,
  getCutPoints,
  type LyricVideoProps,
  type ShotProps,
} from "../src";
import { endScreenLayout, lyricArea } from "../src";
import {
  bundledFontDirs,
  fontFileRefs,
  getBundle,
  compareAudio,
  isFaststart,
  layoutWithFace,
  loadFontCatalog,
  loadPresets,
  loopCheck,
  renderLyricVideo,
  renderThumbnail,
  youtubeLyricSafeZone,
  resolveFace,
  startMediaServer,
  type MediaServer,
} from "../src/node";
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

const catalog = loadFontCatalog(dir);
const presets = loadPresets();
const SIMPLE = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
const BOLD = { name: "Bold", font: "Montserrat", weight: 900, textCase: "upper" as const, effect: "shadow", animation: "pop" };
const fontsFor = (...faces: [string, number][]) => faces.flatMap(([family, weight]) => fontFileRefs(resolveFace(catalog, family, weight)));

const baseProps = (over: Partial<LyricVideoProps>): LyricVideoProps => ({
  mediaBaseUrl: server.url,
  fonts: fontsFor(["Inter", 600], ["Montserrat", 900]),
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
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=108x192:r=30:d=6", "-c:v", "libx264", "-g", "1", "-pix_fmt", "yuv420p", path.join(dir, "moving.mp4"));
  solidClip("yellow-then-cyan.mp4", [["yellow", 0.5], ["cyan", 0.5]]); // 1 s, ends cyan
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=48000", "-ac", "2", path.join(dir, "tone.wav"));
  server = await startMediaServer({ workspaceDir: dir, fontDirs: bundledFontDirs() });
  serveUrl = await getBundle();
  browser = await openBrowser("chrome", { browserExecutable, logLevel: "error" });
}, 300_000);

afterAll(async () => {
  await browser?.close({ silent: true });
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("LyricVideo render", () => {
  it("renders a 3-second sample as 1080x1920 30 fps H.264 / AAC 320k / yuv420p / faststart; the audio is the song itself", async () => {
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
      videoCacheBytes: 256 * 2 ** 20, // capped clip cache (as pnpm make sets it)
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
    expect(Number(audio.bit_rate)).toBeGreaterThan(280_000);
    expect(Number(audio.bit_rate)).toBeLessThanOrEqual(330_000);
    expect(Number(audio.sample_rate)).toBe(48_000); // without a sampleRate: Remotion's default (pnpm make passes the master's own)
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
    // QA "Audio matches the song": the same section of tone.wav (from frame 15 = 0.5 s), same level.
    const match = await compareAudio(out, path.join(dir, "tone.wav"), { startMs: 500, endMs: 3_500 }, { fadeInS: 0.3, fadeOutS: 0.5 });
    expect(Math.abs(match.actualS - match.expectedS)).toBeLessThan(0.1);
    expect(Math.abs(match.levelDiffDb)).toBeLessThan(0.5);
  }, 300_000);

  it("a render that makes no progress is stopped by the watchdog (no partial file left)", async () => {
    const out = path.join(dir, "stalled.mp4");
    await expect(
      renderLyricVideo({
        props: { ...baseProps({}), shots: [shot({ src: "red.mp4", start: 0, duration: 90 })], cutFrames: [] },
        media: { workspaceDir: dir },
        outFile: out,
        stallTimeoutMs: 1, // no progress within 1 ms: stopped at once
      }),
    ).rejects.toThrow(/made no progress .* and was stopped/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.part.mp4`)).toBe(false);
  });

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


  // Renders `text` and checks: inside the safe zone and the lyric area, centred around 62.5% of the
  // height, and exactly as many lines as the Node-side layout predicts.
  async function checkLongLine(text: string, style: typeof SIMPLE | typeof BOLD, textSize: number, expectedLines: number) {
    const layout = layoutWithFace(text, resolveFace(catalog, style.font, style.weight), style.textCase, textSize);
    expect(layout.lines).toHaveLength(expectedLines);
    const props = baseProps({ colour: "#ff00ff", style, textSize, lyrics: [{ text, startFrame: 0, endFrame: 90 }] });
    const box = (await magentaBox(props, 30))!;
    expect(box).not.toBeNull();
    expect(box.maxX).toBeLessThan(VIDEO.width * (1 - DEFAULT_SAFE_ZONE.right));
    expect(box.maxY).toBeLessThan(VIDEO.height * (1 - DEFAULT_SAFE_ZONE.bottom));
    expect(box.minX).toBeGreaterThanOrEqual(DEFAULT_LYRIC_AREA.left - 2);
    expect(box.maxX).toBeLessThanOrEqual(DEFAULT_LYRIC_AREA.right + 2);
    expect(Math.abs((box.minY + box.maxY) / 2 - DEFAULT_LYRIC_AREA.centerY)).toBeLessThan(40);
    // Height of the text block matches the number of lines at the chosen font size.
    const lineHeight = DEFAULT_LYRIC_AREA.lineHeight * layout.fontSize;
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

  it("shows a line 0.25 s (8 frames) before its stamp with the default lead", async () => {
    // Stamp at 2.0 s into a section starting at 0.5 s: composition frame 45; lead 0.25 s -> frame 38.
    const plan = getCutPoints(grid(120, 8, 500), { start_ms: 500, end_ms: 4_500 }, { cutRate: "1x" });
    const base = {
      plan,
      clips: [{ id: "black", name: "black.mp4", duration_ms: 5_000, path: "none.mp4", durationFrames: 150 }],
      audio: null,
      durationInFrames: plan.end_frame - plan.start_frame,
      lyrics: [{ text: "On the beat", start_ms: 2_500, end_ms: 4_000, isHook: false }],
      styles: {
        simple: { style: SIMPLE, textSize: 64, hookFont: null, fonts: fontsFor(["Inter", 600]) },
        bold: { style: BOLD, textSize: 72, hookFont: null, fonts: fontsFor(["Montserrat", 900]) },
      },
      colour: "#ff00ff",
      cinematicBars: false,
      pins: [],
    };
    const { props } = composeProps(base, { seed: 1, style: "simple" });
    const first = Math.round((2_250 * 30) / 1000) - plan.start_frame;
    expect(props.lyrics[0].startFrame).toBe(first);
    const withMedia = { ...props, shots: [], mediaBaseUrl: server.url };
    expect(await magentaBox(withMedia, first - 1)).toBeNull();
    expect(await magentaBox(withMedia, first)).not.toBeNull();
  }, 300_000);

  it("draws lyrics in a user font and hook lines in the hook font", async () => {
    // A user font in WORKSPACE_DIR\fonts (a copy of Bebas Neue under another name), used for hooks.
    mkdirSync(path.join(dir, "fonts"), { recursive: true });
    copyFileSync(path.join(bundledFontDirs()["bebas-neue"], "bebas-neue-latin-400-normal.woff2"), path.join(dir, "fonts", "MyPoster.woff2"));
    const userCatalog = loadFontCatalog(dir);
    const hookFace = resolveFace(userCatalog, "Bebas Neue", 600);
    expect(userCatalog.families.find((f) => f.source === "user")?.family).toBe("Bebas Neue");
    const props = baseProps({
      colour: "#ff00ff",
      fonts: [...fontsFor(["Inter", 600]), ...fontFileRefs(hookFace)],
      hookFont: { font: hookFace.family, weight: hookFace.weight },
      lyrics: [
        { text: "Same words here", startFrame: 0, endFrame: 30 },
        { text: "Same words here", startFrame: 30, endFrame: 60, isHook: true },
      ],
    });
    const normal = (await magentaBox(props, 10))!;
    const hook = (await magentaBox(props, 40))!;
    // Bebas Neue is a condensed capitals font: much narrower and different from Inter.
    expect(hook.maxX - hook.minX).toBeLessThan((normal.maxX - normal.minX) * 0.85);
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

  it("photo shot: the Ken Burns move changes the picture over the shot and never shows an edge", async () => {
    // Left half red, right half blue, 1080x1920.
    ffmpeg("-f", "lavfi", "-i", "color=c=red:s=540x1920", "-f", "lavfi", "-i", "color=c=blue:s=540x1920", "-filter_complex", "[0:v][1:v]hstack=inputs=2", "-frames:v", "1", path.join(dir, "halves.jpg"));
    const motion = { fromZoom: 1, toZoom: 1.12, fromX: 0, fromY: 0, toX: 0.05, toY: 0 };
    const props = baseProps({ shots: [shot({ src: "halves.jpg", start: 0, duration: 90, kind: "photo", motion })] });
    const redInRow = async (frame: number) => {
      const { raw } = await frameRegion(props, frame, { x: 0, y: 960, w: 1080, h: 1 });
      let red = 0;
      for (let i = 0; i < raw.length; i += 3) if (raw[i] > 150 && raw[i + 2] < 100) red += 1;
      return red;
    };
    const atStart = await redInRow(0);
    const atEnd = await redInRow(89);
    expect(Math.abs(atStart - 540)).toBeLessThan(6); // no zoom at the start: the boundary is in the middle
    expect(atEnd - atStart).toBeGreaterThan(40); // zoomed in and panned right: more red
    for (const frame of [0, 45, 89]) {
      for (const [x, y] of [[0, 0], [1076, 0], [0, 1916], [1076, 1916]]) {
        const { raw } = await frameRegion(props, frame, { x, y, w: 4, h: 4 });
        expect(Math.max(raw[0], raw[2]), `corner ${x},${y} at frame ${frame}`).toBeGreaterThan(150); // red or blue, never black
      }
    }
  }, 300_000);

  it("fill: a horizontal source is shown whole over a blurred copy instead of black bars", async () => {
    ffmpeg("-f", "lavfi", "-i", "color=c=lime:s=384x216:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "wide-lime.mp4"));
    const props = baseProps({ shots: [shot({ src: "wide-lime.mp4", start: 0, duration: 90, fit: "fill" })] });
    const { raw: middle } = await frameRegion(props, 30, { x: 520, y: 940, w: 40, h: 40 });
    expect(middle[1]).toBeGreaterThan(200); // the picture itself, full brightness
    const { raw: top } = await frameRegion(props, 30, { x: 520, y: 100, w: 40, h: 40 });
    expect(top[1]).toBeGreaterThan(60); // the blurred, darkened copy above it - not black
    expect(top[1]).toBeLessThan(middle[1]);
  }, 300_000);

  it("renders at the size the platform preset asks for", async () => {
    const out = path.join(dir, "small.mp4");
    await renderLyricVideo({
      props: { ...baseProps({ shots: [shot({ src: "red.mp4", start: 0, duration: 30 })], durationInFrames: 30 }), format: { width: 540, height: 960 } },
      media: { workspaceDir: dir },
      outFile: out,
      videoBitrate: "4M",
    });
    const probe = JSON.parse(execFileSync(ffprobeBin(), ["-v", "error", "-print_format", "json", "-show_streams", out]).toString());
    expect([probe.streams[0].width, probe.streams[0].height]).toEqual([540, 960]);
  }, 300_000);

  it("Spotify Canvas: the loop's last frame blends into its first, with no audio stream", async () => {
    // 3 s loop from 1.5 s into a moving clip; the last 0.5 s fades in the 0.5 s before the start.
    const loop = (blend: boolean) =>
      baseProps({
        durationInFrames: 90,
        shots: [shot({ src: "moving.mp4", start: 0, duration: 90, clipStartFrame: 45, clipDurationFrames: 180, ...(blend ? { loopBlend: { frames: 15, fromClipFrame: 30 } } : {}) })],
      });
    const blended = path.join(dir, "canvas.mp4");
    const plain = path.join(dir, "canvas-plain.mp4");
    await renderLyricVideo({ props: loop(true), media: { workspaceDir: dir }, outFile: blended });
    await renderLyricVideo({ props: loop(false), media: { workspaceDir: dir }, outFile: plain });
    const a = await loopCheck(blended);
    const b = await loopCheck(plain);
    expect(a.hasAudio).toBe(false);
    expect(a.seconds).toBeCloseTo(3, 1);
    expect(a.lastToFirst).toBeLessThanOrEqual(Math.max(6, 2.5 * a.typicalStep)); // the QA "Seamless loop" limit
    expect(b.lastToFirst).toBeGreaterThan(a.lastToFirst * 3); // without the blend the jump is obvious
    // Slowed down (fallback 2, 0.7x): the blend frames are taken at the same speed, still seamless.
    const slowed = path.join(dir, "canvas-slow.mp4");
    const rate = 0.7;
    const blendClip = Math.round(15 * rate);
    await renderLyricVideo({
      props: baseProps({ durationInFrames: 90, shots: [shot({ src: "moving.mp4", start: 0, duration: 90, clipStartFrame: 20 + blendClip, clipDurationFrames: 180, playbackRate: rate, loopBlend: { frames: 15, fromClipFrame: 20 } })] }),
      media: { workspaceDir: dir },
      outFile: slowed,
    });
    const c = await loopCheck(slowed);
    expect(c.lastToFirst).toBeLessThanOrEqual(Math.max(6, 2.5 * c.typicalStep));
  }, 300_000);

  it("lyric effects: glide moves the text smoothly frame by frame (no jumps), deterministic; karaoke uses the accent", async () => {
    // Three lines 2 s apart on black; line 2 is a hook (karaoke-highlight) with word timings.
    const words = (stamp: number, ws: string[]) => ws.map((text, k) => ({ text, startFrame: stamp + 8 * k, endFrame: stamp + 8 * (k + 1) }));
    const props = baseProps({
      colour: "#ff00ff",
      durationInFrames: 200,
      nextLine: true,
      lyricEffects: { verse: { name: "glide", intensity: "balanced" }, hook: { name: "karaoke-highlight", intensity: "balanced" }, accent: "#00ff00" },
      lyrics: [
        { text: "First line here", startFrame: 20, endFrame: 80, stampFrame: 28, words: words(28, ["First", "line", "here"]) },
        { text: "Hold on", startFrame: 80, endFrame: 140, stampFrame: 88, isHook: true, words: words(88, ["Hold", "on"]) },
        { text: "Third line", startFrame: 140, endFrame: 200, stampFrame: 148, words: words(148, ["Third", "line"]) },
      ],
    });
    // Lyric "mass" on black: total brightness of the magenta text and its brightness-weighted mean
    // height (both change continuously while lines fade and move; a jump would show as a step).
    const mass = async (frame: number) => {
      const { raw, w, h } = await frameRegion(props, frame, { x: 0, y: 500, w: 1080, h: 900 });
      let n = 0, sy = 0, green = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 3;
        n += raw[i];
        sy += raw[i] * y;
        if (raw[i + 1] > 120 && raw[i] < 90 && raw[i + 2] < 90) green++;
      }
      return { n, y: n ? sy / n : 0, green };
    };
    const samples = [];
    for (let f = 62; f <= 82; f++) samples.push(await mass(f)); // the glide into line 2 (settled at 80)
    for (let k = 1; k < samples.length; k++) {
      expect(Math.abs(samples[k].y - samples[k - 1].y), `frame ${62 + k} height`).toBeLessThan(25); // moves, never jumps
      expect(Math.abs(samples[k].n - samples[k - 1].n) / samples[0].n, `frame ${62 + k} brightness`).toBeLessThan(0.3); // fades, never pops
      expect(samples[k].n, `frame ${62 + k}`).toBeGreaterThan(0); // never a blank frame mid-transition
    }
    // Karaoke: the word being sung ("Hold", frames 88-96) is in the accent colour.
    expect((await mass(90)).green).toBeGreaterThan(50);
    expect((await mass(84)).green).toBeLessThan(5);
    // Deterministic: the same frame twice is pixel-identical.
    const a = await frameRegion(props, 70);
    const b = await frameRegion(props, 70);
    expect(Buffer.compare(a.raw, b.raw)).toBe(0);
  }, 300_000);

  // ---- YouTube (16:9) ------------------------------------------------------------------------
  const YT = { width: 1920, height: 1080 };
  async function ytPixels(props: LyricVideoProps, frame: number) {
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props, puppeteerInstance: browser, logLevel: "error" });
    expect([composition.width, composition.height]).toEqual([1920, 1080]);
    const file = path.join(dir, `yt-${Math.random().toString(36).slice(2)}.png`);
    await renderStill({ serveUrl, composition, frame, output: file, inputProps: props, puppeteerInstance: browser, logLevel: "error" });
    const raw = execFileSync(ffmpegBin(), ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
    rmSync(file);
    const at = (x: number, y: number) => [0, 1, 2].map((c) => raw[(y * 1920 + x) * 3 + c]);
    let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (let y = 0; y < 1080; y += 2) {
      for (let x = 0; x < 1920; x += 2) {
        const [r, g, b] = at(x, y);
        if (r > 150 && b > 150 && g < 60) box = box ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) } : { minX: x, minY: y, maxX: x, maxY: y };
      }
    }
    return { at, magenta: box };
  }
  const ytBase = (over: Partial<LyricVideoProps>): LyricVideoProps =>
    baseProps({
      format: YT,
      colour: "#ff00ff",
      durationInFrames: 90,
      lyrics: [{ text: "Hold on to me", startFrame: 0, endFrame: 90 }],
      ...over,
    });

  it("YouTube cover layout: the cover in the left part, lyrics on the right; end screen: lyrics above the bottom-right area", async () => {
    ffmpeg("-f", "lavfi", "-i", "color=c=yellow:s=800x800", "-frames:v", "1", path.join(dir, "cover.jpg"));
    ffmpeg("-f", "lavfi", "-i", "color=c=lime:s=300x120", "-frames:v", "1", path.join(dir, "logo.png"));
    const area = lyricArea(YT, youtubeLyricSafeZone("cover", presets.youtube.safeZone), 0.45);
    const props = ytBase({
      layout: "cover",
      cover: { src: "cover.jpg", zoomFrom: 1, zoomTo: 1.05 },
      lyricArea: area,
      logo: { src: "logo.png", left: 58, top: 1080 - 58 - 62, width: 154, height: 62, goneAt: null },
    });
    const { at, magenta } = await ytPixels(props, 10);
    const [r, g, b] = at(Math.round(1920 * 0.22), 540); // centre of the cover
    expect(r > 200 && g > 200 && b < 80).toBe(true);
    expect(magenta!.minX).toBeGreaterThan(1920 * 0.43); // lyrics right of the cover
    const [lr, lg, lb] = at(70, 1080 - 70); // logo, bottom left
    expect(lg > 200 && lr < 80 && lb < 80).toBe(true);

    const end = endScreenLayout(YT, { ...presets.youtube.safeZone, top: 0.14 }, area, 30, 90, { seconds: 3, clear: { left: 0.5, top: 0.35 } });
    const late = await ytPixels({ ...props, endScreen: end }, 10);
    expect(late.magenta!.maxY).toBeLessThan(end.clear.top); // out of the end-screen area
    expect(late.magenta!.minY).toBeGreaterThan(1080 * 0.14); // below the title at the top
  }, 300_000);

  it("YouTube stills layout: crossfade between two pictures, grain and glow render", async () => {
    ffmpeg("-f", "lavfi", "-i", "color=c=red:s=1600x900", "-frames:v", "1", path.join(dir, "still-red.jpg"));
    ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=1600x900", "-frames:v", "1", path.join(dir, "still-blue.jpg"));
    const props = ytBase({
      layout: "stills",
      stills: [
        { src: "still-red.jpg", startFrame: 0, endFrame: 60, fadeFrames: 30, section: "verse 1" },
        { src: "still-blue.jpg", startFrame: 30, endFrame: 90, fadeFrames: 30, section: "chorus 1" },
      ],
      lyrics: [],
      grain: true,
      glow: { colour: "#E8A3B5", beatFrames: [0, 15, 30] },
    });
    const before = (await ytPixels(props, 20)).at(960, 540);
    const middle = (await ytPixels(props, 45)).at(960, 540);
    const after = (await ytPixels(props, 75)).at(960, 540);
    expect(before[0]).toBeGreaterThan(180);
    expect(after[2]).toBeGreaterThan(180);
    // Mid-crossfade: blue fading in over a still fully visible red, so no dark dip.
    expect(middle[0]).toBeGreaterThan(90);
    expect(middle[2]).toBeGreaterThan(90);
    expect(middle[0] + middle[2]).toBeGreaterThan(230);
  }, 300_000);

  it("YouTube thumbnail: 1280x720 JPEG with the title in the accent colour", async () => {
    const out = path.join(dir, "thumbnail.jpg");
    await renderThumbnail({
      props: {
        background: "cover.jpg",
        title: "Hold On",
        artist: "Life Lyrics",
        font: { family: "Cinzel", weight: 700, letterSpacing: 0.18 },
        colour: "#ff00ff",
        fonts: fontFileRefs(resolveFace(catalog, "Cinzel", 700)),
        logo: null,
      },
      media: { workspaceDir: dir },
      outFile: out,
    });
    const probe = JSON.parse(execFileSync(ffprobeBin(), ["-v", "error", "-print_format", "json", "-show_streams", out]).toString());
    expect([probe.streams[0].codec_name, probe.streams[0].width, probe.streams[0].height]).toEqual(["mjpeg", 1280, 720]);
    const raw = execFileSync(ffmpegBin(), ["-v", "error", "-i", out, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
    let accent = 0;
    for (let i = 0; i < raw.length; i += 3) if (raw[i] > 170 && raw[i + 2] > 170 && raw[i + 1] < 90) accent += 1;
    expect(accent).toBeGreaterThan(2000); // the title's letters
  }, 300_000);

  it("YouTube 5g.2b: cover drift with opposite background parallax, mood veil per section, logo fading out", async () => {
    // Background: black left of x=1600, white right of it (to see it move).
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=1600x1080", "-f", "lavfi", "-i", "color=c=white:s=320x1080", "-filter_complex", "[0:v][1:v]hstack=inputs=2", "-frames:v", "1", path.join(dir, "edge-bg.png"));
    const props = ytBase({
      layout: "cover",
      lyrics: [],
      cover: { src: "cover.jpg", zoomFrom: 1, zoomTo: 1, backgroundSrc: "edge-bg.png", drift: { fromX: -20, fromY: 0, toX: 20, toY: 0 }, parallax: 0.3 },
      logo: { src: "logo.png", left: 1700, top: 960, width: 154, height: 62, goneAt: 60 },
      mood: [{ startFrame: -1_000_000, kind: "verse" }, { startFrame: 45, kind: "hook" }],
    });
    const rowEdge = (at: (x: number, y: number) => number[], from: number, to: number, y: number, test: (p: number[]) => boolean) => {
      for (let x = from; x < to; x++) if (test(at(x, y))) return x;
      return -1;
    };
    const start = await ytPixels(props, 0);
    const end = await ytPixels(props, 89);
    const yellow = (p: number[]) => p[0] > 180 && p[1] > 180 && p[2] < 90;
    const bright = (p: number[]) => p[0] > 120;
    const coverStart = rowEdge(start.at, 0, 400, 540, yellow);
    const coverEnd = rowEdge(end.at, 0, 400, 540, yellow);
    const bgStart = rowEdge(start.at, 1500, 1700, 300, bright);
    const bgEnd = rowEdge(end.at, 1500, 1700, 300, bright);
    expect(coverEnd - coverStart).toBeGreaterThan(30); // the cover drifted right (~40 px)
    expect(bgStart - bgEnd).toBeGreaterThan(8); // the background moved left (~12 px) ...
    expect(bgStart - bgEnd).toBeLessThan(18); // ... about 30% as much
    // Mood: the hook veil (warm, light) is brighter than the verse veil on the same background.
    const verse = (await ytPixels(props, 5)).at(800, 200);
    const hook = (await ytPixels(props, 85)).at(800, 200);
    expect(hook[0]).toBeGreaterThan(verse[0] + 15);
    expect(hook[0]).toBeGreaterThan(hook[2]); // warm
    // Logo: visible early, gone at goneAt.
    const logoEarly = (await ytPixels(props, 10)).at(1777, 990);
    const logoLate = (await ytPixels(props, 60)).at(1777, 990);
    // The lime logo (low red) over the white part of the background (high red once it is gone).
    expect(logoEarly[1]).toBeGreaterThan(150);
    expect(logoEarly[0]).toBeLessThan(90);
    expect(logoLate[0]).toBeGreaterThan(200);
  }, 300_000);
});
