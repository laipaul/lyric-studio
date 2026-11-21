// Shape's clip list says why a clip gets no shot (Paul, 21 Nov 2026: "the boat doesn't appear").
import { describe, expect, it } from "vitest";

import { notInReason } from "../src/node/storyboard";

describe("a clip with no shot in a video says why", () => {
  it("its turn in the story order comes after this part of the song ends: move it earlier or put it on a line", () => {
    expect(notInReason("boat.mp4", [{ line: 9, clip: "rings.mp4" }])).toBe("not in this video: this part of the song ends before its turn in the story order. Move it earlier in Storyboard, or put it on a line (Lyrics Sync → Show a clip)");
  });
  it("it is on a line outside this part of the song (names the lines, case ignored)", () => {
    expect(notInReason("Boat.mp4", [{ line: 3, clip: "boat.mp4" }, { line: 40, clip: "BOAT.mp4", through: 42 }])).toBe("not in this video: it is on line 3, 40-42, outside this video's part of the song");
  });
});
