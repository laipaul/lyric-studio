// "Cut while it plays": the moments of each pass and the clip time at a song time (pure).
import { describe, expect, it } from "vitest";

import { clipTimeAt, momentAt, singerMoments, storyMoments } from "../src/cut-while-playing";

describe("cut while it plays", () => {
  it("Singer pass: one moment per timed line, to the next line's start", () => {
    const m = singerMoments(
      [
        { number: 2, text: "two", startMs: 5000, sungEndMs: 7000 },
        { number: 1, text: "one", startMs: 1000, sungEndMs: 3000 },
        { number: 3, text: "not timed", startMs: null, sungEndMs: null },
      ],
      20_000,
    );
    expect(m.map((x) => [x.line, x.fromMs, x.toMs])).toEqual([
      [1, 1000, 5000],
      [2, 5000, 20_000],
    ]);
    expect(singerMoments([{ number: 1, text: "one", startMs: 1000, sungEndMs: 3000 }], null)[0].toMs).toBe(5000);
  });

  it("Story pass: planned shots with a time on the song, in song order", () => {
    const m = storyMoments([
      { id: "b", number: 2, line: 1, lineText: "one", span: { startMs: 4000, endMs: 8000 } },
      { id: "a", number: 1, line: null, lineText: null, span: { startMs: 0, endMs: 4000 } },
      { id: "c", number: 3, line: null, lineText: null, span: null },
    ]);
    expect(m.map((x) => [x.slot, x.label])).toEqual([
      ["a", "Shot 1"],
      ["b", "Shot 2"],
    ]);
  });

  it("the moment at a song time", () => {
    const m = storyMoments([0, 4000, 8000].map((t, i) => ({ id: String(i), number: i + 1, line: null, lineText: null, span: { startMs: t, endMs: t + 4000 } })));
    expect([momentAt(m, -5), momentAt(m, 0), momentAt(m, 3999), momentAt(m, 4000), momentAt(m, 99_000)]).toEqual([0, 0, 0, 1, 2]);
    expect(momentAt([], 100)).toBe(-1);
  });

  it("a clip locked to the song follows it; another plays from the moment and loops", () => {
    expect(clipTimeAt(12_500, 10_000, 11_000, 8)).toBe(2.5);
    expect(clipTimeAt(9000, 10_000, 8000, 8)).toBe(0);
    expect(clipTimeAt(17_000, null, 8000, 5)).toBe(4);
  });
});
