// The storyboard's rows from a plan's props: shots with in / out, speed and badges (anchored line, best
// moment, dissolve) and their warnings (choppy slow motion, clip too short, anchor conflicts, the same
// clip too close); lines with their anchors; hook sections; the waveform.
import { describe, expect, it } from "vitest";

import { clipEdit, HOLD_NOTICE_MS, hookSections, peaks, storyLines, storyShots, type AnchorUse, type ShotProps, type StoryClip } from "../src";

const shot = (start: number, duration: number, src: string, extra: Partial<ShotProps> = {}): ShotProps => ({
  start, duration, src, clipStartFrame: 0, clipDurationFrames: 300, playbackRate: 1, holdLastFrame: false, ...extra,
});
const clip = (name: string, bestAtS: number | null = null): StoryClip => ({ name, thumb: `thumbs/${name}.jpg`, durationMs: 10_000, kind: "video", bestAtS, bestFrom: bestAtS === null ? null : "auto" });
const clips = new Map([
  ["cache/a.mp4", clip("01_a.mp4", 1)],
  ["cache/b.mp4", clip("02_b.mp4")],
  ["cache/c.mp4", clip("03_c.mp4")],
  ["cache/hands.mp4", clip("hands.mp4", 6)],
]);

describe("storyboard shots", () => {
  const shots = [
    shot(0, 60, "cache/a.mp4", { clipStartFrame: 15 }), // 0.5-2.5 s of the clip: covers its best moment (1-3 s)
    shot(60, 60, "cache/b.mp4", { playbackRate: 0.62 }), // choppy
    shot(120, 90, "cache/hands.mp4", { clipStartFrame: 120, dissolve: { before: 30, after: 30 } }),
    shot(210, 60, "cache/b.mp4", { clipDurationFrames: 20, playbackRate: 0.5, holdLastFrame: true }), // too short (0.7 s held), and shot 2's clip again
    shot(270, 60, "cache/c.mp4"),
  ];
  const anchors: { uses: AnchorUse[]; conflicts: string[] } = {
    uses: [{ line: 9, text: "Hold my hands", clip: "hands.mp4", used: true, shot: 2, at_ms: 14_433, transition: "dissolve", why: null }],
    conflicts: ['line 9 "Hold my hands" (hands.mp4) cannot stay until its line ends (0:19.0): line 10 "Look" cuts in at 0:18.4'],
  };
  const out = storyShots({ shots, audio: null }, clips, 10_000, anchors);

  it("each shot: its place, clip, in / out, speed and badges", () => {
    expect(out.map((s) => [s.index, s.startMs, s.endMs, s.songMs, s.clip, s.inS, s.outS, s.speed])).toEqual([
      [0, 0, 2000, 10_000, "01_a.mp4", 0.5, 2.5, 1],
      [1, 2000, 4000, 12_000, "02_b.mp4", 0, 1.24, 0.62],
      [2, 4000, 7000, 14_000, "hands.mp4", 4, 7, 1],
      [3, 7000, 9000, 17_000, "02_b.mp4", 0, 0.65, 0.5],
      [4, 9000, 11_000, 19_000, "03_c.mp4", 0, 2, 1],
    ]);
    expect(out[0].best).toBe(true);
    expect(out[2]).toMatchObject({ anchor: { line: 9, text: "Hold my hands" }, dissolve: true, best: true, thumb: "thumbs/hands.mp4.jpg" });
    expect(out.map((s) => s.loop)).toEqual([false, false, false, false, false]);
    expect(out[4]).toMatchObject({ anchor: null, dissolve: false, best: false, warnings: [] });
  });

  it("warnings on the shot: choppy slow motion, too short, anchor conflicts, the same clip too close", () => {
    expect(out[1].warnings).toEqual(["slowed to 0.62x: the motion may look choppy (frames repeat)"]);
    expect(out[3].warnings).toEqual([
      "slowed to 0.50x: the motion may look choppy (frames repeat)",
      "the clip is too short: its last frame is held for 0.7 s",
      "the same clip as shot 2, 5.0 s earlier",
    ]);
    expect(out[2].warnings).toEqual([anchors.conflicts[0]]);
  });
});

describe("the Reels loop ending", () => {
  it("the last shot continuing the first clip is marked as the loop, not as a repeat", () => {
    const loop = storyShots({ shots: [shot(0, 60, "cache/a.mp4", { clipStartFrame: 56 }), shot(60, 60, "cache/b.mp4"), shot(120, 56, "cache/a.mp4")], audio: null }, clips, 0, null);
    expect([loop[2].loop, loop[2].warnings]).toEqual([true, []]);
    const repeat = storyShots({ shots: [shot(0, 60, "cache/a.mp4", { clipStartFrame: 100 }), shot(60, 60, "cache/b.mp4"), shot(120, 56, "cache/a.mp4")], audio: null }, clips, 0, null);
    expect([repeat[2].loop, repeat[2].warnings]).toEqual([false, ["the same clip as shot 1, 4.0 s earlier"]]);
  });
});

describe("storyboard lines, hooks and waveform", () => {
  it("lines at their on-screen times, with the clip anchored on them (by the Lyrics tab's number)", () => {
    const lyrics = [
      { text: "Verse one", startFrame: 0, endFrame: 90 },
      { text: "Hold my hands", startFrame: 90, endFrame: 180, isHook: true },
      { text: "Hold my hands", startFrame: 200, endFrame: 290, isHook: true },
    ];
    const lines = storyLines(lyrics, [{ number: 3, text: "Verse one", isHook: false }, { number: 9, text: "Hold my hands", isHook: true }, { number: 14, text: "Hold my hands", isHook: true }], [
      { line: 9, text: "Hold my hands", clip: "hands.mp4", used: true, shot: 2, at_ms: 0, transition: "cut", why: null },
      { line: 14, text: "Hold my hands", clip: "rings.mp4", used: false, shot: null, at_ms: null, transition: "cut", why: "outside this section" },
    ]);
    expect(lines.map((l) => [l.number, l.startMs, l.endMs, l.anchor])).toEqual([[3, 0, 3000, null], [9, 3000, 6000, "hands.mp4"], [14, 6667, 9667, null]]);
    // The same chorus line twice: one hook section while they follow closely.
    expect(hookSections(lines)).toEqual([{ startMs: 3000, endMs: 9667 }]);
  });

  it("the waveform: the loudest sample per bucket", () => {
    const samples = Float32Array.from({ length: 16_000 }, (_, i) => (i < 8000 ? 0.25 : -0.5) * Math.sin(i / 10));
    const w = peaks(samples, 16_000, 0, 1000, 4);
    expect(w.map((v) => Math.round(v * 100) / 100)).toEqual([0.25, 0.25, 0.5, 0.5]);
  });
});

describe("held last frame and the user's clip edits (2 Nov 2026)", () => {
  // 20 clip frames at 1x from frame 0: the clip shows 20 frames (0.67 s).
  const held = (duration: number, extra: Partial<ShotProps> = {}) => storyShots({ shots: [shot(0, duration, "cache/a.mp4", { clipDurationFrames: 20, holdLastFrame: true, ...extra })], audio: null }, clips, 0, null)[0];
  it("a hold under 0.2 s is not warned about and not flagged; from 0.2 s it is", () => {
    expect(HOLD_NOTICE_MS).toBe(200);
    const tiny = held(20); // exactly covered
    expect(tiny.warnings).toEqual([]);
    expect(tiny.hold).toBe(false);
    const oneFrame = held(21); // one frame short: 33 ms
    expect(oneFrame.warnings).toEqual([]);
    expect(oneFrame.hold).toBe(false);
    const seen = held(26); // 6 frames: 0.2 s
    expect(seen.hold).toBe(true);
    expect(seen.warnings).toEqual(["the clip is too short: its last frame is held for 0.2 s"]);
  });
  it("a clip the user trimmed that is shorter than its shot: the warning says what creative input fixes it", () => {
    const edits = new Map([["cache/a.mp4", { ...clip("01_a.mp4"), edit: clipEdit(10_000, { in: 1, out: 3.5 }) }]]);
    const out = storyShots({ shots: [shot(0, 141, "cache/a.mp4", { clipStartFrame: 30, clipDurationFrames: 300, playbackRate: 0.53 })], audio: null }, edits, 0, null)[0];
    expect(out.warnings).toContain("your trimmed clip (2.5 s) is shorter than this 4.7 s shot: lengthen it in Edit clip or slow it down there");
  });
  it("clipEdit: none for an untouched clip; speed applied to the usable length", () => {
    expect(clipEdit(10_000, {})).toBeUndefined();
    expect(clipEdit(10_000, { speed: 0.5 })).toEqual({ usableS: 20, speed: 0.5, trimmed: false });
  });
});
