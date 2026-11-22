// Node side of the QA checks: measures each lyric line with the real font files, and looks for
// black or frozen frames in the finished MP4 with FFmpeg (frames sampled 10 times per second).
import { execFile } from "node:child_process";

import { ffmpegBin } from "@lyric/db";

import { effectExtents, motionKind, restWidth } from "../effects/scene";
import { parseFrameDetect, lyricBox, type QaLyric, type TimeRange } from "../qa";
import { lyricCenterY, type LyricArea } from "../platform";
import type { LyricEffectsProps, LyricLineProps, TextCase } from "../props";
import type { FontFaceInfo } from "./font-catalog";
import { faceMeasure, inkOverflow, layoutWithFace } from "./measure";
import { lineScale } from "../text-layout";
import { breathsOf } from "../line-shape";
import { applyTextCase } from "../lyrics";

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
  const areaOf = (l: LyricLineProps) => (fonts.area && l.card?.centerY !== undefined ? { ...fonts.area, centerY: l.card.centerY, anchor: undefined } : fonts.area);
  const measured = lyrics.map((l) => {
    const face = l.card?.font && fonts.cardFace ? fonts.cardFace(l.card.font) : l.isHook && fonts.hook ? fonts.hook : fonts.main;
    // The same rest width as the render (LyricScene): room for the effect to grow inside the area.
    const a = areaOf(l);
    const fx = fonts.effects;
    const fitted = fx && a ? { ...a, right: a.left + restWidth(a.right - a.left, effectExtents(l.card?.effect ?? (l.isHook ? fx.hook : fx.verse), fx.verse, 30, fx.breathe, !!fx.chorusLift && !!l.isHook)) } : a;
    // The same rows as the render: the theme's stacked shape with the line's breaths (src/line-shape.ts).
    const shape = fx?.lineShape === "stacked" ? { shape: "stacked" as const, breaths: breathsOf(l.words, applyTextCase(l.text, fonts.textCase).trim().split(/\s+/).length, 30) } : undefined;
    const layout = layoutWithFace(l.text, face, fonts.textCase, Math.round(fonts.textSize * lineScale(l, fonts.effects?.hookScale)), fitted, shape);
    const measure = faceMeasure(face);
    const widest = Math.max(...layout.lines.map((line) => measure(line, layout.fontSize)));
    return { l, layout, widest, face };
  });
  return measured.map(({ l, layout, widest, face }, k) => {
    const area = areaOf(l);
    // The next line waiting small underneath (glide) shares the screen with this one; a bottom-anchored area
    // ("lower") keeps it above the area's bottom too, so this line sits higher (the same rule as LyricScene).
    const next = measured[k + 1];
    const glides = (c: LyricEffectsProps["verse"]) => motionKind(c, fonts.effects!.verse) === "glide";
    const own0 = fonts.effects ? (l.card?.effect ?? (l.isHook ? fonts.effects.hook : fonts.effects.verse)) : null;
    const waits = !!(fonts.effects && fonts.nextLine && next && own0 && next.l.startFrame - l.endFrame < 30 && next.l.card?.centerY === l.card?.centerY && glides(own0) && glides(next.l.card?.effect ?? (next.l.isHook ? fonts.effects.hook : fonts.effects.verse)));
    const s = fonts.nextScale ?? 0.55;
    const lh = fonts.area?.lineHeight ?? 1.15;
    const gap = fonts.textSize * 0.35;
    const nextHeight = waits && next ? next.layout.lines.length * next.layout.fontSize * lh * s : 0;
    const below = waits ? gap + nextHeight : 0;
    let box = lyricBox(layout.lines.length, layout.fontSize, widest, fonts.animation === "pop" && !fonts.effects ? POP_MAX_SCALE : 1, area, below);
    if (fonts.effects) {
      const own = l.card?.effect ?? (l.isHook ? fonts.effects.hook : fonts.effects.verse);
      const ext = effectExtents(own, fonts.effects.verse, 30, fonts.effects.breathe, !!fonts.effects.chorusLift && !!l.isHook);
      const grown = lyricBox(layout.lines.length, layout.fontSize, widest, ext.maxScale, area, below);
      box = { left: grown.left - ext.side, right: grown.right + ext.side, top: grown.top - ext.up, bottom: grown.bottom + ext.down };
      if (waits && next) {
        const height = layout.lines.length * layout.fontSize * lh;
        const cx = (box.left + box.right) / 2;
        const top = (area ? lyricCenterY(area, height, below) : box.top) + height / 2 + gap;
        box = {
          left: Math.min(box.left, cx - (next.widest * s) / 2),
          right: Math.max(box.right, cx + (next.widest * s) / 2),
          top: box.top,
          bottom: Math.max(box.bottom, top + nextHeight),
        };
      }
    }
    // The glyphs' own reach beyond the line box (script fonts): what is drawn, not just where the rows sit.
    const ink = inkOverflow(face, layout.lines, layout.fontSize, (area ?? fonts.area)?.lineHeight ?? 1.15);
    box = { ...box, top: box.top - ink.up, bottom: box.bottom + ink.down };
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

// Where the lyric lines of the title opening's window are drawn (the first line, and any further line that
// comes in before `untilFrame`), as ONE box: the composition's own place for each line (lyric area, text
// layout, the line's card place and size, effect reach, the waiting next line, the glyphs' ink), measured by
// measureLyrics, the same function QA uses, so the plan, the check and the picture cannot disagree.
export function titleWindowBox(
  lyrics: readonly LyricLineProps[],
  untilFrame: number,
  fonts: Omit<Parameters<typeof measureLyrics>[1], "nextLine">,
  nextLine: boolean,
): { left: number; top: number; right: number; bottom: number } | null {
  const shown = lyrics.filter((l, i) => i === 0 || (l.enterFrame ?? l.startFrame) < untilFrame);
  if (!shown.length) return null;
  const upTo = lyrics.indexOf(shown[shown.length - 1]);
  const boxes = measureLyrics(lyrics.slice(0, upTo + 1).map((l, i) => ({ ...l, number: i + 1, confidence: null })), { ...fonts, nextLine }).map((m) => m.box);
  return boxes.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }));
}
