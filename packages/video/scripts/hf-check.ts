// The HyperFrames renderer's own check (Theme Engine v2 step 1), run by test/hf-network.test.ts under strace
// (every network connection of every process recorded) and usable by hand:
//   pnpm exec tsx packages/video/scripts/hf-check.ts <work folder>
// Renders the frame-accuracy plan (a numbered clip trimmed, slowed, jumping back, running out) with HyperFrames,
// plus a lyric line in a bundled font, and prints the result as JSON (last line).
import { mkdirSync } from "node:fs";
import path from "node:path";

import { ffmpegBin } from "@lyric/db";

import { checkFrames, fontFileRefs, forText, frameTestProps, loadFontCatalog, makeNumberedClip, readFrameNumbers, renderWithHyperframes, resolveFace } from "../src/node";

const work = path.resolve(process.argv[2] ?? "hf-check");
mkdirSync(work, { recursive: true });
const ffmpeg = ffmpegBin();
await makeNumberedClip(path.join(work, "clips", "numbered.mp4"), ffmpeg);
const base = frameTestProps("clips/numbered.mp4");
// A lyric line with the Reel's effects (the text layer: React and the shared text code, bundled locally) and a
// title card with a Japanese tagline, so the fonts are part of the check (only our own files may be used).
const cat = loadFontCatalog(work);
const tagline = "ここにいるよ";
const props = {
  ...base,
  style: { ...base.style, font: "Cormorant Garamond", weight: 400 },
  fonts: [{ family: "Cormorant Garamond", weight: 400, style: "normal" as const, src: "_fonts/cormorant-garamond-latin-400-normal.woff2" }, ...fontFileRefs(forText(resolveFace(cat, "Noto Sans JP", 400), tagline))],
  lyricEffects: { verse: { name: "typewriter", intensity: "balanced" as const }, hook: { name: "karaoke-highlight", intensity: "balanced" as const }, accent: "#E8A3B5" },
  textCards: [{ id: "tagline", type: "tagline" as const, text: tagline, font: "Cormorant Garamond", fallbackFont: "Noto Sans JP", weight: 400, size: 48, colour: "#ffffff", letterSpacing: 0, upper: false, startFrame: 0, endFrame: 60, centerY: 1500 }],
  textSize: 72,
  lyrics: [{ text: "Hold on to me", startFrame: 20, endFrame: 200, words: [{ text: "Hold", startFrame: 30, endFrame: 45 }, { text: "on", startFrame: 50, endFrame: 60 }, { text: "to", startFrame: 62, endFrame: 70 }, { text: "me", startFrame: 75, endFrame: 120 }] }],
  lyricArea: { left: 80, right: 1000, top: 600, bottom: 1500, centerY: 1100, minScale: 0.75, lineHeight: 1.15 },
};
const file = path.join(work, "all.mp4");
const timings: Record<string, number> = {};
await renderWithHyperframes({ props, media: { workspaceDir: work }, outFile: file, workDir: path.join(work, "work-all"), timings });
console.log(JSON.stringify({ file, timings, accuracy: checkFrames(await readFrameNumbers(file, ffmpeg)) }));
