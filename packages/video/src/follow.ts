// The Storyboard's "Follow playback": where the timeline scrolls so the playhead stays in view while the
// preview plays. Pure, so the studio and the tests share it.

export const FOLLOW_AT = 1 / 3; // the playhead is kept about a third from the timeline's left edge

// The scroll position (px) that keeps the playhead `playheadX` (px inside the content) at FOLLOW_AT of the
// visible width, clamped to the content; null when the timeline is already there (less than 1 px off) or
// everything fits without scrolling.
export function followScrollLeft(o: { scrollLeft: number; viewWidth: number; contentWidth: number; playheadX: number }): number | null {
  const max = Math.max(0, o.contentWidth - o.viewWidth);
  if (max <= 0 || o.viewWidth <= 0) return null;
  const target = Math.round(Math.min(max, Math.max(0, o.playheadX - o.viewWidth * FOLLOW_AT)));
  return Math.abs(target - o.scrollLeft) < 1 ? null : target;
}
