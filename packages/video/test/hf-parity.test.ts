// The Reel picture on HyperFrames (Theme Engine v2, step 2a): the same plan drawn by the current renderer and by
// HyperFrames, without the words, frame by frame the same picture: clips (offset, 0.75x, a held last frame),
// a photo with its Ken Burns move and a dissolve into it, a dip to black, the loop ending (the first shot's
// opening fading in), the warm grade, the soft vignette, the readability band.
// Needs FFmpeg, a browser for HyperFrames (`pnpm hf:setup`) and one for Remotion (REMOTION_BROWSER_EXECUTABLE
// or its own download): skipped without them.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ffmpegBin, REPO_ROOT } from "@lyric/db";

import { SIMPLE_STYLE, type LyricVideoProps } from "../src";
import { compareVideos, parityPasses, parityProps, parityText, renderLyricVideo, renderWithHyperframes } from "../src/node";

const hfBrowser = !!process.env.HYPERFRAMES_BROWSER_PATH || existsSync(path.join(REPO_ROOT, ".cache", "hyperframes", "browser-path.txt"));
const remotionCache = path.join(REPO_ROOT, "packages", "video", "node_modules", ".remotion", "chrome-headless-shell");
const remotionBrowser = !!process.env.REMOTION_BROWSER_EXECUTABLE || (existsSync(remotionCache) && readdirSync(remotionCache).some((f) => !f.endsWith(".lock")));

describe.skipIf(!hfBrowser || !remotionBrowser)("the Reel picture: HyperFrames draws what the current renderer draws", () => {
  it("clips, a photo with Ken Burns, a dissolve, a dip, the loop ending, grade, vignette, band", async () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "hf-parity-"));
    const ff = ffmpegBin();
    mkdirSync(path.join(ws, "clips"), { recursive: true });
    const clip = (name: string, src: string) => execFileSync(ff, ["-y", "-v", "error", "-f", "lavfi", "-i", `${src}=size=1080x1920:rate=30:duration=10${src === "rgbtestsrc" ? "" : ""}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", "30", "-pix_fmt", "yuv420p", path.join(ws, "clips", name)]);
    clip("a.mp4", "testsrc2");
    clip("b.mp4", "rgbtestsrc");
    execFileSync(ff, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=1", "-frames:v", "1", path.join(ws, "clips", "p.jpg")]);
    const v = (start: number, duration: number, src: string, clipStartFrame: number, playbackRate = 1, extra: object = {}) => ({ start, duration, src, clipStartFrame, clipDurationFrames: 300, playbackRate, holdLastFrame: clipStartFrame + duration * playbackRate > 300, ...extra });
    const props: Omit<LyricVideoProps, "mediaBaseUrl"> = parityProps({
      audio: null,
      durationInFrames: 240,
      cutFrames: [60, 120, 200],
      shots: [
        v(0, 60, "clips/a.mp4", 40),
        v(60, 60, "clips/p.jpg", 0, 1, { kind: "photo", clipDurationFrames: 1, holdLastFrame: false, motion: { fromZoom: 1.01, toZoom: 1.11, fromX: 0.02, fromY: -0.01, toX: -0.03, toY: 0.02 }, dissolve: { before: 8, after: 8 } }),
        v(120, 80, "clips/b.mp4", 250, 0.75), // runs out: its last frame held
        v(200, 40, "clips/a.mp4", 200),
      ],
      dips: [{ frame: 200, frames: 10 }],
      loopInto: { frames: 8 },
      lyrics: [{ text: "Hold on", startFrame: 0, endFrame: 240 }],
      lyricBacking: true,
      style: SIMPLE_STYLE,
      fonts: [],
      textSize: 64,
      colour: "#ffffff",
      cinematicBars: false,
      picture: { grade: "warm", vignette: "soft", backing: "none", fallback: "gradient", fallbackColour: "#101014", accent: "#E8A3B5" },
    });
    const media = { workspaceDir: ws };
    const r = path.join(ws, "r.mp4");
    const h = path.join(ws, "h.mp4");
    await renderLyricVideo({ props, media, outFile: r, videoBitrate: "20M", log: () => {} });
    await renderWithHyperframes({ props, media, outFile: h, workDir: path.join(ws, "hf"), encoder: { bitrate: "20M" } });
    const p = await compareVideos(r, h, ff, path.join(ws, "cmp"));
    console.log(`picture check: ${parityText(p)}`);
    expect(p.frames).toBe(240);
    expect(parityPasses(p)).toBe(true);
    rmSync(ws, { recursive: true, force: true });
  }, 900_000);
});
