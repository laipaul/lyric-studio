// Instrumental songs: story.txt parsed and timed by the app, the strongest stretch of the music for a
// short-form section, a new shot at each story sentence.
import { describe, expect, it } from "vitest";

import { autoSection, getCutPoints, parseStory, planStory, rmsLevel, storyReadMs, strongestStretch } from "../src";
import { grid } from "./helpers";

// 120 BPM: a beat every 500 ms from 0, a bar every 2 s; 3 minutes.
const beats = grid(120, 360, 0);
const durationMs = 180_000;
const bars = beats.filter((b) => b.is_downbeat).map((b) => b.time_ms);

describe("story.txt", () => {
  it("one sentence per line, a blank line is a pause, hook markers dropped", () => {
    expect(parseStory("﻿There's a secret place\n\n\n* My path always leads me there\r\nTea with the monk\n")).toEqual([
      { text: "There's a secret place", pauseBefore: false },
      { text: "My path always leads me there", pauseBefore: true },
      { text: "Tea with the monk", pauseBefore: false },
    ]);
    expect(parseStory("\n\n")).toEqual([]);
  });

  it("reading time: 1.5 s + 0.35 s a word, at least 3 s", () => {
    expect(storyReadMs("Tea")).toBe(3000);
    expect(storyReadMs("one two three four five six seven eight")).toBe(4300);
  });

  it("spreads the sentences over the music: each on a bar, shown exactly on it, long enough to read", () => {
    const story = parseStory("There's a secret place\nMy path always leads me there\n\nTea with the mountain monk\nAnd the silence speaks");
    const { lines, warnings } = planStory(story, beats, durationMs);
    expect(warnings).toEqual([]);
    expect(lines.map((l) => l.text)).toEqual(["There's a secret place", "My path always leads me there", "Tea with the mountain monk", "And the silence speaks"]);
    for (const l of lines) {
      expect(bars).toContain(l.start_ms - 250); // appears on the bar (lyric lines show 0.25 s before their stamp)
      expect(l.end_ms - l.start_ms).toBeGreaterThanOrEqual(storyReadMs(l.text));
      expect(l.sung_end_ms! - l.start_ms).toBe(Math.min(l.end_ms - l.start_ms, storyReadMs(l.text)));
      expect(l.isHook).toBe(false);
    }
    // After the intro (2 bars), before the outro (2 bars), and spread: the gaps are similar.
    expect(lines[0].start_ms - 250).toBe(4000);
    expect(lines.at(-1)!.end_ms - 250).toBeLessThanOrEqual(durationMs - 2 * 2000);
    const gaps = lines.slice(1).map((l, i) => l.start_ms - lines[i].end_ms);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(3 * 2000 + 4000); // the pause adds its bars
    expect(lines.at(-1)!.start_ms).toBeGreaterThan(durationMs / 2); // the story runs through the piece
  });

  it("too long for the music: pauses and extra time go first, then the sentences that do not fit are said", () => {
    const short = grid(120, 40, 0); // 20 s
    const story = parseStory(Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} of a story that goes on`).join("\n\n"));
    const { lines, warnings } = planStory(story, short, 20_000);
    expect(lines.length).toBeLessThan(12);
    expect(warnings[0]).toMatch(/longer than the music: \d+ sentence\(s\) from "Sentence number \d+/);
    for (const [i, l] of lines.entries()) if (i) expect(l.start_ms).toBeGreaterThanOrEqual(lines[i - 1].end_ms);
  });

  it("no story: no lines", () => {
    expect(planStory([], beats, durationMs)).toEqual({ lines: [], warnings: [] });
  });
});

describe("the strongest stretch of the music", () => {
  // Quiet from 0-60 s, loud 60-90 s, medium after.
  const rate = 1000;
  const samples = new Float32Array(180 * rate).map((_, i) => (i < 60 * rate ? 0.05 : i < 90 * rate ? 0.8 : 0.3) * Math.sin(i));
  const audio = { rate, samples };

  it("rmsLevel measures the loudness of a span", () => {
    expect(rmsLevel(audio, 60_000, 90_000)).toBeGreaterThan(rmsLevel(audio, 0, 30_000) * 5);
  });

  it("starts on a phrase (every 4 bars) whose following stretch is loudest", () => {
    const start = strongestStretch(bars, 30_000, durationMs, (a, b) => rmsLevel(audio, a, b));
    expect(start).toBe(64_000); // 4-bar phrases (every 8 s): the 30 s from 64 s hold the most loud music
    expect(bars.indexOf(start) % 4).toBe(0);
  });

  it("an instrumental section starts there, moved back to the bar before a story sentence it would cut", () => {
    const s = autoSection([], beats, { durationMs, targetMs: 30_000, minMs: 25_000, maxMs: 35_000, hardMaxMs: 40_000, shortestMs: 22_000, anchorMode: "hook-first", musicStartMs: 56_000 });
    expect(s.anchor.kind).toBe("music");
    expect(s.start_ms).toBe(56_000);
    expect(s.end_ms - s.start_ms).toBeGreaterThanOrEqual(25_000);
    expect(s.reason).toContain("the strongest stretch of the music");
    const sentence = { text: "Tea with the monk", start_ms: 54_250, end_ms: 60_250, sung_end_ms: 58_250, isHook: false };
    const moved = autoSection([sentence], beats, { durationMs, targetMs: 30_000, anchorMode: "hook-first", musicStartMs: 56_000 });
    expect(moved.start_ms).toBe(54_000);
    expect(moved.reason).toContain('moved back to the bar before "Tea with the monk"');
  });
});

describe("a new shot at each story sentence", () => {
  it("automatic pacing cuts on the bar each sentence appears on", () => {
    const at = [10_000, 23_000 + 250 - 250, 31_000]; // on-screen times (bars at 10, 22, 30 s with 23 inside a bar: the bar at 22)
    const plan = getCutPoints(beats, { start_ms: 0, end_ms: 40_000 }, { cutRate: "1x", pace: { hookBars: 2, verseBars: 3, minShotMs: 3000 }, cutAtMs: at });
    const cutBeats = plan.cuts.map((c) => c.beat_time_ms);
    expect(cutBeats).toEqual(expect.arrayContaining([10_000, 22_000, 30_000]));
    // Never a shot under the minimum around a forced cut.
    const frames = [0, ...plan.cuts.map((c) => c.frame), plan.end_frame];
    for (let i = 1; i < frames.length; i++) expect(frames[i] - frames[i - 1]).toBeGreaterThanOrEqual(24);
  });
});
