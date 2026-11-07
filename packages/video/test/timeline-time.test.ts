// The Shape page's timeline clock: ruler labels, the playhead bubble and the song time.
import { describe, expect, it } from "vitest";

import { clockTenths, clockTick, playheadLabel, songTimeMs, timeTicks } from "../src";

describe("timeline clock", () => {
  it("reads minutes, seconds and tenths, never ahead of the frame", () => {
    expect(clockTenths(28_466)).toBe("0:28.4");
    expect(clockTenths(62_600)).toBe("1:02.6");
    expect(clockTenths(0)).toBe("0:00.0");
    expect(clockTenths(-50)).toBe("0:00.0");
    expect(clockTick(15_000)).toBe("0:15");
    expect(clockTick(75_500)).toBe("1:15.5");
  });

  it("song time = the section's start + the time in the video (Let My Love Carry You: Reel 0:30 = line 9 at 1:04.8)", () => {
    expect(songTimeMs(30_600, 34_200)).toBe(64_800);
    expect(playheadLabel(28_400, 34_200)).toEqual({ video: "0:28.4", song: "1:02.6" });
    expect(playheadLabel(5_000, 0)).toEqual({ video: "0:05.0", song: null }); // a whole-song video: one clock
  });

  it("labels every 2 s at 1x, every second at 2x, every half second at 4x, with a tick in between", () => {
    const at = (px: number) => timeTicks(10_000, px).filter((t) => t.label).map((t) => t.label);
    expect(at(40)).toEqual(["0:00", "0:02", "0:04", "0:06", "0:08", "0:10"]);
    expect(at(80).slice(0, 3)).toEqual(["0:00", "0:01", "0:02"]);
    expect(at(160).slice(0, 4)).toEqual(["0:00", "0:00.5", "0:01", "0:01.5"]);
    expect(timeTicks(10_000, 80).map((t) => t.ms).slice(0, 3)).toEqual([0, 500, 1000]);
    expect(timeTicks(78_000, 80).at(-1)).toEqual({ ms: 78_000, label: "1:18" });
  });
});
