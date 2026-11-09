// The theme's text layout (recipe "textLayout", Edit theme → Text; 1 Nov 2026). Pure, browser-safe.
//   centre   the lyrics slightly above the middle of the usable area (the platform's lyricsAt), as always
//   lower    the lyrics in the lower third of the usable area, the picture left open above them
//   bighook  chorus lines larger (BIG_HOOK_SCALE); verses as usual
// Always inside the platform's safe zones: the layout only moves the block's centre inside the usable area
// (lyricArea's top / bottom), and the line fit (layoutLyric, minScale) still shrinks a line that is too wide.
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
export const LOWER_THIRD_AT = 0.68; // of the usable area (0 = its top, 1 = its bottom): low, yet three big lines and the next line still clear every platform's safe zone (test/text-layout.test.ts)
export const BIG_HOOK_SCALE = 1.3;

export function isTextLayout(v: unknown): v is TextLayout {
  return typeof v === "string" && (TEXT_LAYOUTS as readonly string[]).includes(v);
}

// The lyric area with the layout's height: "lower" sits in the lower third; the others at lyricsAt.
export function areaForLayout(area: LyricArea, layout: TextLayout | undefined, lyricsAt = 0.45): LyricArea {
  const at = layout === "lower" ? LOWER_THIRD_AT : lyricsAt;
  return { ...area, centerY: Math.round(area.top + (area.bottom - area.top) * at) };
}

// A line's size factor: a textboard card's own scale wins; then the final hook's (line.scale); else Big
// hook's on chorus lines.
export function lineScale(l: { isHook?: boolean; scale?: number; card?: { scale?: number } | null }, hookScale = 1): number {
  return l.card?.scale ?? l.scale ?? (l.isHook ? hookScale : 1);
}
