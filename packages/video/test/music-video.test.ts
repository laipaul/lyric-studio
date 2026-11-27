// A music video made elsewhere (27 Nov 2026): where it sits in the song, its shots, the lines of each shot.
import { describe, expect, it } from "vitest";

import { bestLag, detectCuts, EDGE_TRIM_MS, findInSong, linesOfShot, matchScore, mvShotsForPlanned, mvUsd, shotPiece, shotsFromCuts } from "../src/music-video";

// A song-like signal: noise shaped by a slowly changing loudness (seeded, the same every run).
function song(seconds: number, rate: number, seed = 1): Float32Array {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const out = new Float32Array(seconds * rate);
  for (let i = 0; i < out.length; i++) out[i] = rnd() * (0.3 + 0.25 * Math.sin(i / rate) + 0.2 * Math.sin((i / rate) * 3.7));
  return out;
}

describe("where a music video sits in the song", () => {
  const rate = 2000;
  const s = song(60, rate);
  it("a piece cut from the song is found at its place, to the sample, with no drift", () => {
    const from = 17.3;
    const v = s.slice(Math.round(from * rate), Math.round((from + 20) * rate));
    const r = findInSong(v, s, rate);
    expect(r.offsetMs).toBeCloseTo(17300, 0);
    expect(r.score).toBeGreaterThan(0.99);
    expect(r.driftMs).toBe(0);
  });
  it("the whole song: offset 0", () => {
    expect(findInSong(s, s, rate).offsetMs).toBe(0);
  });
  it("a slightly different copy (re-encoded: a little noise, a little quieter) still matches", () => {
    const v = s.slice(10 * rate, 30 * rate).map((x, i) => 0.9 * x + 0.02 * Math.sin(i));
    const r = findInSong(v, s, rate);
    expect(r.offsetMs).toBeCloseTo(10000, 0);
    expect(r.score).toBeGreaterThan(0.95);
  });
  it("another recording does not match", () => {
    const r = findInSong(song(20, rate, 99), s, rate);
    expect(r.score).toBeLessThan(0.3);
  });
  it("bestLag and matchScore agree on a known lag", () => {
    const a = new Float64Array([0, 0, 1, 3, 2, 0, 0, 0]);
    const b = new Float64Array([0, 0, 0, 0, 0, 1, 3, 2, 0, 0, 0, 0]);
    expect(bestLag(a, b)).toBe(3);
    expect(matchScore(Float32Array.from(a), Float32Array.from(b), 3)).toBeCloseTo(1, 5);
  });
});

describe("its shots", () => {
  // 25 fps, quiet frames (~0.001) with a little motion, a crossfade cut (two frames high) at 4 s and 9 s, a soft cut
  // between two similar shots at 13 s (low scores, still far above the frames around it), a burst of motion at 6 s.
  const frames = Array.from({ length: 25 * 16 }, (_, i) => {
    const t = i / 25;
    const at = (x: number) => Math.abs(t - x) < 0.001;
    const score = at(4) || at(4.04) ? 0.13 : at(9) || at(9.04) ? 0.06 : at(13) ? 0.012 : at(13.04) ? 0.016 : t > 6 && t < 6.5 ? 0.004 : 0.0008 + 0.0004 * Math.sin(i);
    return { t, score };
  });
  it("finds the crossfade cuts and the soft cut, once each, not the motion", () => {
    expect(detectCuts(frames)).toEqual([4000, 9000, 13000]);
  });
  it("shots between the cuts; a sliver under a second joins the shot before", () => {
    expect(shotsFromCuts([4000, 9000, 13000], 16000)).toEqual([
      { fromMs: 0, toMs: 4000 },
      { fromMs: 4000, toMs: 9000 },
      { fromMs: 9000, toMs: 13000 },
      { fromMs: 13000, toMs: 16000 },
    ]);
    expect(shotsFromCuts([4000, 4600, 9000], 9500)).toEqual([
      { fromMs: 0, toMs: 4600 },
      { fromMs: 4600, toMs: 9500 },
    ]);
  });
});

describe("the lines of a shot", () => {
  const lines = [
    { number: 9, shownMs: 50_200, sungEndMs: 53_000 },
    { number: 10, shownMs: 53_400, sungEndMs: 57_100 },
    { number: 11, shownMs: 57_300, sungEndMs: 61_000 },
  ];
  it("a line belongs to the shot it shows in (song time = video time + the offset)", () => {
    // The video starts at song 48.9 s: its shot 1.0-8.2 s is song 49.9-57.1 s.
    expect(linesOfShot({ fromMs: 1000, toMs: 8200 }, 48_900, lines)).toEqual({ first: 9, last: 10 });
    // A line shown a moment before the cut (within the lead) belongs to the shot after it.
    expect(linesOfShot({ fromMs: 8600, toMs: 12_000 }, 48_900, lines)).toEqual({ first: 11, last: 11 });
    expect(linesOfShot({ fromMs: 20_000, toMs: 24_000 }, 48_900, lines)).toBeNull();
  });
  it("the piece: crossfade frames left out; on to the end of its last line when the generator cut before it", () => {
    expect(shotPiece({ fromMs: 4000, toMs: 9000 }, 0, 16_000, null)).toEqual({ fromMs: 4000 + EDGE_TRIM_MS, toMs: 9000 - EDGE_TRIM_MS });
    expect(shotPiece({ fromMs: 0, toMs: 4000 }, 0, 16_000, 4500)).toEqual({ fromMs: 0, toMs: 4800 });
    expect(shotPiece({ fromMs: 13_000, toMs: 16_000 }, 0, 16_000, null).toMs).toBe(16_000);
  });
  it("its cost on WaveSpeed: per second of song, by resolution", () => {
    expect(mvUsd(232_000, 464, 832)).toBe(6.96);
    expect(mvUsd(101_000, 1280, 720)).toBe(6.06);
  });
});

describe("music-video shots next to the planned shots", () => {
  const shots = [
    { id: "a", songFromMs: 0, songToMs: 4000, first: null, last: null },
    { id: "b", songFromMs: 4000, songToMs: 9000, first: 1, last: 2 },
    { id: "c", songFromMs: 9000, songToMs: 12_000, first: 3, last: 3 },
  ];
  it("a singing shot only next to a planned shot on its lines", () => {
    expect(mvShotsForPlanned({ line: 2, span: { startMs: 8000, endMs: 11_000 } }, shots).map((s) => s.id)).toEqual(["b"]);
    expect(mvShotsForPlanned({ line: 4, span: { startMs: 9000, endMs: 12_000 } }, shots)).toEqual([]);
  });
  it("a shot without a line by shared time; a planned shot without a line takes singing shots by time too", () => {
    expect(mvShotsForPlanned({ line: null, span: { startMs: 0, endMs: 3000 } }, shots).map((s) => s.id)).toEqual(["a"]);
    expect(mvShotsForPlanned({ line: null, span: { startMs: 3500, endMs: 8000 } }, shots).map((s) => s.id)).toEqual(["b"]);
    expect(mvShotsForPlanned({ line: null, span: null }, shots)).toEqual([]);
  });
});
