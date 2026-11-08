// The Storyboard's "Follow playback": where the timeline scrolls so the playhead stays in view while the
// preview plays. Pure, so the studio and the tests share it.

export const FOLLOW_AT = 1 / 2; // the playhead stays in the middle of the timeline (continuous scroll, as Pro Tools / Logic / Final Cut; 7 Nov 2026, asked by the user)

// The scroll position (px) that keeps the playhead `playheadX` (px inside the content) at FOLLOW_AT of the
// visible width, clamped to the content; null when the timeline is already there (less than 1 px off) or
// everything fits without scrolling.
export function followScrollLeft(o: { scrollLeft: number; viewWidth: number; contentWidth: number; playheadX: number }): number | null {
  const max = Math.max(0, o.contentWidth - o.viewWidth);
  if (max <= 0 || o.viewWidth <= 0) return null;
  const target = Math.round(Math.min(max, Math.max(0, o.playheadX - o.viewWidth * FOLLOW_AT)));
  return Math.abs(target - o.scrollLeft) < 1 ? null : target;
}

export const REVEAL_MARGIN = 40; // px of room kept between the playhead and the timeline's edge when it is only brought into view

// A jump of the playhead (start, end, a bar step, a click on the ruler / a lyric / a clip, Undo) with Follow OFF:
// the scroll position (px) that brings the playhead `playheadX` (px inside the content) into view with `margin`
// px to spare on the side it came from; null when it is already visible (inside the view, `margin` px from both
// edges) or nothing can scroll. With Follow ON a jump uses followScrollLeft (the middle) instead.
export function revealScrollLeft(o: { scrollLeft: number; viewWidth: number; contentWidth: number; playheadX: number; margin?: number }): number | null {
  const max = Math.max(0, o.contentWidth - o.viewWidth);
  if (max <= 0 || o.viewWidth <= 0) return null;
  const margin = Math.min(o.margin ?? REVEAL_MARGIN, o.viewWidth / 2);
  if (o.playheadX >= o.scrollLeft + margin && o.playheadX <= o.scrollLeft + o.viewWidth - margin) return null;
  const want = o.playheadX < o.scrollLeft + margin ? o.playheadX - margin : o.playheadX - o.viewWidth + margin;
  const target = Math.round(Math.min(max, Math.max(0, want)));
  return Math.abs(target - o.scrollLeft) < 1 ? null : target;
}
