// The theme's text layout (recipe "textLayout", Edit theme → Text; 1 Nov 2026). Pure, browser-safe.
//   centre   the lyrics slightly above the middle of the usable area (the platform's lyricsAt), as always
//   lower    the lyrics in the lower third of the usable area, the picture left open above them
//   bighook  chorus lines larger (BIG_HOOK_SCALE); verses as usual
// "lower" anchors the block's BOTTOM edge (its last row, the waiting next line, a text box's padding) LOWER_MARGIN of the
// frame height above the usable area's bottom (the platform's safe zone), so lines of 1-3 rows grow upward and never
// below it (22 Nov 2026: a centre at 0.68 of the area put Reels' lyrics at 49% of the screen, across the faces).
// Always inside the platform's safe zones, and the line fit (layoutLyric, minScale) still shrinks a line that is too wide.
// YouTube's cover / stills layouts keep their own placement.
import type { LyricArea } from "./platform";

export const TEXT_LAYOUTS = ["centre", "lower", "bighook"] as const;
export type TextLayout = (typeof TEXT_LAYOUTS)[number];
export const TEXT_LAYOUT_LABELS: Record<TextLayout, string> = { centre: "Centred", lower: "Lower third", bighook: "Big hook" };
export const TEXT_LAYOUT_HINTS: Record<TextLayout, string> = {
  centre: "the lyrics slightly above the middle",
  lower: "the lyrics low, the picture open above them",
  bighook: "chorus lines larger, verses as usual",
};
export const LOWER_MARGIN = 0.0175; // of the frame height: the gap between the lowest drawn row and the usable area's bottom
export const LOWER_TYPICAL_HALF = 0.05; // of the frame height: half of a typical two-row block, for the area's own centerY (cards, band)
export const BIG_HOOK_SCALE = 1.3;

export function isTextLayout(v: unknown): v is TextLayout {
  return typeof v === "string" && (TEXT_LAYOUTS as readonly string[]).includes(v);
}

// The lyric area with the layout's height: "lower" sits in the lower third; the others at lyricsAt.
export function areaForLayout(area: LyricArea, layout: TextLayout | undefined, lyricsAt = 0.45, frameHeight = 1920): LyricArea {
  const { anchor: _anchor, bottomMargin: _margin, ...base } = area; // switching layouts never keeps the old anchoring
  if (layout === "lower") {
    const bottomMargin = Math.round(frameHeight * LOWER_MARGIN);
    const centerY = Math.round(area.bottom - bottomMargin - frameHeight * LOWER_TYPICAL_HALF);
    return { ...base, centerY: Math.max(area.top, centerY), anchor: "bottom", bottomMargin };
  }
  return { ...base, centerY: Math.round(area.top + (area.bottom - area.top) * lyricsAt) };
}

// A line's size factor: a textboard card's own scale wins; then the final hook's (line.scale); else Big
// hook's on chorus lines.
export function lineScale(l: { isHook?: boolean; scale?: number; card?: { scale?: number } | null }, hookScale = 1): number {
  return l.card?.scale ?? l.scale ?? (l.isHook ? hookScale : 1);
}
