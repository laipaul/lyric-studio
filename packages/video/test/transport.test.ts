// The Shape page's transport bar: back / forward one bar land on bar lines.
import { describe, expect, it } from "vitest";

import { stepFrame, stepToBar } from "../src";

describe("transport bar steps", () => {
  const bars = [0, 60, 120, 180];
  const d = { barFrames: bars, durationInFrames: 200 };
  it("forward goes to the next bar line, then the last frame", () => {
    expect(stepToBar({ ...d, frame: 0, dir: 1 })).toBe(60);
    expect(stepToBar({ ...d, frame: 75, dir: 1 })).toBe(120);
    expect(stepToBar({ ...d, frame: 180, dir: 1 })).toBe(199);
    expect(stepToBar({ ...d, frame: 199, dir: 1 })).toBe(199);
  });
  it("back goes to the bar line before; while playing it skips one just passed", () => {
    expect(stepToBar({ ...d, frame: 75, dir: -1 })).toBe(60);
    expect(stepToBar({ ...d, frame: 61, dir: -1 })).toBe(60);
    expect(stepToBar({ ...d, frame: 62, dir: -1, playing: true })).toBe(0);
    expect(stepToBar({ ...d, frame: 120, dir: -1 })).toBe(60);
    expect(stepToBar({ ...d, frame: 10, dir: -1 })).toBe(0);
  });
  it("ignores bar lines outside the video and unsorted input", () => {
    expect(stepToBar({ barFrames: [300, 90, -5, 30], durationInFrames: 200, frame: 40, dir: 1 })).toBe(90);
    expect(stepToBar({ barFrames: [], durationInFrames: 200, frame: 40, dir: 1 })).toBe(199);
  });
  it("one frame steps stay inside the video", () => {
    expect(stepFrame(0, 200, -1)).toBe(0);
    expect(stepFrame(199, 200, 1)).toBe(199);
    expect(stepFrame(50, 200, 1)).toBe(51);
  });
});
