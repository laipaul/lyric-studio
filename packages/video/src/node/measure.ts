// Measures lyric text in Node with the same font files the video uses, so "pnpm tap" and
// "pnpm render:test" can warn about lines that are too long before anything is rendered.
import * as fontkit from "fontkit";

import { DEFAULT_LYRIC_AREA, type LyricArea } from "../platform";
import { applyTextCase, layoutLyric, type LyricLayout, type MeasureFn } from "../lyrics";
import type { TextCase } from "../props";
import type { FontFaceInfo } from "./font-catalog";

const opened = new Map<string, fontkit.Font>();
const open = (file: string) => {
  let font = opened.get(file);
  if (!font) {
    font = fontkit.openSync(file) as fontkit.Font;
    opened.set(file, font);
  }
  return font;
};

// Width in px of `text` at `fontSize`, with kerning. Characters missing from the face's first file
// (e.g. accents outside basic Latin) are measured in its other files, as the browser does.
export function faceMeasure(face: FontFaceInfo): MeasureFn {
  const fonts = face.files.map((f) => open(f.path));
  return (text, fontSize) => {
    let units = 0;
    let run = "";
    let runFont = fonts[0];
    const flush = () => {
      if (run) units += (runFont.layout(run).advanceWidth / runFont.unitsPerEm) * 1000;
      run = "";
    };
    for (const char of text) {
      const font = fonts.find((f) => f.hasGlyphForCodePoint(char.codePointAt(0)!)) ?? fonts[0];
      if (font !== runFont) {
        flush();
        runFont = font;
      }
      run += char;
    }
    flush();
    return (units / 1000) * fontSize;
  };
}

// How far a laid-out line's glyphs reach beyond its CSS line box (lineHeight x fontSize), above the first row and
// below the last one: script and display fonts draw swashes and descenders outside it. The composition draws the
// ink, so every "where is the line" check must include it (the line box alone is where the text is not).
export function inkOverflow(face: FontFaceInfo, lines: readonly string[], fontSize: number, lineHeight: number): { up: number; down: number } {
  if (!lines.length || !face.files.length) return { up: 0, down: 0 };
  try {
    const fonts = face.files.map((f) => open(f.path));
    const reach = (text: string) => {
      let maxY = 0;
      let minY = 0;
      for (const char of text) {
        const font = fonts.find((f) => f.hasGlyphForCodePoint(char.codePointAt(0)!)) ?? fonts[0];
        const g = font.glyphForCodePoint(char.codePointAt(0)!);
        const k = fontSize / font.unitsPerEm;
        if (g.bbox && Number.isFinite(g.bbox.maxY)) {
          maxY = Math.max(maxY, g.bbox.maxY * k);
          minY = Math.min(minY, g.bbox.minY * k);
        }
      }
      return { maxY, minY };
    };
    const f0 = fonts[0];
    const k0 = fontSize / f0.unitsPerEm;
    const ascent = f0.ascent * k0;
    const descent = -f0.descent * k0;
    const row = fontSize * lineHeight;
    const baseline = (row - (ascent + descent)) / 2 + ascent; // from the row's top
    const first = reach(lines[0]);
    const last = reach(lines[lines.length - 1]);
    return { up: Math.max(0, first.maxY - baseline), down: Math.max(0, -last.minY - (row - baseline)) };
  } catch {
    return { up: 0, down: 0 };
  }
}

export function layoutWithFace(text: string, face: FontFaceInfo, textCase: TextCase, textSize: number, area: LyricArea = DEFAULT_LYRIC_AREA): LyricLayout {
  return layoutLyric(applyTextCase(text, textCase), textSize, area.right - area.left, faceMeasure(face), area.minScale);
}

export type LyricFonts = { main: FontFaceInfo; hook?: FontFaceInfo | null; textCase: TextCase; textSize: number; area?: LyricArea };

// Lines that need the 3-line last resort (hook lines measured with the hook font).
export function tooLongLines<T extends { text: string; isHook?: boolean }>(lines: readonly T[], fonts: LyricFonts): T[] {
  return lines.filter((l) => {
    const face = l.isHook && fonts.hook ? fonts.hook : fonts.main;
    return layoutWithFace(l.text.replace(/^\*\s+/, ""), face, fonts.textCase, fonts.textSize, fonts.area).tooLong;
  });
}

export function tooLongMessage(lineNumber: number, file: string, text: string, styleName?: string): string {
  return (
    `Line ${lineNumber} is too long for phone screens${styleName ? ` (${styleName})` : ""}; ` +
    `split it in ${file}: "${text}"`
  );
}
