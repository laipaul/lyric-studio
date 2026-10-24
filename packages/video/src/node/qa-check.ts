// Node side of the QA checks: measures each lyric line with the real font files, and looks for
// black or frozen frames in the finished MP4 with FFmpeg (frames sampled 10 times per second).
import { execFile } from "node:child_process";

import { ffmpegBin } from "@lyric/db";

import { parseFrameDetect, lyricBox, type QaLyric, type TimeRange } from "../qa";
import type { LyricArea } from "../platform";
import type { LyricLineProps, TextCase } from "../props";
import type { FontFaceInfo } from "./font-catalog";
import { faceMeasure, layoutWithFace } from "./measure";

export const POP_MAX_SCALE = 1.02; // the pop animation's spring overshoots the final size slightly

export function measureLyrics(
  lyrics: readonly (LyricLineProps & { number: number; confidence: number | null })[],
  fonts: { main: FontFaceInfo; hook: FontFaceInfo | null; textCase: TextCase; textSize: number; animation: string; area?: LyricArea },
): QaLyric[] {
  return lyrics.map((l) => {
    const face = l.isHook && fonts.hook ? fonts.hook : fonts.main;
    const layout = layoutWithFace(l.text, face, fonts.textCase, fonts.textSize, fonts.area);
    const measure = faceMeasure(face);
    const widest = Math.max(...layout.lines.map((line) => measure(line, layout.fontSize)));
    const scale = fonts.animation === "pop" ? POP_MAX_SCALE : 1;
    return {
      number: l.number,
      text: l.text,
      confidence: l.confidence,
      lines: layout.lines.length,
      box: lyricBox(layout.lines.length, layout.fontSize, widest, scale, fonts.area),
    };
  });
}

// Black: at least 98% of the picture is (nearly) black for 0.2 s or more.
// Frozen: the picture does not change for 1 s or more.
export function detectBadFrames(file: string, durationSeconds: number): Promise<{ black: TimeRange[]; frozen: TimeRange[] }> {
  const filter = "fps=10,scale=270:480,blackdetect=d=0.2:pic_th=0.98:pix_th=0.10,freezedetect=n=0.001:d=1";
  return new Promise((resolve, reject) =>
    execFile(
      ffmpegBin(),
      ["-hide_banner", "-nostats", "-v", "info", "-i", file, "-an", "-vf", filter, "-f", "null", "-"],
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 }, // never wait forever
      (error, _out, stderr) => (error ? reject(new Error(`ffmpeg frame check failed: ${stderr.trim() || error.message}`)) : resolve(parseFrameDetect(stderr, durationSeconds))),
    ),
  );
}
