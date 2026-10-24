import { describe, expect, it } from "vitest";
import { COMPOSITION_ID, VIDEO } from "./config";

describe("video format", () => {
  it("is 9:16 portrait at 1080x1920, 30 fps", () => {
    expect(VIDEO.width).toBe(1080);
    expect(VIDEO.height).toBe(1920);
    expect(VIDEO.width / VIDEO.height).toBeCloseTo(9 / 16);
    expect(VIDEO.fps).toBe(30);
  });

  it("uses the LyricVideo composition id", () => {
    expect(COMPOSITION_ID).toBe("LyricVideo");
  });
});
