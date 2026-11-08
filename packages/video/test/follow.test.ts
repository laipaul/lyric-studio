// The Storyboard's "Follow playback": the playhead stays in the middle of the timeline.
import { describe, expect, it } from "vitest";

import { followScrollLeft, revealScrollLeft } from "../src";

describe("follow playback", () => {
  const view = { viewWidth: 900, contentWidth: 7000 };
  it("keeps the playhead in the middle of the view", () => {
    expect(followScrollLeft({ ...view, scrollLeft: 0, playheadX: 2000 })).toBe(1550);
  });
  it("does not scroll before the playhead reaches the middle, nor past the end", () => {
    expect(followScrollLeft({ ...view, scrollLeft: 0, playheadX: 200 })).toBeNull();
    expect(followScrollLeft({ ...view, scrollLeft: 6100, playheadX: 6990 })).toBeNull(); // already at the end
    expect(followScrollLeft({ ...view, scrollLeft: 3000, playheadX: 6990 })).toBe(6100);
  });
  it("jumps back when playback starts again earlier", () => {
    expect(followScrollLeft({ ...view, scrollLeft: 5000, playheadX: 100 })).toBe(0);
  });
  it("with half a view of space before 0:00 and after the end (the studio's Follow), the playhead is in the middle from the first frame to the last", () => {
    const pad = view.viewWidth / 2;
    const padded = { viewWidth: view.viewWidth, contentWidth: view.contentWidth + 2 * pad };
    expect(followScrollLeft({ ...padded, scrollLeft: 0, playheadX: pad + 0 })).toBeNull(); // at 0:00: already in the middle
    expect(followScrollLeft({ ...padded, scrollLeft: 0, playheadX: pad + 300 })).toBe(300); // scrolls at once, no travel to the middle
    expect(followScrollLeft({ ...padded, scrollLeft: 0, playheadX: pad + view.contentWidth })).toBe(view.contentWidth); // the very end, still in the middle
  });
  it("nothing to do when the whole timeline fits or is already in place", () => {
    expect(followScrollLeft({ viewWidth: 900, contentWidth: 800, scrollLeft: 0, playheadX: 700 })).toBeNull();
    expect(followScrollLeft({ ...view, scrollLeft: 1550.4, playheadX: 2000 })).toBeNull();
  });
});

describe("reveal the playhead after a jump (Follow off)", () => {
  const view = { viewWidth: 900, contentWidth: 7000 };
  it("does not scroll when the playhead is already visible", () => {
    expect(revealScrollLeft({ ...view, scrollLeft: 1000, playheadX: 1500 })).toBeNull();
    expect(revealScrollLeft({ ...view, scrollLeft: 1000, playheadX: 1040 })).toBeNull(); // exactly at the margin
  });
  it("brings a playhead left of the view in, with the margin on its left (back to the start: scrolls to 0)", () => {
    expect(revealScrollLeft({ ...view, scrollLeft: 6100, playheadX: 0 })).toBe(0);
    expect(revealScrollLeft({ ...view, scrollLeft: 3000, playheadX: 2500 })).toBe(2460);
  });
  it("brings a playhead right of the view in, with the margin on its right, never past the end", () => {
    expect(revealScrollLeft({ ...view, scrollLeft: 0, playheadX: 2000 })).toBe(1140);
    expect(revealScrollLeft({ ...view, scrollLeft: 0, playheadX: 6990 })).toBe(6100);
  });
  it("a playhead just inside the margin is nudged by the least amount", () => {
    expect(revealScrollLeft({ ...view, scrollLeft: 1000, playheadX: 1010 })).toBe(970);
    expect(revealScrollLeft({ ...view, scrollLeft: 1000, playheadX: 1880 })).toBe(1020);
  });
  it("nothing to do when everything fits", () => {
    expect(revealScrollLeft({ viewWidth: 900, contentWidth: 800, scrollLeft: 0, playheadX: 700 })).toBeNull();
  });
});
