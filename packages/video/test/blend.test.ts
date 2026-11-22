// A dissolve never shows a frozen frame (src/blend.ts): handles made by moving the clips inside their files, the
// transition shortened (down to a hard cut) when the files have no spare frames, singing shots never moved.
import { describe, expect, it } from "vitest";

import { blendInto, composeProps, getCutPoints, type PreparedClip, type RenderBase } from "../src";
import type { ShotProps } from "../src/props";
import { grid } from "./helpers";

const FILE = 151; // a 5.04 s clip: frames 0-150
const shot = (src: string, start: number, duration: number, clipStartFrame: number, over: Partial<ShotProps> = {}): ShotProps => ({
  start, duration, src, clipStartFrame, clipDurationFrames: FILE, playbackRate: 1, holdLastFrame: false, ...over,
});
// Last file frame a shot's sequence plays (its dissolve-in frames, its length and its tail), at its speed.
const lastFrame = (s: ShotProps) => s.clipStartFrame + Math.ceil(((s.dissolve?.before ?? 0) + s.duration + (s.tail ?? 0) - 1) * s.playbackRate);
const BAR = 30; // a dissolve of 15 frames before and 15 after the cut

describe("a dissolve never shows a frozen frame", () => {
  it("a clip used to the very end of its file gets handles by moving earlier in the file (slot and cut unchanged), then the dissolve is whole", () => {
    // Wedding Day: 5.04 s clip used from 0.9 s to its end (frames 27-150: shot of 124 frames), then a clip used from 0.3 s.
    const shots = [shot("a", 0, 124, 27), shot("b", 124, 120, 9)];
    const notes = blendInto(shots, 1, { bar: BAR, floor: 9, locked: false, prevLocked: false });
    expect(shots[1].dissolve).toEqual({ before: 15, after: 15 });
    expect(shots[0].tail).toBe(15);
    expect(shots[0].duration).toBe(124); // on-screen length and the cut (frame 124) unchanged
    expect(shots[1].start).toBe(124);
    expect(shots[0].clipStartFrame).toBeLessThan(27); // the outgoing clip moved earlier in its file
    expect(lastFrame(shots[0])).toBeLessThanOrEqual(FILE - 1); // never past the file: no held frame under the dissolve
    expect(lastFrame(shots[1])).toBeLessThanOrEqual(FILE - 1);
    expect(notes).toEqual([{ shot: 1, src: "a", kind: "earlier", seconds: 0.5, into: "next" }]);
  });

  it("the incoming clip that starts at its file's first frame plays on from its start (no handle needed before it)", () => {
    const shots = [shot("a", 0, 60, 40), shot("b", 60, 60, 0)];
    blendInto(shots, 1, { bar: BAR, floor: 0, locked: false, prevLocked: false });
    expect(shots[1].dissolve).toEqual({ before: 15, after: 15 });
    expect(shots[1].clipStartFrame).toBe(0);
    expect(lastFrame(shots[1])).toBeLessThanOrEqual(FILE - 1);
  });

  it("no spare frames at all: the dissolve is shortened to what is there, down to a hard cut", () => {
    // Outgoing: the whole file is in use and runs to its end; incoming: the whole file, used to its end.
    const shots = [shot("a", 0, 151, 0), shot("b", 151, 151, 0)];
    const notes = blendInto(shots, 1, { bar: BAR, floor: 0, locked: false, prevLocked: false });
    expect(shots[1].dissolve).toBeUndefined();
    expect(shots[0].tail).toBeUndefined();
    expect(notes).toEqual([{ shot: 1, src: "a", kind: "shortened", seconds: 0, side: "ends" }]);
  });

  it("a partial handle shortens the dissolve (the incoming clip has only 6 spare frames before its in point and ends with its file)", () => {
    const shots = [shot("a", 0, 100, 20), shot("b", 100, 145, 6)]; // b: frames 6-150, no room after
    const notes = blendInto(shots, 1, { bar: BAR, floor: 6, locked: false, prevLocked: false });
    expect(shots[1].dissolve).toEqual({ before: 6 + 0, after: 15 }); // only what the file gives
    expect(lastFrame(shots[1])).toBeLessThanOrEqual(FILE - 1);
    expect(notes[0]).toMatchObject({ kind: "shortened", side: "starts" });
  });

  it("a shot that already holds its last frame gets a hard cut, not a dissolve over the frozen picture", () => {
    const shots = [shot("a", 0, 100, 100, { holdLastFrame: true, playbackRate: 0.5 }), shot("b", 100, 100, 30)];
    blendInto(shots, 1, { bar: BAR, floor: 0, locked: false, prevLocked: false });
    expect(shots[1].dissolve).toBeUndefined();
    expect(shots[0].tail).toBeUndefined();
  });

  it("a photo has frames to spare: the dissolve is whole", () => {
    const shots = [shot("a", 0, 90, 0, { kind: "photo", clipDurationFrames: 90 }), shot("b", 90, 90, 30)];
    blendInto(shots, 1, { bar: BAR, floor: 0, locked: false, prevLocked: false });
    expect(shots[1].dissolve).toEqual({ before: 15, after: 15 });
  });

  it("singing shots are never moved: no dissolve into one, and a singing clip before a dissolve keeps its start", () => {
    const into = [shot("a", 0, 60, 40), shot("sings", 60, 60, 28)];
    blendInto(into, 1, { bar: BAR, floor: 0, locked: true, prevLocked: false });
    expect(into[1].dissolve).toBeUndefined();
    expect(into[1].clipStartFrame).toBe(28);
    const out = [shot("sings", 0, 124, 27), shot("b", 124, 120, 9)];
    blendInto(out, 1, { bar: BAR, floor: 9, locked: false, prevLocked: true });
    expect(out[0].clipStartFrame).toBe(27); // its frame is the song's: never shifted
    expect(out[0].tail ?? 0).toBe(0); // no frames left, so nothing to keep playing: the dissolve is only the incoming `before`
    expect(lastFrame(out[0])).toBeLessThanOrEqual(FILE - 1);
  });
});

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
    const { props, blendNotes } = composeProps(build(clips), { seed: 1, style: "simple", order: "story" });
    expect(props.shots.length).toBeGreaterThan(4);
    expect(props.shots.filter((s) => s.dissolve).length).toBeGreaterThan(0); // dissolves still happen where the files allow
    for (const s of props.shots) {
      if (s.holdLastFrame) continue;
      expect(lastFrame(s)).toBeLessThanOrEqual(s.clipDurationFrames - 1);
    }
    expect(blendNotes.every((n) => n.shot > 0 && n.shot < props.shots.length)).toBe(true);
  });
  it("an out point past the real length of the file is clamped: the clip never plays beyond its last frame", () => {
    const { props } = composeProps(build([mk("a.mp4", 5_040, { in_ms: 900, out_ms: 9_000 }), mk("b.mp4", 5_040, { in_ms: 0, out_ms: 5_200 })]), { seed: 1, style: "simple", order: "story" });
    for (const s of props.shots.filter((x) => !x.holdLastFrame)) expect(lastFrame(s)).toBeLessThanOrEqual(s.clipDurationFrames - 1);
  });
});
