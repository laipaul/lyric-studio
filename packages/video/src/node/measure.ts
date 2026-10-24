// Measures lyric text in Node with the same font files the video uses, so "pnpm tap" and
// "pnpm render:test" can warn about lines that are too long before anything is rendered.
import * as fontkit from "fontkit";

import { LYRIC_AREA } from "../config";
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

export function layoutWithFace(text: string, face: FontFaceInfo, textCase: TextCase, textSize: number): LyricLayout {
  return layoutLyric(
    applyTextCase(text, textCase),
    textSize,
    LYRIC_AREA.right - LYRIC_AREA.left,
    faceMeasure(face),
    LYRIC_AREA.minScale,
  );
}

export type LyricFonts = { main: FontFaceInfo; hook?: FontFaceInfo | null; textCase: TextCase; textSize: number };

// Lines that need the 3-line last resort (hook lines measured with the hook font).
export function tooLongLines<T extends { text: string; isHook?: boolean }>(lines: readonly T[], fonts: LyricFonts): T[] {
  return lines.filter((l) => {
    const face = l.isHook && fonts.hook ? fonts.hook : fonts.main;
    return layoutWithFace(l.text.replace(/^\*\s+/, ""), face, fonts.textCase, fonts.textSize).tooLong;
  });
}

export function tooLongMessage(lineNumber: number, file: string, text: string, styleName?: string): string {
  return (
    `Line ${lineNumber} is too long for phone screens${styleName ? ` (${styleName})` : ""}; ` +
    `split it in ${file}: "${text}"`
  );
}
