// Lyric timing and layout (pure functions, used by the composition and tests).
import { stackLyric, type LineShape } from "./line-shape";
import type { LyricLineProps, TextCase } from "./props";

// The line on screen at `frame` (startFrame <= frame < endFrame), or null.
export function activeLyricLine(lines: readonly LyricLineProps[], frame: number): LyricLineProps | null {
  let active: LyricLineProps | null = null;
  for (const line of lines) {
    if (frame >= line.startFrame && frame < line.endFrame && (!active || line.startFrame >= active.startFrame)) {
      active = line;
    }
  }
  return active;
}

export function applyTextCase(text: string, textCase: TextCase): string {
  switch (textCase) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "title":
      return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    default:
      return text;
  }
}

// Width of `text` at `fontSize` px. Text width scales linearly with font size.
export type MeasureFn = (text: string, fontSize: number) => number;

export type LyricLayout = {
  lines: string[]; // the printed rows: 1-2 normally, 3 only as a last resort (stacked shape: up to 4 short rows)
  fontSize: number;
  tooLong: boolean; // needed 3 lines: the lyric line should be split in the lyrics file
};

export const MAX_LINES = 2;
export const LAST_RESORT_LINES = 3;

// Splits words into `count` lines so that the widest line is as narrow as possible.
function balancedSplit(words: string[], count: number, width: (line: string) => number): { lines: string[]; widest: number } {
  if (count <= 1 || words.length <= 1) {
    const line = words.join(" ");
    return { lines: [line], widest: width(line) };
  }
  let best: { lines: string[]; widest: number } | null = null;
  for (let k = 1; k <= words.length - count + 1; k++) {
    const first = words.slice(0, k).join(" ");
    const rest = balancedSplit(words.slice(k), count - 1, width);
    const widest = Math.max(width(first), rest.widest);
    if (!best || widest < best.widest) best = { lines: [first, ...rest.lines], widest };
  }
  return best!;
}

// Layout rules, in order:
//   1. one line if it fits;
//   2. two balanced lines at full size;
//   3. two balanced lines, font shrunk by up to (1 - minScale) (25%);
//   4. last resort: three balanced lines at the smallest size, shrunk further only if needed to stay
//      inside the lyric area. Never more than three lines. `tooLong` marks case 4.
// The theme's stacked line shape (src/line-shape.ts) uses its own rows instead: 2-4 short rows.
export function layoutLyric(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: MeasureFn,
  minScale = 0.75,
  shape?: { shape?: LineShape; breaths?: readonly boolean[] },
): LyricLayout {
  const clean = text.trim().replace(/\s+/g, " ");
  if (shape?.shape === "stacked") {
    const s = stackLyric(clean, fontSize, maxWidth, measure, minScale, shape.breaths);
    return { lines: s.rows, fontSize: s.fontSize, tooLong: s.tooLong };
  }
  const words = clean.split(" ");
  const at = (size: number) => (line: string) => measure(line, size);
  const fitSize = (widest: number, size: number) => Math.floor(size * Math.min(1, maxWidth / widest) * 10) / 10;

  if (measure(clean, fontSize) <= maxWidth) return { lines: [clean], fontSize, tooLong: false };

  const two = balancedSplit(words, Math.min(MAX_LINES, words.length), at(fontSize));
  if (two.widest <= maxWidth) return { lines: two.lines, fontSize, tooLong: false };

  const smallest = fontSize * minScale;
  if (two.widest * minScale <= maxWidth) return { lines: two.lines, fontSize: fitSize(two.widest, fontSize), tooLong: false };

  if (words.length <= MAX_LINES) {
    // One or two very long words: cannot use more lines, shrink to fit.
    return { lines: two.lines, fontSize: fitSize(two.widest, fontSize), tooLong: true };
  }
  const three = balancedSplit(words, LAST_RESORT_LINES, at(smallest));
  return { lines: three.lines, fontSize: fitSize(three.widest, smallest), tooLong: true };
}
