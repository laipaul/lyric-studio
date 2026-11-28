import { describe, expect, it } from "vitest";

import { assetLabels, clipLabel, singerLines, singerOnLine, type StoryEntry } from "../src/labels";

// Prepare → Storyboard's cards: 1 own clip, 2 a collection card (the app picks), 3 a planned slot, 4 a picked clip.
const story: StoryEntry[] = [
  { kind: "clip", name: "BeginningClip.mp4" },
  { kind: "card", collection: "flowers", clips: ["Rose.mp4", "Tulip.mp4", "Picked.mp4"] },
  { kind: "slot", id: "s7" },
  { kind: "clip", name: "Picked.mp4" }, // a clip of flowers with a card of its own
];
// Wedding Day's singing anchors (song.json, 28 Nov 2026), given out of order.
const singing = [
  { line: 32, clip: "JenniferCloseUp1 take 1 final.mp4" },
  { line: 15, through: 16, clip: "WeddingDaySingingClip1 shot 1-2.mp4", source: "WeddingDaySingingClip1 · 1:02–1:09" },
  { line: 52, through: 54, clip: "Wedding DayTake5 Ending shot 1.mp4" },
  { line: 17, clip: "WeddingDaySingingClip2 shot 1.mp4" },
  { line: 25, clip: "WeddingDaySingingClip3 shot 1.mp4" },
];

describe("asset labels (one label per asset, every screen)", () => {
  const labels = assetLabels({ storyOrder: story, singingAnchors: singing });

  it("numbers B-roll by its Storyboard card (a collection card and a slot count too)", () => {
    expect(clipLabel(labels, "BeginningClip.mp4")).toBe("1");
    expect(clipLabel(labels, "Rose.mp4")).toBe("2"); // the app picks it from the card
    expect(clipLabel(labels, "Tulip.mp4")).toBe("2");
    expect(labels.slots.s7).toBe("3");
    expect(clipLabel(labels, "Picked.mp4")).toBe("4"); // its own card wins over its collection's card
  });

  it("names the singers S1, S2… by their first line", () => {
    expect(labels.singers.map((s) => `${s.label} ${singerLines(s)}`)).toEqual(["S1 L15–16", "S2 L17", "S3 L25", "S4 L32", "S5 L52–54"]);
    expect(clipLabel(labels, "WeddingDaySingingClip1 shot 1-2.mp4")).toBe("S1");
    expect(singerOnLine(labels, 16)?.label).toBe("S1"); // a later line it sings through
    expect(singerOnLine(labels, 16)?.source).toBe("WeddingDaySingingClip1 · 1:02–1:09");
    expect(singerOnLine(labels, 18)).toBeNull();
  });

  it("gives the same clip the same label, any case, on every line", () => {
    const twice = assetLabels({ storyOrder: [{ kind: "clip", name: "A.mp4" }, { kind: "clip", name: "a.MP4" }], singingAnchors: [{ line: 5, clip: "Sing.mp4" }, { line: 3, clip: "Other.mp4" }, { line: 9, clip: "sing.mp4" }] });
    expect(clipLabel(twice, "A.mp4")).toBe("1");
    expect(clipLabel(twice, "a.mp4")).toBe("1");
    expect(twice.singers.map((s) => s.label)).toEqual(["S1", "S2", "S2"]);
    expect(clipLabel(twice, "SING.mp4")).toBe("S2");
  });

  it("gives an unknown clip no label", () => {
    expect(clipLabel(labels, "Shot 3 · no take yet")).toBeNull();
    expect(clipLabel(labels, null)).toBeNull();
    expect(clipLabel(undefined, "BeginningClip.mp4")).toBeNull();
  });
});
