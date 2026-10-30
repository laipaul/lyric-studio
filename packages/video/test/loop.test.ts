// "Loop flows" (Reels, TikTok, Shorts loop on the platform): beat, phrase, sound, harmony and picture
// across the wrap-around; the auto section's end that flows best back into its start; shuffle never
// puts the same clip first and last.
import { describe, expect, it } from "vitest";

import {
  assignClips, autoSection, getCutPoints, loopFit, loopFlows, loopSuggestions, runQa, sungEnd, sungStart, titleLeadMs,
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

  it("phrase with the title opening: a start up to the title lead before the first sung line passes, further back fails", () => {
    // The title opening starts the section up to 2 bars (4.0 s here) before the first sung line.
    const early = { ...clean, lines: LINES.map((l) => ({ ...l, sungStartMs: l.sungStartMs + 3_000, sungEndMs: l.sungEndMs + 1_000 })), audio: clockAudio }; // first line 3.5 s after the start
    expect(point(loopFlows(early), "phrase").ok).toBe(false); // without the allowance nothing changes
    const withLead = loopFlows({ ...early, titleLeadMs: 4_000 });
    expect(point(withLead, "phrase").ok).toBe(true);
    expect(withLead.ok).toBe(true);
    // One bar and the 2-bar lead exactly: still fine; 4.5 s before the line is more than the lead.
    const tooFar = loopFlows({ ...early, titleLeadMs: 4_000, lines: LINES.map((l) => ({ ...l, sungStartMs: l.sungStartMs + 4_000, sungEndMs: l.sungEndMs + 1_000 })) });
    expect(point(tooFar, "phrase").ok).toBe(false);
    expect(point(tooFar, "phrase").detail).toBe('phrase: the first sung line (line 4 "You had a heart for two") begins 4.5 s after the start, more than 4.0 s, the title opening\'s lead-in');
    // The lead never replaces the other phrase rules: an end inside a sung line still fails.
    const cut = loopFlows({ ...early, titleLeadMs: 4_000, lines: [...early.lines.slice(0, 2), { ...early.lines[2], sungEndMs: 41_000 }] });
    expect(point(cut, "phrase").ok).toBe(false);
  });

  it("the title lead is what the auto section allows: 2 bars, or 1 when 2 bars are longer than 5 s", () => {
    expect(titleLeadMs([0, 2000, 4000, 6000])).toBe(4000);
    expect(titleLeadMs([0, 3000, 6000, 9000])).toBe(3000);
    expect(titleLeadMs([])).toBe(4000); // no bars detected: 2 s bars
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

describe("better loops: target lengths whose end flows back into the start (the storyboard's hint)", () => {
  // Bars every 2 s from 0:00.5; line 6 ends at 0:38.0, so 0:38.5 is the clean end after it (28 s).
  const downbeats = Array.from({ length: 30 }, (_, i) => 500 + i * 2000);
  const base = { bpm: 120, startMs: 10_500, downbeats, lines: LINES, durationMs: 60_000 };

  it("only clean ends right after a sung line, in 0.5-1.5x the target, that pass beat, level and harmony", () => {
    const s = loopSuggestions({ ...base, audio: clockAudio, targetMs: 30_000 });
    // 0:14.5 (after line 4: 4 s, below half the target) is out; 0:20.5 (after line 5, 10 s) too; 0:40.5 is
    // not the first bar after a line (an instrumental bar more).
    expect(s.map((x) => [x.lengthS, x.line?.number])).toEqual([[28, 6]]);
    expect(s[0].fit.text).toMatch(/^whole bars, level jump \d\.\d dB, harmony/);
    expect(loopSuggestions({ ...base, audio: clockAudio, targetMs: 14_000 }).map((x) => x.lengthS)).toEqual([10]); // 0:20.5, after line 5
  });

  it("an end with a level jump is not suggested", () => {
    const loudEnd = song([{ fromMs: 36_500, toMs: 38_500, gain: 2 }]);
    expect(loopSuggestions({ ...base, audio: loudEnd, targetMs: 30_000 })).toEqual([]);
  });
});

describe("beat: the song's own detected bars (a real song drifts a little)", () => {
  // Bars alternate 1.775 s / 1.785 s (average 1.78 s = 134.8 BPM) from 0:10; the song's BPM says 135.
  const drift = (n: number) => {
    const t = [10_000];
    for (let i = 0; i < n; i++) t.push(t[i] + (i % 2 === 0 ? 1775 : 1785));
    return t;
  };
  const downbeats = drift(90);
  const startMs = downbeats[10];
  const endMs = downbeats[61]; // 51 bars later
  const lengthMs = endMs - startMs;
  const base = { lengthMs, bpm: 135, startMs, endMs, lines: [] as LoopLine[], audio: null, firstClip: null, lastClip: null, shots: 10, continues: false };

  it("51 detected bars pass although the average BPM would say 51.1 bars", () => {
    const old = loopFlows(base); // no downbeats: the old division
    expect(point(old, "beat").ok).toBe(false);
    expect(point(old, "beat").detail).toMatch(/51\.0\d bars at 135 BPM/);
    const r = loopFlows({ ...base, downbeats });
    expect(point(r, "beat").ok).toBe(true);
    expect(point(r, "beat").detail).toBe(`${(lengthMs / 1000).toFixed(1)} s = 51 bars (on the song's detected bars, avg 134.8 BPM)`);
    expect(r.bars).toBe(51);
    expect(r.bar_s).toBeCloseTo(1.78, 3);
    expect(r.beat_off_ms).toBe(0);
  });

  it("an end 0.25 s past a bar line fails and says how far off it is", () => {
    const r = loopFlows({ ...base, downbeats, lengthMs: lengthMs + 250, endMs: endMs + 250 });
    const p = point(r, "beat");
    expect(p.ok).toBe(false);
    expect(p.detail).toMatch(/the end \(.*\) is 0\.25 s \(0\.6 beats\) after the nearest detected bar line/);
    expect(r.beat_off_ms).toBe(250);
    expect(r.ok).toBe(false);
  });

  it("a video whose length does not match its section fails the beat point", () => {
    const r = loopFlows({ ...base, downbeats, lengthMs: lengthMs + 200 });
    expect(point(r, "beat").ok).toBe(false);
    expect(point(r, "beat").detail).toMatch(/section in the song/);
  });

  it("loopSuggestions on a drifting grid returns ends on detected bars (the beat passes)", () => {
    const lines: LoopLine[] = [{ number: 1, text: "A line", sungStartMs: startMs + 500, sungEndMs: downbeats[30] - 600 }];
    const s = loopSuggestions({ audio: null, bpm: 135, startMs, downbeats, lines, targetMs: downbeats[30] - startMs, durationMs: 200_000 });
    expect(s.map((x) => x.endMs)).toEqual([downbeats[30]]);
    expect(s[0].fit.text).toBe("whole bars");
    expect(loopFit(null, 135, startMs, endMs).ok).toBe(false); // 51 bars: the old division would have refused it
    expect(loopFit(null, 135, startMs, endMs, downbeats).ok).toBe(true);
  });
});
