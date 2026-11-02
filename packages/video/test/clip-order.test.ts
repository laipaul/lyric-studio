// The song's clip order (2 Nov 2026): one sequence for Assets (drag and drop), Shape and Make, saved in
// clips.json "order". Assets moves only the song's own clips; collection clips keep their places.
import { describe, expect, it } from "vitest";

import { inClipOrder, withSongOrder, type ClipEdits } from "../src/node/clip-edits";

const edits = (order: string[]): ClipEdits => ({ order, clips: {} });

describe("the song's clip order", () => {
  it("listed clips first, as listed; the others by file name (numbers counted as numbers)", () => {
    expect(inClipOrder(edits([]), ["10_c.mp4", "2_b.mp4", "1_a.mp4"])).toEqual(["1_a.mp4", "2_b.mp4", "10_c.mp4"]);
    expect(inClipOrder(edits(["Sunset.MP4", "1_a.mp4"]), ["1_a.mp4", "2_b.mp4", "sunset.mp4"])).toEqual(["sunset.mp4", "1_a.mp4", "2_b.mp4"]);
  });

  it("a new song order takes the song clips' places; collection clips stay where they are", () => {
    const before = edits(["a.mp4", "lifelyrics_1.mp4", "b.mp4", "lifelyrics_2.mp4", "c.mp4"]);
    const next = withSongOrder(before, ["a.mp4", "b.mp4", "c.mp4"], ["c.mp4", "a.mp4", "b.mp4"]);
    expect(next.order).toEqual(["c.mp4", "lifelyrics_1.mp4", "a.mp4", "lifelyrics_2.mp4", "b.mp4"]);
  });

  it("song clips not yet in the order go at the end; a clip is never dropped", () => {
    const next = withSongOrder(edits(["lifelyrics_1.mp4", "a.mp4"]), ["a.mp4", "new.mp4", "z.mp4"], ["new.mp4", "a.mp4"]);
    expect(next.order).toEqual(["lifelyrics_1.mp4", "new.mp4", "a.mp4", "z.mp4"]);
  });
});
