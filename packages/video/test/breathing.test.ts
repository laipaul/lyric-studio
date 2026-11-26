// Breathing room in singing clips (25 Nov 2026): the voice sent to the lip-sync model is quiet outside the take's own
// sung lines (soft fades), so the mouth closes between lines; the song itself is never touched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { geminiPackPrompt, VIEWS } from "../src/node/characters/plan";
import { BREATHING, cutVoice, REST_PAD_MS, REST_SAFE_MS, restGain, singingPrompt, voiceRests } from "../src/node/singer";

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
  // Measured on the audio (26 Nov 2026, Paul's take of line 21): the previous line's tail in the lead-in and the pickup
  // "Oh" sung before the line's timed start are sent; only the real silences are quieted (timing-based rests are gone).
  it("rests are measured on the voice: the previous tail and the pickup stay, only real silence rests", () => {
    const voice = path.join(root, "vocal.wav");
    // tone 0-1.0 s (previous line's tail), silence 1.0-1.8 s, tone 1.8-4.0 s (pickup from 1.8 s, line timed at 2.1 s), silence to 6 s
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=300:duration=6", "-af", "volume='if(between(t,0,1)+between(t,1.8,4),0.5,0)':eval=frame", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", voice);
    const piece = { fromMs: 0, toMs: 6000 };
    const rests = voiceRests({ kind: "song" }, voice, piece, 2100);
    expect(rests).toHaveLength(2);
    const near = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThanOrEqual(80);
    near(rests[0].fromMs, 1000 + REST_PAD_MS);
    near(rests[0].toMs, 1800 - REST_PAD_MS);
    near(rests[1].fromMs, 4000 + REST_PAD_MS);
    expect(rests[1].toMs).toBe(6000);
    for (const r of rests) {
      expect(r.toMs <= 1000 || r.fromMs >= 1000).toBe(true); // the previous tail is in no rest
      expect(r.toMs <= 1800 - REST_PAD_MS + 80 || r.fromMs >= 4000).toBe(true); // nor the pickup (from 1.8 s)
    }
    const sent = path.join(root, "sent.wav");
    cutVoice({ kind: "song" }, voice, piece, sent, rests);
    const loud = level(sent, 0.2, 0.8);
    expect(loud).toBeGreaterThan(1000);
    expect(level(sent, 1.9, 2.0)).toBeGreaterThan(loud * 0.8); // the pickup is heard
    expect(level(sent, 0.2, 0.9)).toBeGreaterThan(loud * 0.8); // the previous tail is heard
    expect(level(sent, 1.4, 1.5)).toBeLessThan(loud * 0.02); // the real pause is quiet
    expect(level(sent, 5, 5.9)).toBeLessThan(loud * 0.02);
  });

  it("never within 600 ms before the first line's timed start; no voice or a failure: no rests", () => {
    const voice = path.join(root, "gap.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=300:duration=5", "-af", "volume='if(between(t,0,0.5)+between(t,3.5,5),0.5,0)':eval=frame", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", voice);
    const r = voiceRests({ kind: "song" }, voice, { fromMs: 0, toMs: 5000 }, 3000);
    expect(r.every((x) => x.toMs <= 3000 - REST_SAFE_MS || x.fromMs >= 3000)).toBe(true);
    expect(r.length).toBeGreaterThan(0);
    const quiet = path.join(root, "quiet.wav");
    ffmpeg("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "3", "-c:a", "pcm_s16le", quiet);
    expect(voiceRests({ kind: "song" }, quiet, { fromMs: 0, toMs: 3000 })).toEqual([]);
    expect(voiceRests({ kind: "song" }, path.join(root, "missing.wav"), { fromMs: 0, toMs: 3000 })).toEqual([]);
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
