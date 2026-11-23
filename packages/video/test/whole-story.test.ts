// A Mini film is the whole song on every platform (23 Nov 2026, Paul: "when I pick Mini film … I want the whole song,
// don't limit me, I decide"): the automatic part of the song is 0:00 to the song's end; a part chosen by hand wins.
import { describe, expect, it } from "vitest";

import { chooseSection, loadPresets } from "../src/node/make";
import { grid } from "./helpers";

const beats = grid(120, 480, 0);
const durationMs = 215_000;
const lines = Array.from({ length: 40 }, (_, i) => ({ text: `Line ${i + 1}`, start_ms: 12_000 + i * 4000, end_ms: 16_000 + i * 4000, sung_end_ms: 15_000 + i * 4000, isHook: i === 9 }));

describe("Mini film: the whole song on every platform", () => {
  const presets = loadPresets();
  it("Reels, TikTok and Shorts play the whole song from 0:00 (no platform length), without it a part near the hook", () => {
    for (const name of ["reels", "tiktok", "shorts"]) {
      const whole = chooseSection("auto", lines, beats, durationMs, 250, presets[name], undefined, undefined, false, undefined, true);
      expect([whole.start_ms, whole.end_ms, whole.mode]).toEqual([0, durationMs, "full"]);
      expect(whole.reason).toContain("Mini film");
      const part = chooseSection("auto", lines, beats, durationMs, 250, presets[name]);
      expect(part.end_ms - part.start_ms).toBeLessThan(durationMs);
    }
  });
  it("a part chosen by hand still wins", () => {
    const hand = chooseSection("0:30-1:30", lines, beats, durationMs, 250, presets.reels, undefined, undefined, false, undefined, true);
    expect([hand.start_ms, hand.end_ms]).toEqual([30_000, 90_000]);
  });
});
