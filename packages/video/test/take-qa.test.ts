// Takes QA (26 Nov 2026, Paul: "Aiko take 2 at ~0:09: the face turns into a flat white mask"; "why was this take 13 s
// when slots are capped at ~8 s"): the frames judged (collapse, drift, lost), groups split at sung-line boundaries into
// takes of at most 8 s, the check saved on a take, and Trim to good part.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { judgeTake, qaWords, type TakeFrame } from "../src/take-qa";
import { readPictures, update } from "../src/node/animate";
import { stubFace } from "../src/node/characters/stub";
import { splitRun } from "../src/node/singer";
import { checkTake, trimTake } from "../src/node/take-qa";

const steady = (t: number): TakeFrame => ({ t, face: true, sim: 0.82, sharp: 160, texture: 8, bright: 120 });
const frames = (n: number, bad: (t: number) => TakeFrame | null) => Array.from({ length: n }, (_, i) => bad(i / 5) ?? steady(i / 5));

describe("judging a take's frames", () => {
  it("a steady face: no segment, the whole take is good", () => {
    const q = judgeTake(frames(50, () => null), 10);
    expect(q.segments).toEqual([]);
    expect(q.good).toEqual({ fromS: 0, toS: 10 });
    expect(qaWords(q)).toBeNull();
  });
  it("the face turns into a flat white mask at 9 s: 'face collapse from 0:09'; the good part is 0-9 s", () => {
    const q = judgeTake(frames(65, (t) => (t >= 9 ? { t, face: true, sim: 0.4, sharp: 30, texture: 1.1, bright: 235 } : null)), 13);
    expect(q.segments).toEqual([{ fromS: 9, toS: 13, kind: "face collapse" }]);
    expect(q.good).toEqual({ fromS: 0, toS: 9 });
    expect(qaWords(q)).toBe("face collapse from 0:09");
  });
  it("the face turns into another person (similarity drops) or disappears; a short blip is ignored", () => {
    const drift = judgeTake(frames(50, (t) => (t >= 4 && t < 6 ? { t, face: true, sim: 0.35, sharp: 150, texture: 7.5 } : null)), 10);
    expect(drift.segments).toEqual([{ fromS: 4, toS: 6, kind: "face drift" }]);
    const lost = judgeTake(frames(50, (t) => (t >= 7 ? { t, face: false } : null)), 10);
    expect(lost.segments[0]).toMatchObject({ fromS: 7, kind: "face lost" });
    const blip = judgeTake(frames(50, (t) => (t === 3 ? { t, face: true, sim: 0.2, sharp: 160, texture: 8 } : null)), 10);
    expect(blip.segments).toEqual([]);
  });
});

describe("takes of at most 8 s, split where a line ends", () => {
  it("as many lines as fit per take; a long line alone stays whole", () => {
    const len: Record<number, number> = { 21: 7000, 22: 5000, 23: 2500, 24: 2500 }; // a take of lines a..b lasts the sum
    const fits = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => len[a + i]).reduce((x, y) => x + y, 0) <= 8000;
    expect(splitRun({ source: "aiko.png", first: 21, last: 24 }, fits)).toEqual([
      { source: "aiko.png", first: 21, last: 21 },
      { source: "aiko.png", first: 22, last: 23 },
      { source: "aiko.png", first: 24, last: 24 },
    ]);
    expect(splitRun({ source: "a.png", first: 5, last: 5 }, () => false)).toEqual([{ source: "a.png", first: 5, last: 5 }]);
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-takeqa-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the check on a take, and Trim to good part", () => {
  const dir = path.join(root, "pictures");
  mkdirSync(path.join(dir, "takes"), { recursive: true });
  const src = "aiko close-up.png";
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=96x160", "-frames:v", "1", path.join(dir, src)]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=96x160:r=25:d=6", "-pix_fmt", "yuv420p", path.join(dir, "takes", "aiko sings line 21.mp4")]);
  update(dir, src, (p) => {
    p.takes.push({ n: 1, kind: "lipsync", line: 21, through: 22, sync_ms: 126_000, to_ms: 132_000, style: 1, service: "wavespeed", quality: "draft", model: "InfiniteTalk", status: "done", started_at: "", cost_usd: 0.18, file: "takes/aiko sings line 21.mp4" });
  });
  it("saved on the take, after it comes back (the face engine's stand-in collapses from 4 s)", async () => {
    process.env.LYRIC_TAKEQA_COLLAPSE_FROM = "4";
    try {
      const q = await checkTake(dir, src, 1, stubFace());
      expect(q?.segments[0]).toMatchObject({ fromS: 4, kind: "face collapse" });
    } finally {
      delete process.env.LYRIC_TAKEQA_COLLAPSE_FROM;
    }
    expect(readPictures(dir).pictures[src].takes[0].qa?.segments[0].kind).toBe("face collapse");
  });
  it("Trim to good part: a new take of 0-4 s at the same song time, the lines it still covers; the original stays", () => {
    const made = trimTake(dir, src, 1, [{ number: 21, sungEndMs: 129_000 }, { number: 22, sungEndMs: 131_500 }]);
    expect(made).toMatchObject({ trimmedOf: 1, line: 21, sync_ms: 126_000, to_ms: 130_000, status: "done", cost_usd: 0 });
    expect(made.through).toBeUndefined(); // line 22 ends after the cut: it needs a take again
    expect(existsSync(path.join(dir, made.file!))).toBe(true);
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, made.file!)], { encoding: "utf8" }));
    expect(seconds).toBeGreaterThan(3.8);
    expect(seconds).toBeLessThan(4.2);
    expect(readPictures(dir).pictures[src].takes.find((x) => x.n === 1)?.file).toBe("takes/aiko sings line 21.mp4");
  });
  it("refused when the face goes wrong before the first line is sung to its end", () => {
    expect(() => trimTake(dir, src, 1, [{ number: 21, sungEndMs: 131_000 }])).toThrow(/before line 21 is sung to its end/);
  });
});
