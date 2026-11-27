// Best shot for each line across music videos (pure).
import { describe, expect, it } from "vitest";

import { faceBadWhileSung, pickBestShots, scoreCandidate, type BestCandidate, type BestLine } from "../src/mv-best";

const lines: BestLine[] = [
  { number: 1, text: "one", shownMs: 2000, sungEndMs: 3500 },
  { number: 2, text: "two", shownMs: 5000, sungEndMs: 6500 },
  { number: 3, text: "three", shownMs: 8000, sungEndMs: 9500 },
];
const cand = (o: Partial<BestCandidate> & Pick<BestCandidate, "video" | "shot" | "first" | "last" | "songFromMs" | "songToMs">): BestCandidate => ({ label: o.video, resolution: "720p", match: 1, faceBadMs: 0, sim: 0.6, take: null, inUse: false, ...o });

describe("best shot per line", () => {
  it("scores in plain words: face, whole line, room, size", () => {
    const good = scoreCandidate(cand({ video: "A", shot: 0, first: 1, last: 1, songFromMs: 1000, songToMs: 4500 }), lines);
    expect(good.reasons).toEqual(["same face all along", "close to your picture", "the whole line in one shot", "room before and after"]);
    const cut = scoreCandidate(cand({ video: "B", shot: 0, first: 1, last: 1, songFromMs: 1000, songToMs: 3000 }), lines);
    expect(cut.reasons).toContain("its cut comes before the line ends");
    const bad = scoreCandidate(cand({ video: "C", shot: 0, first: 1, last: 1, songFromMs: 1000, songToMs: 4500, faceBadMs: 400 }), lines);
    expect(bad.reasons[0]).toBe("the face goes wrong while she sings");
    expect(good.score).toBeGreaterThan(cut.score);
    expect(cut.score).toBeGreaterThan(bad.score);
    const hd = scoreCandidate(cand({ video: "A", shot: 0, first: 1, last: 1, songFromMs: 1000, songToMs: 4500, resolution: "1080p" }), lines);
    expect(hd.score).toBeGreaterThan(good.score);
    expect(hd.reasons).toContain("1080p");
  });

  it("picks the best per line, never overlapping, and changes video when it is as good", () => {
    const c = [
      cand({ video: "A", shot: 0, first: 1, last: 1, songFromMs: 1000, songToMs: 4500 }),
      cand({ video: "A", shot: 1, first: 2, last: 2, songFromMs: 4500, songToMs: 7500 }),
      cand({ video: "B", shot: 0, first: 2, last: 2, songFromMs: 4500, songToMs: 7500 }),
      cand({ video: "A", shot: 2, first: 3, last: 3, songFromMs: 7500, songToMs: 10_500 }),
      cand({ video: "B", shot: 1, first: 2, last: 3, songFromMs: 4000, songToMs: 10_500, faceBadMs: 300 }),
    ];
    const rows = pickBestShots(lines, c, new Map());
    expect(rows.map((r) => [r.first, r.last, r.pick?.video, r.pick?.shot])).toEqual([
      [1, 1, "A", 0],
      [2, 2, "B", 0], // as good as A's: another video than the line before
      [3, 3, "A", 2],
    ]);
    expect(rows[1].pick?.reasons).toContain("another video than the line before");
    expect(rows[1].others.map((o) => [o.video, o.shot])).toEqual([["A", 1], ["B", 1]]);
    // The same inputs: the same plan.
    expect(pickBestShots(lines, [...c].reverse(), new Map())).toEqual(rows);
  });

  it("never touches a line Paul set himself, and a shot over it is left out", () => {
    const c = [
      cand({ video: "A", shot: 0, first: 1, last: 2, songFromMs: 1000, songToMs: 7000 }),
      cand({ video: "B", shot: 0, first: 1, last: 1, songFromMs: 1000, songToMs: 4500 }),
      cand({ video: "B", shot: 1, first: 2, last: 2, songFromMs: 4500, songToMs: 7500 }),
      cand({ video: "B", shot: 2, first: 3, last: 3, songFromMs: 7500, songToMs: 10_500 }),
    ];
    const rows = pickBestShots(lines, c, new Map([[2, "hand" as const]]));
    expect(rows.map((r) => [r.first, r.last, r.pick?.video ?? null, r.locked])).toEqual([
      [1, 1, "B", null],
      [2, 2, null, "hand"],
      [3, 3, "B", null], // right after a locked line: no variety rule
    ]);
  });

  it("bad-face time counts only while a line is sung", () => {
    expect(faceBadWhileSung([{ fromS: 0.5, toS: 1.5 }], 1000, lines)).toBe(500); // 1.5-2.5 s: 2.0-2.5 is sung
    expect(faceBadWhileSung([{ fromS: 2.6, toS: 3.8 }], 1000, lines)).toBe(0); // 3.6-4.8 s: between lines
  });
});
