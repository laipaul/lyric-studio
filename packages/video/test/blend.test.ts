// A dissolve never shows a frozen frame (src/handles.ts, end to end through composeProps): 5.04 s clips used to their very
// end, and an out point past the real length of the file.
import { describe, expect, it } from "vitest";

import { composeProps, getCutPoints, type PreparedClip, type RenderBase } from "../src";
import type { ShotProps } from "../src/props";
import { grid } from "./helpers";

// Last file frame a shot's sequence plays (its dissolve-in frames, its length and its tail), at its speed.
const lastFrame = (s: ShotProps) => s.clipStartFrame + Math.ceil(((s.dissolve?.before ?? 0) + s.duration + (s.tail ?? 0) - 1) * s.playbackRate);

describe("composeProps: no transition shows a held frame", () => {
  const beats = grid(120, 240, 500); // bars of 2 s
  const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
  const mk = (id: string, ms: number, over: Partial<PreparedClip> = {}): PreparedClip => ({ id, name: id, duration_ms: ms, path: `cache/${id}`, durationFrames: Math.floor((ms * 30) / 1000), ...over });
  // 5.04 s clips used to their very end: the 2 s shots of this song (bar = 60 frames) would play 1.9x slower... so use 4 s shots via 2x cuts.
  const build = (clips: PreparedClip[]): RenderBase => {
    const plan = getCutPoints(beats, { start_ms: 500, end_ms: 40_500 }, { cutRate: "0.5x" });
    return {
      plan, clips, audio: null, durationInFrames: plan.end_frame - plan.start_frame, lyrics: [],
      styles: { simple: { style, textSize: 64, hookFont: null, fonts: [] }, bold: { style, textSize: 72, hookFont: null, fonts: [] } },
      colour: "#fff", cinematicBars: false, pins: [], beats,
      transitions: { style: "flowing", feel: "calm", hooks: [], sung: [] },
    };
  };
  it("with clips used to the end of their files every dissolve stays inside the files (or becomes a cut)", () => {
    const clips = [mk("a.mp4", 5_040, { in_ms: 900, out_ms: 5_200 }), mk("b.mp4", 5_040, { in_ms: 300, out_ms: 5_200 }), mk("c.mp4", 5_040, { in_ms: 0, out_ms: 5_200 })];
    const { props } = composeProps(build(clips), { seed: 1, style: "simple", order: "story" });
    expect(props.shots.length).toBeGreaterThan(4);
    expect(props.shots.filter((s) => s.dissolve).length).toBeGreaterThan(0); // dissolves still happen where the files allow
    for (const s of props.shots) {
      if (s.holdLastFrame) continue;
      expect(lastFrame(s)).toBeLessThanOrEqual(s.clipDurationFrames - 1);
    }
    expect(props.shots.some((s) => s.fitNotes?.length)).toBe(true); // what was changed is said on the shots
  });
  it("an out point past the real length of the file is clamped: the clip never plays beyond its last frame", () => {
    const { props } = composeProps(build([mk("a.mp4", 5_040, { in_ms: 900, out_ms: 9_000 }), mk("b.mp4", 5_040, { in_ms: 0, out_ms: 5_200 })]), { seed: 1, style: "simple", order: "story" });
    for (const s of props.shots.filter((x) => !x.holdLastFrame)) expect(lastFrame(s)).toBeLessThanOrEqual(s.clipDurationFrames - 1);
  });
});
