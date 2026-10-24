// Measures lyric text in Node with the same font files the video uses, so "pnpm tap" and
// "pnpm render:test" can warn about lines that are too long before anything is rendered.
import { createRequire } from "node:module";
import path from "node:path";

import * as fontkit from "fontkit";

import { LYRIC_AREA } from "../config";
import { FONT_FILES, resolveFont } from "../fonts";
import { applyTextCase, layoutLyric, type LyricLayout, type MeasureFn } from "../lyrics";
import type { StyleProps } from "../props";

const require = createRequire(import.meta.url);
const fontDir = (family: string) =>
  path.join(path.dirname(require.resolve(`@fontsource/${family.toLowerCase()}/package.json`)), "files");

type Font = fontkit.Font;
const cache = new Map<string, { latin: Font; latinExt: Font }>();

function fontsFor(family: string, weight: number) {
  const key = `${family}|${weight}`;
  let fonts = cache.get(key);
  if (!fonts) {
    const files = FONT_FILES[family][weight];
    const open = (file: string) => fontkit.openSync(path.join(fontDir(family), file)) as Font;
    fonts = { latin: open(files.latin), latinExt: open(files.latinExt) };
    cache.set(key, fonts);
  }
  return fonts;
}

// Width in px of `text` at `fontSize`, with kerning. Characters missing from the basic Latin file
// (accents like ő, ł) are measured in the Latin-extended file, as the browser does.
export function fontMeasure(fontFamily: string, fontWeight: number): MeasureFn {
  const { family, weight } = resolveFont(fontFamily, fontWeight);
  const { latin, latinExt } = fontsFor(family, weight);
  return (text, fontSize) => {
    let units = 0;
    let run = "";
    let runFont = latin;
    const flush = () => {
      if (run) units += (runFont.layout(run).advanceWidth / runFont.unitsPerEm) * 1000;
      run = "";
    };
    for (const char of text) {
      const font = latin.hasGlyphForCodePoint(char.codePointAt(0)!) ? latin : latinExt;
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

export function layoutForStyle(text: string, style: StyleProps, textSize: number): LyricLayout {
  return layoutLyric(
    applyTextCase(text, style.textCase),
    textSize,
    LYRIC_AREA.right - LYRIC_AREA.left,
    fontMeasure(style.font, style.weight),
    LYRIC_AREA.minScale,
  );
}

export type TooLongLine = { text: string; layout: LyricLayout };

// Lines that need the 3-line last resort with this style and size.
export function tooLongLines(texts: readonly string[], style: StyleProps, textSize: number): TooLongLine[] {
  return texts
    .map((text) => ({ text, layout: layoutForStyle(text, style, textSize) }))
    .filter((l) => l.layout.tooLong);
}

export function tooLongMessage(lineNumber: number, file: string, text: string, styleName?: string): string {
  return (
    `Line ${lineNumber} is too long for phone screens${styleName ? ` (${styleName} style)` : ""}; ` +
    `split it in ${file}: "${text}"`
  );
}
