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

describe("a singing clip that plays to the end leaves no turn after it (Paul, 22 Nov 2026: the boat never shows)", () => {
  it("names the singing line, where it starts, the clip before it and the way in", () => {
    expect(notInReason("boat.mp4", [{ line: 32, clip: "TheEnding sings line 32.mp4" }], { line: 32, fromMs: 132867, after: "BeautifulBride2.mp4" })).toBe(
      "not in this video: the singing on line 32 plays from 2:12.9 to the end of this video, so no turn is left for it after BeautifulBride2.mp4. Move it earlier in Storyboard, or show it during the singing (Lyrics Sync → line 32 → Hide a moment)",
    );
  });
});
