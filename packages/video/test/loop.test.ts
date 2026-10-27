// "Loop flows" (Reels, TikTok, Shorts loop on the platform): beat, phrase, sound, harmony and picture
// across the wrap-around; the auto section's end that flows best back into its start; shuffle never
// puts the same clip first and last.
import { describe, expect, it } from "vitest";

import {
  assignClips, autoSection, getCutPoints, loopFit, loopFlows, runQa, sungEnd, sungStart,
  type ClipInfo, type LoopAudio, type LoopLine, type QaInput, type SectionLine,
} from "../src";
import { grid } from "./helpers";

const RATE = 16_000;
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
const C = [48, 60, 64, 67];
const FSHARP = [42, 54, 58, 61]; // a tritone away from C: no key fits both

// A 60 s "song" holding a C major chord (4 harmonics per note); `parts` change the chord or the level
// of a stretch (ms).
function song(parts: { fromMs: number; toMs: number; notes?: number[]; gain?: number }[] = []): LoopAudio {
  const samples = new Float32Array(RATE * 60);
  const tone = (notes: number[], a: number, b: number, gain: number) => {
    for (const n of notes) for (let h = 1; h <= 4; h++) {
      const w = (2 * Math.PI * midi(n) * h) / RATE;
      for (let i = a; i < b; i++) samples[i] += ((0.05 * gain) / h) * Math.sin(w * i);
    }
  };
  const at = (ms: number) => Math.round((ms / 1000) * RATE);
  let from = 0;
  for (const p of [...parts].sort((x, y) => x.fromMs - y.fromMs)) {
    tone(C, from, at(p.fromMs), 1);
    tone(p.notes ?? C, at(p.fromMs), at(p.toMs), p.gain ?? 1);
    from = at(p.toMs);
  }
  tone(C, from, samples.length, 1);
  return { rate: RATE, samples };
}

// 120 BPM (a bar is 2 s); the section 0:10.5-0:40.5 is 15 bars; three lines inside it.
const LINES: LoopLine[] = [
  { number: 4, text: "You had a heart for two", sungStartMs: 11_000, sungEndMs: 14_000 },
  { number: 5, text: "And I had none", sungStartMs: 16_000, sungEndMs: 20_000 },
  { number: 6, text: "Now we are one", sungStartMs: 22_000, sungEndMs: 38_000 },
];
const clean = { lengthMs: 30_000, bpm: 120, startMs: 10_500, endMs: 40_500, lines: LINES, firstClip: "01_beach.mp4", lastClip: "05_dance.mp4", shots: 12, continues: false };
const point = (r: ReturnType<typeof loopFlows>, name: string) => r.points.find((p) => p.point === name)!;
const clockAudio = song();

describe('QA "Loop flows"', () => {
  it("a clean loop passes all five points", () => {
    const r = loopFlows({ ...clean, audio: clockAudio });
    expect(r.points.map((p) => [p.point, p.ok])).toEqual([["beat", true], ["phrase", true], ["sound", true], ["harmony", true], ["picture", true]]);
    expect(r.ok).toBe(true);
    expect(point(r, "beat").detail).toBe("30.0 s = 15 bars at 120 BPM");
    expect(r.level_jump_db).toBeLessThan(1.5); // a held chord: its notes beat a little
    expect(r.harmony).toMatchObject({ lastKey: "C major", firstKey: "C major" });
    const qa = runQa(qaInput(r));
    const check = qa.checks.find((c) => c.name === "Loop flows")!;
    expect(check.ok).toBe(true);
    expect(check.details[0]).toMatch(/^30\.0 s = 15 bars at 120 BPM; ends after line 6 "Now we are one", starts 0\.5 s before line 4 .*; level jump [01]\.\d dB; harmony fits \(C major, 0\.\d\d\); 05_dance\.mp4 -> 01_beach\.mp4$/);
  });

  it("a length off by part of a bar: the beat would jump at the loop", () => {
    const r = loopFlows({ ...clean, lengthMs: 30_300, endMs: 40_800, audio: clockAudio });
    expect(point(r, "beat").ok).toBe(false);
    expect(point(r, "beat").detail).toBe("length 30.3 s is 0.3 s off a whole bar (15.15 bars at 120 BPM, 0.6 beats over; 15 bars would be 30.0 s): the beat jumps at the loop");
    expect(r.beat_off_ms).toBe(300);
    // Within 50 ms (a frame or so of rounding): still whole bars.
    expect(point(loopFlows({ ...clean, lengthMs: 30_033, endMs: 40_533, audio: clockAudio }), "beat").ok).toBe(true);
    const qa = runQa(qaInput(r));
    expect(qa.status).toBe("WARN");
    expect(qa.checks.find((c) => c.name === "Loop flows")!.details).toEqual([point(r, "beat").detail]);
  });

  it("a level jump at the end: the music's last 100 ms against its first 100 ms", () => {
    const loudEnd = song([{ fromMs: 38_500, toMs: 40_500, gain: 2 }]); // the last bar 6 dB louder
    const r = loopFlows({ ...clean, audio: loudEnd });
    expect(point(r, "sound").ok).toBe(false);
    expect(point(r, "sound").detail).toMatch(/^level jump [5-7]\.\d dB at the loop point \(the last 100 ms -\d+\.\d dB, the first 100 ms -\d+\.\d dB; allowed 3 dB\): the loop is heard as a sudden drop$/);
    expect(r.level_jump_db).toBeGreaterThan(5); // 6 dB louder, give or take the chord's beating
  });

  it("the same clip first and last makes the loop visible (unless the last shot continues into the first)", () => {
    const same = loopFlows({ ...clean, lastClip: "01_beach.mp4", audio: clockAudio });
    expect(point(same, "picture")).toEqual({ point: "picture", ok: false, detail: "the first and the last shot both show 01_beach.mp4: the loop becomes visible" });
    // The Reels loop ending: the last shot plays the frames just before the first one (seamless).
    const continued = loopFlows({ ...clean, lastClip: "01_beach.mp4", continues: true, audio: clockAudio });
    expect(point(continued, "picture").ok).toBe(true);
    expect(point(continued, "picture").detail).toContain("continues straight into the first");
  });

  it("a harmony clash: the last bar and the first bar fit no common key", () => {
    const r = loopFlows({ ...clean, audio: song([{ fromMs: 38_500, toMs: 40_500, notes: FSHARP }]) });
    expect(point(r, "harmony").ok).toBe(false);
    expect(point(r, "harmony").detail).toMatch(/^harmony clash: the last bar \(sounds like F# major\) and the first bar \(C major\) fit no common key/);
  });

  it("phrase: an end inside a sung line, or a start more than one bar before the first line", () => {
    const cut = loopFlows({ ...clean, lines: [...LINES.slice(0, 2), { ...LINES[2], sungEndMs: 41_000 }], audio: clockAudio });
    expect(point(cut, "phrase").detail).toBe('phrase: it ends inside line 6 "Now we are one" (sung until 0:41.0)');
    const late = loopFlows({ ...clean, lines: LINES.map((l) => ({ ...l, sungStartMs: l.sungStartMs + 3_000, sungEndMs: l.sungEndMs + 1_000 })), audio: clockAudio });
    expect(point(late, "phrase").detail).toBe('phrase: the first sung line (line 4 "You had a heart for two") begins 3.5 s after the start, more than one bar (2.0 s)');
  });

  it("the song not readable: sound and harmony say so, the rest is still checked", () => {
    const r = loopFlows({ ...clean, audio: null });
    expect(r.ok).toBe(true);
    expect(point(r, "sound").detail).toContain("not measured");
    expect([r.level_jump_db, r.harmony]).toEqual([null, undefined]);
  });
});

function qaInput(loop: ReturnType<typeof loopFlows>): QaInput {
  return {
    props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 900 },
    shotClips: [],
    poolSize: 4,
    lyrics: [],
    frames: null,
    loop,
  };
}

describe("the auto section's end on a loop platform", () => {
  // Hook-first from 0:10.5 (the hook at 0:11.0); two clean chorus ends in the 30 s +-15% window:
  // 0:36.5 (26 s) and 0:40.5 (30 s, the target).
  const line = (text: string, start: number, end: number): SectionLine => ({ text, start_ms: start, end_ms: end + 400, isHook: true, sung_end_ms: end });
  const lines = [line("You had a heart for two", 11_000, 14_000), line("And I had none", 15_000, 18_000), line("We were three", 19_000, 24_000), line("Now we are one", 25_000, 36_300), line("Heart for two", 37_000, 40_200), line("Again", 41_000, 49_000)];
  const beats = grid(120, 480, 500);
  const options = { durationMs: 60_000, targetMs: 30_000, minMs: 25_500, maxMs: 34_500, hardMaxMs: 39_000, shortestMs: 22_500, anchorMode: "hook-first" as const };

  it("without the loop check: the clean end nearest the target", () => {
    const s = autoSection(lines, beats, options);
    expect([s.start_ms, s.end_ms]).toEqual([10_500, 40_500]);
    expect(s.reason).not.toContain("loop:");
  });

  it("prefers the end whose last bar flows back into the start, and says why", () => {
    const audio = song([{ fromMs: 38_500, toMs: 40_500, gain: 2 }]); // 0:40.5 would jump 6 dB at the loop
    const s = autoSection(lines, beats, { ...options, loopFit: (a, b) => loopFit(audio, 120, a, b) });
    expect([s.start_ms, s.end_ms]).toEqual([10_500, 36_500]);
    expect(s.reason).toMatch(/; loop: 0:36\.5 flows best back into the start \(whole bars, level jump [01]\.\d dB, harmony 0\.\d\d\); also clean: 0:40\.5 \(whole bars, level jump [5-7]\.\d dB, harmony 0\.\d\d\)$/);
    // Never at the cost of a sung line: both ends are after a complete line.
    expect(s.cuts).toEqual([]);
    const at = s.end_ms;
    expect(lines.some((l) => sungStart(l) < at && at < sungEnd(l))).toBe(false);
  });

  it("with equally good ends, the target length decides", () => {
    const s = autoSection(lines, beats, { ...options, loopFit: (a, b) => loopFit(clockAudio, 120, a, b) });
    expect(s.end_ms).toBe(40_500);
    expect(s.reason).toContain("loop: 0:40.5 flows best back into the start");
  });
});

describe("shot order on a loop platform", () => {
  const plan = getCutPoints(grid(120, 130), { start_ms: 0, end_ms: 64_000 }, { cutRate: "2x" });
  const clips: ClipInfo[] = Array.from({ length: 5 }, (_, i) => ({ id: `clip-${i}`, duration_ms: 3_000 + i * 1_000 }));

  it("shuffle never puts the same clip first and last", () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const pool of [clips, clips.slice(0, 3)]) {
        const shots = assignClips(plan, pool, seed, { order: "shuffle" });
        expect(shots[shots.length - 1].clip_id, `seed ${seed}, ${pool.length} clips`).not.toBe(shots[0].clip_id);
      }
    }
  });

  it("a Reels loop ending whose first clip is too short to continue gets another clip at the end", () => {
    const short: ClipInfo[] = Array.from({ length: 6 }, (_, i) => ({ id: `short-${i}`, duration_ms: 1_000 }));
    for (let seed = 1; seed <= 50; seed++) {
      const shots = assignClips(plan, short, seed, { order: "shuffle", loopEnding: true });
      expect(shots[shots.length - 1].clip_id).not.toBe(shots[0].clip_id);
      expect(shots[shots.length - 1].loop).toBeUndefined();
    }
    // Long enough: the last shot continues into the first (same clip, seamless).
    const shots = assignClips(plan, clips, 7, { order: "shuffle", loopEnding: true });
    expect([shots[shots.length - 1].clip_id, shots[shots.length - 1].loop]).toEqual([shots[0].clip_id, true]);
  });
});
