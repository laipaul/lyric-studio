// Song Details' fit hint (11 Nov 2026): a card text is laid out as the render does (fitCardBlocks): one line when it
// fits, else 2 balanced lines, else up to 25% smaller; null when even that does not fit.
import { describe, expect, it } from "vitest";

import { cardFit } from "../src/card-layout";

// A monospace stand-in: every character is 0.6 of the size wide.
const widthAt = (t: string, size: number) => t.length * size * 0.6;

describe("cardFit", () => {
  it("one line when it fits the width", () => {
    expect(cardFit("Art: @noriko_imazeki", 35, 821, widthAt)).toEqual({ lines: 1, scale: 1 }); // 20 chars x 21 px = 420
  });
  it("2 balanced lines when one line is too wide", () => {
    expect(cardFit("Floral Artwork: Noriko Imazeki @noriko_imazeki", 50, 821, widthAt)).toEqual({ lines: 2, scale: 1 });
  });
  it("smaller when 2 lines at full size are still too wide, null when even 25% smaller does not fit", () => {
    const r = cardFit("Hold me close until the light comes", 92, 821, widthAt);
    expect(r?.lines).toBe(2);
    expect(r!.scale).toBeLessThan(1);
    expect(r!.scale).toBeGreaterThanOrEqual(0.75);
    expect(cardFit("Supercalifragilisticexpialidociousness", 92, 821, widthAt)).toBeNull(); // one word, too wide
  });
});
