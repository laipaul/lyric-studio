// How videos are named on screen (11 Nov 2026): your own by platform and version, a try by what it tries, with the
// version it is based on; its files never take your own video's name.
import { describe, expect, it } from "vitest";

import { tryName, videoFilePart, videoTitle } from "../src/video-names";

describe("video names", () => {
  it("your own videos: platform and version", () => {
    expect(videoTitle({ label: "Reels", name: "v1" })).toEqual({ title: "Reels v1", basedOn: null });
    expect(videoFilePart({ label: "Reels", name: "v1" })).toBe("Reels");
    expect(videoFilePart({ label: "Reels", name: "v2" })).toBe("Reels v2");
  });

  it("a try: its own name, based on its version; with the platform where the list mixes platforms", () => {
    const t = { label: "Reels", name: "v1", try: "theme Midnight Highway" };
    expect(videoTitle(t)).toEqual({ title: "Try · Midnight Highway", basedOn: "based on v1" });
    expect(videoTitle(t, true).title).toBe("Reels · Try · Midnight Highway");
    expect(tryName("pictures city")).toBe("Try · pictures city");
    expect(videoFilePart(t)).toBe("Reels - Try Midnight Highway"); // never "Reels" (your own v1's file name)
  });
});
