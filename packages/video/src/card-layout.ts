// The title opening's card layout (where each title / byline / tagline block sits, wrapping, fitting into
// the safe area): pure and free of Remotion, so the studio's server (Textboard API) can use it.
import type { SafeZone } from "./platform";
import type { TextCardProps } from "./props";

// Where the title / byline / tagline blocks sit on the frame (for QA and the cover): each root card with
// the cards stacked under it, as the composition draws them: a block as wide as the root's left / right
// (default: the whole frame), centred text that wraps at that width (at spaces, as the browser does), or
// at the card's own `lines` when the layout has set them. `measure` gives a text's one-line width in px
// (letter spacing and upper-case included).
export const CARD_LINE_HEIGHT = 1.2;
export type CardMeasure = (card: { id: string; text: string; size: number; letterSpacing: number; upper: boolean }) => number;

// Greedy word wrap, as the browser breaks a line: a word wider than the width stays on a line of its own.
export function wrapWords(text: string, maxWidth: number, widthOf: (line: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && widthOf(next) > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

// The text on `count` lines with the shortest widest line (balanced: no orphan word); one line when the
// text has a single word. Words only (never a break inside a word).
export function balancedLines(text: string, count: number, widthOf: (line: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (count < 2 || words.length < 2) return [words.join(" ") || text];
  let best: string[] = [words.join(" ")];
  let bestWidth = Number.POSITIVE_INFINITY;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ");
    const b = words.slice(k).join(" ");
    const widest = Math.max(widthOf(a), widthOf(b));
    if (widest < bestWidth - 0.5) {
      best = [a, b];
      bestWidth = widest;
    }
  }
  return best;
}

export function cardBlocks(
  cards: readonly Pick<TextCardProps, "id" | "type" | "text" | "size" | "stackOn" | "top" | "centerY" | "letterSpacing" | "upper" | "startFrame" | "endFrame" | "lines" | "left" | "right">[],
  format: { width: number; height: number },
  measure: CardMeasure,
): { ids: string[]; text: string; box: { left: number; top: number; right: number; bottom: number }; endFrame: number }[] {
  const shown = new Set(cards.map((c) => c.id));
  const roots = cards.filter((c) => !c.stackOn || !shown.has(c.stackOn));
  return roots.map((root) => {
    const parts = [root, ...cards.filter((c) => c.stackOn === root.id)];
    const from = root.left ?? 0;
    const room = (root.right ?? format.width) - from;
    let height = 0;
    let widest = 0;
    parts.forEach((c, i) => {
      const widthOf = (text: string) => measure({ id: c.id, text, size: c.size, letterSpacing: c.letterSpacing, upper: c.upper });
      const lines = c.lines?.length ? c.lines : wrapWords(c.text, room, widthOf);
      widest = Math.max(widest, ...lines.map(widthOf));
      height += lines.length * c.size * CARD_LINE_HEIGHT + (i > 0 ? root.size * 0.25 : 0);
    });
    const top = root.top ?? (root.centerY ?? format.height / 2) - height / 2;
    const left = from + (room - widest) / 2;
    return { ids: parts.map((p) => p.id), text: parts.map((p) => p.text).join(" / "), box: { left, top, right: left + widest, bottom: top + height }, endFrame: Math.max(...parts.map((p) => p.endFrame)) };
  });
}

// The 3:4 area of a 9:16 frame that Instagram shows on the profile grid (centred).
export function gridCrop(format: { width: number; height: number }): { top: number; bottom: number } {
  const h = Math.min(format.height, Math.round((format.width * 4) / 3));
  const top = Math.round((format.height - h) / 2);
  return { top, bottom: top + h };
}

// How far the layout may shrink a card block to fit the safe area (title and byline together): 25%.
export const CARD_MIN_SCALE = 0.75;
const CARD_SCALE_STEP = 0.05;

// Fits the title opening's blocks into the platform's safe area, as the app's own work (never the user's
// setting): first a long text wraps onto at most 2 balanced lines inside the safe area's width, then the
// whole block (a title and the byline under it) shrinks step by step, down to 25% smaller, and its top and
// bottom are kept inside the safe area (and inside the profile grid's 3:4 crop when the block fits there),
// moving the block as little as needed. A block that is fine as it is stays untouched; one that cannot fit
// is left at the smallest size, and the QA check names it. Measured with the same measure as QA's blocks.
export function fitCardBlocks<T extends TextCardProps>(cards: readonly T[], o: { format: { width: number; height: number }; safeZone: SafeZone; measure: CardMeasure }): T[] {
  const { format, safeZone: safe, measure } = o;
  const shown = new Set(cards.map((c) => c.id));
  const margin = format.width * Math.max(safe.left, safe.right); // symmetric: the block stays centred on the frame
  const room = format.width - 2 * margin;
  const safeTop = format.height * safe.top;
  const safeBottom = format.height * (1 - safe.bottom);
  const grid = format.height > format.width ? gridCrop(format) : null;
  const out = new Map<string, T>();
  for (const root of cards.filter((c) => !c.stackOn || !shown.has(c.stackOn))) {
    const parts = [root, ...cards.filter((c) => c.stackOn === root.id)];
    const widthOf = (c: T, size: number) => (text: string) => measure({ id: c.id, text, size, letterSpacing: c.letterSpacing, upper: c.upper });
    // One layout at a scale: each text on one line, else on 2 balanced lines; null when a line is too wide.
    const layout = (scale: number) => {
      const sizes = parts.map((c) => Math.max(1, Math.round(c.size * scale)));
      const lines = parts.map((c, i) => {
        const w = widthOf(c, sizes[i]);
        const one = [c.text.trim()];
        if (w(one[0]) <= room) return one;
        const two = balancedLines(c.text, 2, w);
        return two.length === 2 && two.every((l) => w(l) <= room) ? two : null;
      });
      if (lines.some((l) => !l)) return null;
      const height = parts.reduce((h, _c, i) => h + lines[i]!.length * sizes[i] * CARD_LINE_HEIGHT + (i > 0 ? sizes[0] * 0.25 : 0), 0);
      return { sizes, lines: lines as string[][], height };
    };
    const place = (height: number) => {
      const own = root.top ?? (root.centerY ?? format.height / 2) - height / 2;
      const gridFits = grid && Math.min(safeBottom, grid.bottom) - Math.max(safeTop, grid.top) >= height;
      const lo = gridFits ? Math.max(safeTop, grid!.top) : safeTop;
      const hi = (gridFits ? Math.min(safeBottom, grid!.bottom) : safeBottom) - height;
      const top = Math.min(Math.max(Math.round(own), Math.ceil(lo)), Math.floor(hi));
      return { top, moved: Math.abs(top - own) > 0.5 };
    };
    // The block as it is: fine when it is one line per text, inside the width and not moved.
    const as = layout(1);
    const asIs = as && as.lines.every((l) => l.length === 1) && !place(as.height).moved;
    if (asIs) {
      parts.forEach((c) => out.set(c.id, c));
      continue;
    }
    let chosen: NonNullable<ReturnType<typeof layout>> | null = null;
    for (let scale = 1; scale >= CARD_MIN_SCALE - 1e-9 && !chosen; scale -= CARD_SCALE_STEP) {
      const fit = layout(scale);
      if (fit && fit.height <= safeBottom - safeTop) chosen = fit;
    }
    // Not fitting even at the smallest size: the smallest, wrapped by the browser as it would be, for QA to name.
    const sizes = chosen?.sizes ?? parts.map((c) => Math.round(c.size * CARD_MIN_SCALE));
    const lines = chosen?.lines ?? null;
    const height = chosen
      ? chosen.height
      : parts.reduce((h, c, i) => h + wrapWords(c.text, room, widthOf(c, sizes[i])).length * sizes[i] * CARD_LINE_HEIGHT + (i > 0 ? sizes[0] * 0.25 : 0), 0);
    const at = place(height);
    parts.forEach((c, i) => {
      const two = lines && lines[i].length > 1 ? { lines: lines[i] } : {};
      if (c === root) {
        const { centerY: _cy, top: _t, ...rest } = c;
        out.set(c.id, { ...rest, size: sizes[i], left: margin, right: format.width - margin, ...two, ...(at.moved || c.top !== undefined ? { top: at.top } : c.centerY !== undefined ? { centerY: c.centerY } : {}) } as T);
      } else out.set(c.id, { ...c, size: sizes[i], ...two });
    });
  }
  return cards.map((c) => out.get(c.id) ?? c);
}

// One card text, as fitCardBlocks lays it out (Song Details' fit hint, 11 Nov 2026): on one line when it fits the
// width, else on 2 balanced lines, else the same made up to 25% smaller; null when even that does not fit (the
// render would leave it too wide). widthAt: the text's one-line width at a font size (letter spacing and case in).
export function cardFit(text: string, size: number, room: number, widthAt: (text: string, size: number) => number): { lines: 1 | 2; scale: number } | null {
  const t = text.trim();
  if (!t) return { lines: 1, scale: 1 };
  for (let scale = 1; scale >= CARD_MIN_SCALE - 1e-9; scale = Math.round((scale - CARD_SCALE_STEP) * 100) / 100) {
    const s = Math.max(1, Math.round(size * scale));
    const w = (x: string) => widthAt(x, s);
    if (w(t) <= room) return { lines: 1, scale };
    const two = balancedLines(t, 2, w);
    if (two.length === 2 && two.every((l) => w(l) <= room)) return { lines: 2, scale };
  }
  return null;
}
