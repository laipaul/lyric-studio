// Breathing room in singing clips (25 Nov 2026): the voice sent to the lip-sync model is quiet outside the take's own
// sung lines (soft fades), so the mouth closes between lines; the song itself is never touched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { geminiPackPrompt, VIEWS } from "../src/node/characters/plan";
import { BREATHING, cutVoice, REST_PAD_MS, restGain, singingPrompt, singingRests } from "../src/node/singer";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-breath-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ffmpeg = (...a: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...a]);

// Mean absolute level of a mono 16-bit WAV between two seconds.
function level(file: string, fromS: number, toS: number): number {
  const b = readFileSync(file);
  const data = b.subarray(44);
  const at = (s: number) => Math.floor(s * 44100) * 2;
  let sum = 0;
  let n = 0;
  for (let i = at(fromS); i < Math.min(at(toS), data.length - 1); i += 2) {
    sum += Math.abs(data.readInt16LE(i));
    n++;
  }
  return n ? sum / n : 0;
}

describe("breathing room", () => {
  it("rests: the lead-in, the gaps between the take's lines and the tail; short gaps stay", () => {
    const lines = [
      { shownMs: 11_000, sungEndMs: 13_000 },
      { shownMs: 15_000, sungEndMs: 17_000 },
      { shownMs: 17_400, sungEndMs: 19_000 }, // 400 ms after the line before: too short to rest
    ];
    expect(singingRests(lines, { fromMs: 10_000, toMs: 22_000 })).toEqual([
      { fromMs: 10_000, toMs: 11_000 - REST_PAD_MS },
      { fromMs: 13_000 + REST_PAD_MS, toMs: 15_000 - REST_PAD_MS },
      { fromMs: 19_000 + REST_PAD_MS, toMs: 22_000 },
    ]);
    expect(singingRests([], { fromMs: 0, toMs: 5000 })).toEqual([]);
  });

  it("the voice sent is quiet in a rest and unchanged elsewhere; no rests: as before", () => {
    const song = path.join(root, "song.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ac", "1", "-ar", "44100", song);
    const plain = path.join(root, "plain.wav");
    const rested = path.join(root, "rested.wav");
    cutVoice({ kind: "song" }, song, { fromMs: 1000, toMs: 5000 }, plain);
    cutVoice({ kind: "song" }, song, { fromMs: 1000, toMs: 5000 }, rested, [{ fromMs: 2000, toMs: 3500 }, { fromMs: 4500, toMs: 5000 }]);
    const loud = level(plain, 0.2, 0.8);
    expect(loud).toBeGreaterThan(1000);
    expect(level(rested, 0.2, 0.8)).toBeCloseTo(loud, -2); // before the rest: the same
    expect(level(rested, 1.3, 2.3)).toBeLessThan(loud * 0.02); // inside: quiet
    expect(level(rested, 2.8, 3.3)).toBeCloseTo(loud, -2); // after it: back
    expect(level(rested, 3.65, 3.95)).toBeLessThan(loud * 0.02); // the tail rest to the end: quiet to the last sample
  });

  it("the gain fades at the edges inside the piece, not at the piece's own start or end", () => {
    const g = restGain([{ fromMs: 0, toMs: 1000 }], 0, 4000)!;
    expect(g).toContain("+99"); // starts quiet, no fade-in from loud
    expect(restGain([], 0)).toBeNull();
    expect(restGain([{ fromMs: 0, toMs: 500 }], 1000)).toBeNull(); // before the piece
  });

  it("Copy the Gemini prompt: the app's own words per view, outdoors, numbered", () => {
    const text = geminiPackPrompt(VIEWS, "ivory lace wedding gown");
    expect(text.split("\n\n")).toHaveLength(VIEWS.length + 1);
    expect(text).toMatch(/^Attach the reference picture/);
    expect(text).toMatch(/1\. Close-up face \(3:4\):\n/);
    expect(text).toMatch(/4\. Full body, back \(cropped at the neck\) \(2:3\):\n.*CROPPED AT THE NECK/);
    expect(text.match(/outdoor place/g)).toHaveLength(VIEWS.length);
    expect(text).toContain("ivory lace wedding gown");
  });

  it("the prompt says it only for a take with breathing room", () => {
    expect(singingPrompt("x", undefined, "natural", undefined, undefined, true)).toContain(BREATHING);
    expect(singingPrompt("x", undefined, "natural")).not.toContain(BREATHING);
  });
});
