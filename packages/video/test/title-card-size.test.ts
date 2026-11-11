// Title card size as a number (12 Nov 2026, asked by the user): px at the video's size, up to twice the title's usual
// size for any card, the minimum readable size a warning, and the live preview patching the planned card at once.
import { describe, expect, it } from "vitest";

import type { TextCardProps } from "../src/props";
import { checkStyle, previewTitleCard, readableWarning, titleCardMult, titleCardSize } from "../src/textboard";

const card = (id: "title" | "byline" | "tagline", size: number, extra: Partial<TextCardProps> = {}): TextCardProps => ({
  id, type: id, text: id, font: "Inter", weight: 400, size, baseSize: size, colour: "#FFFFFF", letterSpacing: 0, upper: false, startFrame: 0, endFrame: 90, ...extra,
});

describe("title card size", () => {
  it("lets the credits grow up to twice the title's usual size (a 1080x1920 Reel: title 84 px)", () => {
    const tagline = titleCardSize(card("tagline", 29), 1, 84);
    expect(tagline).toEqual({ px: 29, min: 15, max: 168, base: 29 });
    expect(titleCardSize(card("byline", 38), 1, 84).max).toBe(168);
    expect(titleCardSize(card("tagline", 29), 1).max).toBe(166); // no title planned: from its share of it
    expect(titleCardSize(card("title", 84), 1.5)).toMatchObject({ px: 126, max: 168 });
  });
  it("turns px into the stored multiplier, kept inside the range", () => {
    expect(titleCardMult(84, 29, 168)).toBe(2.9);
    expect(titleCardMult(500, 29, 168)).toBe(5.79);
    expect(titleCardMult(2, 29, 168)).toBe(0.52);
  });
  it("accepts the wider range for title cards only", () => {
    const problems: string[] = [];
    expect(checkStyle({ size: 5.79 }, "tagline", problems, true).size).toBe(5.79);
    checkStyle({ size: 3 }, "verse", problems);
    expect(problems).toEqual(["verse.size must be 0.5-2 (x the usual size)"]);
  });
  it("warns, never blocks, under the readable size", () => {
    expect(readableWarning(29, 1080)).toBeNull();
    expect(readableWarning(20, 1080)).toContain("Hard to read");
    expect(readableWarning(20, 720)).toBeNull(); // 30 px at 1080 wide
  });
});

describe("previewTitleCard", () => {
  const area = { top: 300, bottom: 1500, centerY: 900 };
  const cards = [card("title", 84, { centerY: 640 }), card("tagline", 29, { stackOn: "title", lines: ["a", "b"] })];
  it("shows the draft's size, colour, transparency and capitals at once", () => {
    const [, t] = previewTitleCard(cards, "tagline", { size: 2, colour: "#336699", opacity: 0.6, upper: true }, { area, frameHeight: 1920 });
    expect(t).toMatchObject({ size: 58, colour: "#336699", opacity: 0.6, upper: true, stackOn: "title" });
    expect(t.lines).toBeUndefined();
  });
  it("moves a card to its new place", () => {
    const [, t] = previewTitleCard(cards, "tagline", { position: "lower" }, { area, frameHeight: 1920 });
    expect(t.stackOn).toBeUndefined();
    expect(t.centerY).toBe(1140);
  });
  it("leaves the other cards alone", () => {
    expect(previewTitleCard(cards, "tagline", { size: 2 }, { area, frameHeight: 1920 })[0]).toBe(cards[0]);
  });
});
