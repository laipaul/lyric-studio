// Node side of the QA checks: measures each lyric line with the real font files, and looks for
// black or frozen frames in the finished MP4 with FFmpeg (frames sampled 10 times per second).
import { execFile } from "node:child_process";

import { ffmpegBin } from "@lyric/db";

import { effectExtents, motionKind } from "../effects/scene";
import { parseFrameDetect, lyricBox, type QaLyric, type TimeRange } from "../qa";
import type { LyricArea } from "../platform";
import type { LyricEffectsProps, LyricLineProps, TextCase } from "../props";
import type { FontFaceInfo } from "./font-catalog";
import { faceMeasure, layoutWithFace } from "./measure";

export const POP_MAX_SCALE = 1.02; // the pop animation's spring overshoots the final size slightly

export function measureLyrics(
  lyrics: readonly (LyricLineProps & { number: number; confidence: number | null })[],
  fonts: {
    main: FontFaceInfo;
    hook: FontFaceInfo | null;
    textCase: TextCase;
    textSize: number;
    animation: string;
    area?: LyricArea;
    // Step 5j: the largest place each line takes while its effect moves it, plus the next line
    // waiting underneath (glide).
    effects?: LyricEffectsProps | null;
    nextLine?: boolean;
    nextScale?: number;
    // A textboard card's own font (its face, for measuring).
    cardFace?: (font: { family: string; weight: number; italic?: boolean }) => FontFaceInfo;
  },
): QaLyric[] {
  // A textboard card: its own font, size, place and effect.
  const areaOf = (l: LyricLineProps) => (fonts.area && l.card?.centerY !== undefined ? { ...fonts.area, centerY: l.card.centerY } : fonts.area);
  const measured = lyrics.map((l) => {
    const face = l.card?.font && fonts.cardFace ? fonts.cardFace(l.card.font) : l.isHook && fonts.hook ? fonts.hook : fonts.main;
    const layout = layoutWithFace(l.text, face, fonts.textCase, Math.round(fonts.textSize * (l.card?.scale ?? 1)), areaOf(l));
    const measure = faceMeasure(face);
    const widest = Math.max(...layout.lines.map((line) => measure(line, layout.fontSize)));
    return { l, layout, widest };
  });
  return measured.map(({ l, layout, widest }, k) => {
    const area = areaOf(l);
    let box = lyricBox(layout.lines.length, layout.fontSize, widest, fonts.animation === "pop" && !fonts.effects ? POP_MAX_SCALE : 1, area);
    if (fonts.effects) {
      const own = l.card?.effect ?? (l.isHook ? fonts.effects.hook : fonts.effects.verse);
      const ext = effectExtents(own, fonts.effects.verse, 30);
      const grown = lyricBox(layout.lines.length, layout.fontSize, widest, ext.maxScale, area);
      box = { left: grown.left - ext.side, right: grown.right + ext.side, top: grown.top - ext.up, bottom: grown.bottom + ext.down };
      // The next line waiting small underneath (it shares the screen with this one).
      const next = measured[k + 1];
      const glides = (c: LyricEffectsProps["verse"]) => motionKind(c, fonts.effects!.verse) === "glide";
      if (fonts.nextLine && next && next.l.startFrame - l.endFrame < 30 && next.l.card?.centerY === l.card?.centerY && glides(own) && glides(next.l.card?.effect ?? (next.l.isHook ? fonts.effects.hook : fonts.effects.verse))) {
        const s = fonts.nextScale ?? 0.55;
        const height = layout.lines.length * layout.fontSize * (fonts.area?.lineHeight ?? 1.15);
        const nextHeight = next.layout.lines.length * next.layout.fontSize * (fonts.area?.lineHeight ?? 1.15) * s;
        const cx = (box.left + box.right) / 2;
        const top = (area?.centerY ?? box.top) + height / 2 + fonts.textSize * 0.35;
        box = {
          left: Math.min(box.left, cx - (next.widest * s) / 2),
          right: Math.max(box.right, cx + (next.widest * s) / 2),
          top: box.top,
          bottom: Math.max(box.bottom, top + nextHeight),
        };
      }
    }
    return {
      number: l.number,
      text: l.text,
      confidence: l.confidence,
      lines: layout.lines.length,
      box,
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
