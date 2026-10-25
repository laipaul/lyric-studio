// Spotify Canvas helpers: the loop length in whole bars, the loop blend, the photo loop and the
// choice of the strongest clip window.
import { describe, expect, it } from "vitest";

import { CANVAS, canvasLength, canvasLengths, chooseCanvasFit, loopBlendOpacity, parseSignalStats, photoLoopProgress, strongestWindows, type FrameStats } from "../src";

describe("canvas loop length", () => {
  it("the longest whole number of bars within 3-8 s", () => {
    expect(canvasLength(120)).toEqual({ seconds: 8, bars: 4, beats: 16 }); // 2 s bars
    const odd = canvasLength(106.63); // 2.25 s bars: 3 bars = 6.75 s
    expect(odd.bars).toBe(3);
    expect(odd.seconds).toBeCloseTo(6.752, 2);
    expect(canvasLength(180).bars).toBe(6); // 1.33 s bars: 6 bars = 8 s
    for (const bpm of [70, 90, 106.63, 128, 140, 174]) {
      const l = canvasLength(bpm);
      expect(l.seconds).toBeGreaterThanOrEqual(CANVAS.minSeconds);
      expect(l.seconds).toBeLessThanOrEqual(CANVAS.maxSeconds + 1e-9);
    }
  });

  it("very slow tempos (a bar longer than 8 s) fall back to whole beats", () => {
    const slow = canvasLength(25); // 2.4 s beats, 9.6 s bars
    expect(slow.bars).toBeNull();
    expect(slow.beats).toBe(3);
    expect(slow.seconds).toBeCloseTo(7.2, 5);
  });
});

describe("canvas fallbacks: fewer bars, then slowed down, then a photo, then a clear error", () => {
  const lengths = canvasLengths(106.63); // 2.25 s bars: 3 bars (6.75 s), then 2 bars (4.50 s)
  const frames = (s: number) => Math.round(s * 30);
  it("lists every whole-bar loop of at least 3 s, longest first", () => {
    expect(lengths.map((l) => l.bars)).toEqual([3, 2]);
    expect(canvasLengths(120).map((l) => l.bars)).toEqual([4, 3, 2]); // 1 bar = 2 s is too short
  });

  it("a clip long enough: the longest loop at normal speed", () => {
    expect(chooseCanvasFit(lengths, [frames(8)], 15, 0)).toMatchObject({ fallback: "none", length: { bars: 3 }, rates: [1] });
  });

  it("1) fewer bars: a 5.2 s clip cannot make 3 bars (needs 7.3 s) but makes 2 bars at normal speed", () => {
    expect(chooseCanvasFit(lengths, [frames(5.2), frames(2)], 15, 1)).toMatchObject({ fallback: "fewer-bars", length: { bars: 2 }, rates: [1, null] });
  });

  it("2) slowed down: a 3.5 s clip plays at 0.70x to fill 2 bars (4.5 s + 0.5 s blend); never below 0.6x", () => {
    const fit = chooseCanvasFit(lengths, [frames(3.5), frames(2.9)], 15, 1);
    expect(fit.fallback).toBe("slow");
    expect(fit.length.bars).toBe(2);
    expect(fit.rates).toEqual([0.7, null]); // 2.9 s would need 0.58x
    expect(frames(3.5)).toBeGreaterThanOrEqual((frames(4.5) + 15) * fit.rates[0]!); // it really fits
  });

  it("3) a photo, 4) fail: only when no clip works even at 0.6x", () => {
    expect(chooseCanvasFit(lengths, [frames(2.9)], 15, 1).fallback).toBe("photo");
    expect(chooseCanvasFit(lengths, [frames(2.9)], 15, 0).fallback).toBe("fail");
    expect(chooseCanvasFit(lengths, [], 15, 0).fallback).toBe("fail");
  });
});

describe("canvas loop blend", () => {
  it("the copy of the frames before the start fades in over the last 0.5 s and is fully shown on the last frame", () => {
    const length = 240, blend = 15;
    expect(loopBlendOpacity(0, length, blend)).toBe(0);
    expect(loopBlendOpacity(length - blend - 1, length, blend)).toBe(0);
    expect(loopBlendOpacity(length - blend, length, blend)).toBeCloseTo(1 / 15, 5);
    expect(loopBlendOpacity(length - 1, length, blend)).toBe(1); // last frame = the frame just before frame 0
    for (let f = length - blend; f < length - 1; f++) expect(loopBlendOpacity(f + 1, length, blend)).toBeGreaterThan(loopBlendOpacity(f, length, blend));
  });

  it("a photo moves out and back, so its first and last frames match", () => {
    expect(photoLoopProgress(0)).toBe(0);
    expect(photoLoopProgress(1)).toBeCloseTo(0, 10);
    expect(photoLoopProgress(0.5)).toBeCloseTo(1, 10);
    expect(photoLoopProgress(0.25)).toBeCloseTo(0.5, 10);
  });
});

describe("strongest visual moment", () => {
  const calm: FrameStats = { ydif: 1, sat: 20, contrast: 100 };
  const lively: FrameStats = { ydif: 8, sat: 60, contrast: 200 };
  const cut: FrameStats = { ydif: 90, sat: 60, contrast: 200 };

  it("picks the liveliest, most colourful window, one per clip, best first", () => {
    const a = [...Array(20).fill(calm), ...Array(10).fill(lively), ...Array(5).fill(calm)];
    const b = Array(30).fill(calm);
    const w = strongestWindows([{ name: "b.mp4", stats: b }, { name: "a.mp4", stats: a }], 10);
    expect(w.map((x) => x.name)).toEqual(["a.mp4", "b.mp4"]);
    expect(w[0].startSample).toBe(20);
    expect(w[0].score).toBeGreaterThan(w[1].score);
  });

  it("avoids a window with a hard scene change inside, and skips clips shorter than the window", () => {
    const stats = [...Array(10).fill(lively), cut, ...Array(9).fill(lively), ...Array(10).fill(calm)];
    const w = strongestWindows([{ name: "a.mp4", stats }, { name: "short.mp4", stats: Array(5).fill(lively) }], 10);
    expect(w).toHaveLength(1);
    const s = w[0].startSample;
    const inside = stats.slice(s + 1, s + 10);
    expect(inside.includes(cut)).toBe(false);
  });

  it("reads FFmpeg signalstats output frame by frame", () => {
    const text = [
      "[Parsed_metadata_3 @ 0x1] frame:0    pts:0       pts_time:0",
      "[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YLOW=16",
      "[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YHIGH=235",
      "[Parsed_metadata_3 @ 0x1] lavfi.signalstats.SATAVG=42.5",
      "[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YDIF=0",
      "[Parsed_metadata_3 @ 0x1] frame:1    pts:3       pts_time:0.1",
      "[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YDIF=3.25",
      "[Parsed_metadata_3 @ 0x1] lavfi.signalstats.SATAVG=40",
      "[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YLOW=20",
      "[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YHIGH=200",
    ].join("\r\n");
    expect(parseSignalStats(text)).toEqual([
      { ydif: 0, sat: 42.5, contrast: 219 },
      { ydif: 3.25, sat: 40, contrast: 180 },
    ]);
  });
});
