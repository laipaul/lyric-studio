// The Storyboard's "Follow playback": the timeline keeps the playhead a third from its left edge.
import { describe, expect, it } from "vitest";

import { followScrollLeft } from "../src";

describe("follow playback", () => {
  const view = { viewWidth: 900, contentWidth: 7000 };
  it("keeps the playhead a third from the left edge", () => {
    expect(followScrollLeft({ ...view, scrollLeft: 0, playheadX: 2000 })).toBe(1700);
  });
  it("does not scroll before the playhead reaches a third, nor past the end", () => {
    expect(followScrollLeft({ ...view, scrollLeft: 0, playheadX: 200 })).toBeNull();
    expect(followScrollLeft({ ...view, scrollLeft: 6100, playheadX: 6990 })).toBeNull(); // already at the end
    expect(followScrollLeft({ ...view, scrollLeft: 3000, playheadX: 6990 })).toBe(6100);
  });
  it("jumps back when playback starts again earlier", () => {
    expect(followScrollLeft({ ...view, scrollLeft: 5000, playheadX: 100 })).toBe(0);
  });
  it("nothing to do when the whole timeline fits or is already in place", () => {
    expect(followScrollLeft({ viewWidth: 900, contentWidth: 800, scrollLeft: 0, playheadX: 700 })).toBeNull();
    expect(followScrollLeft({ ...view, scrollLeft: 1700.4, playheadX: 2000 })).toBeNull();
  });
});
