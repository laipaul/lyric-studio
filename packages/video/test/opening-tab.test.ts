import { describe, expect, it } from "vitest";

import { chooseOpeningTab, chooseReviewPlatform } from "../../../apps/studio/src/lib/opening-tab";

const TABS = ["assets", "lyrics", "details", "clips", "production", "shape", "generate", "videos", "post"];

describe("chooseOpeningTab", () => {
  it("?tab= wins over everything", () => {
    expect(chooseOpeningTab({ asked: "lyrics", remembered: "post", tabs: TABS, keptVideos: 3, todoTab: "assets" })).toBe("lyrics");
  });
  it("an unknown ?tab= falls back to the remembered tab", () => {
    expect(chooseOpeningTab({ asked: "nope", remembered: "shape", tabs: TABS, keptVideos: 0 })).toBe("shape");
  });
  it("opens on the tab last used for this song", () => {
    expect(chooseOpeningTab({ remembered: "details", tabs: TABS, keptVideos: 2, todoTab: "assets" })).toBe("details");
  });
  it("ignores a remembered tab that does not exist", () => {
    expect(chooseOpeningTab({ remembered: "gone", tabs: TABS, keptVideos: 0, todoTab: "lyrics" })).toBe("lyrics");
  });
  it("first visit: Review only with a kept video", () => {
    expect(chooseOpeningTab({ tabs: TABS, keptVideos: 1, todoTab: "assets" })).toBe("videos");
    expect(chooseOpeningTab({ tabs: TABS, keptVideos: 0, todoTab: "assets" })).toBe("assets");
  });
  it("first visit, nothing kept and nothing to do: Make", () => {
    expect(chooseOpeningTab({ tabs: TABS, keptVideos: 0 })).toBe("generate");
  });
});

describe("chooseReviewPlatform", () => {
  const ps = [
    { name: "reels", count: 0 },
    { name: "tiktok", count: 2 },
    { name: "shorts", count: 1 },
  ];
  it("keeps the remembered platform when it has videos", () => {
    expect(chooseReviewPlatform("shorts", ps)).toBe("shorts");
  });
  it("moves off a remembered platform with 0 videos", () => {
    expect(chooseReviewPlatform("reels", ps)).toBe("tiktok");
  });
  it("nothing remembered: the first platform with videos", () => {
    expect(chooseReviewPlatform(null, ps)).toBe("tiktok");
  });
  it("no platform has videos: the remembered one, else the first", () => {
    const none = [{ name: "reels", count: 0 }, { name: "canvas", count: 0 }];
    expect(chooseReviewPlatform("canvas", none)).toBe("canvas");
    expect(chooseReviewPlatform(null, none)).toBe("reels");
    expect(chooseReviewPlatform("youtube", none)).toBe("reels");
  });
  it("no platforms at all", () => {
    expect(chooseReviewPlatform("reels", [])).toBeNull();
  });
});
