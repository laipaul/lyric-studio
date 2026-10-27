// "Checked by ear" (Lyrics tab): clears a line's timing WARNs in QA while the alignment, the words and
// the line's start stay the same.
import { describe, expect, it } from "vitest";

import { checkedByEar, checkedStill, parseLrc, runQa, type EarCheck, type QaInput } from "../src";

const lines = parseLrc("[00:10.00]First line\n[00:20.00]A heart for two\n[00:30.00]", 40_000);
const check: EarCheck = { number: 2, text: "A heart for two", lrc: "abc", start_ms: 20_000, at: "2026-10-27T10:00:00.000Z" };

describe("checked by ear", () => {
  it("holds while the alignment, the words and the start are the same", () => {
    expect(checkedStill(check, "abc", lines[1])).toBe(true);
    expect(checkedStill(check, "other alignment", lines[1])).toBe(false);
    expect(checkedStill(check, "abc", { ...lines[1], start_ms: 20_400 })).toBe(false); // nudged or moved
    expect(checkedStill(check, "abc", { ...lines[1], text: "A heart for three" })).toBe(false);
    expect(checkedStill({ ...check, text: "a heart, for two!" }, "abc", lines[1])).toBe(true); // case / punctuation
    expect([...checkedByEar([check, { ...check, number: 9 }], "abc", lines)]).toEqual([1]);
  });

  it("clears the line's timing WARNs in QA with a note", () => {
    const lyric = { number: 40, text: "A heart for two", confidence: 0.36, earlyMs: 1_800, review: "only words 2:52.0 (+1.4 s)", lines: 1, box: { left: 100, top: 800, right: 900, bottom: 900 } };
    const input = (checkedByEar: boolean): QaInput =>
      ({ props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 180, logo: null }, shotClips: [], poolSize: 1, lyrics: [{ ...lyric, checkedByEar }], frames: null }) as unknown as QaInput;
    const names = ["Lyric timing confidence", "Lines start with the vocals", "Line starts to review"];
    const before = runQa(input(false));
    expect(names.map((n) => before.checks.find((c) => c.name === n)!.ok)).toEqual([false, false, false]);
    const after = runQa(input(true));
    for (const n of names) expect(after.checks.find((c) => c.name === n)).toEqual({ name: n, ok: true, details: ['line 40 "A heart for two": checked by ear'] });
  });
});
