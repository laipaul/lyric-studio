import { describe, expect, it } from "vitest";

import { assignClips, getCutPoints, mulberry32, type ClipInfo } from "../src";
import { grid } from "./helpers";

const plan = getCutPoints(grid(120, 130), { start_ms: 0, end_ms: 64_000 }, { cutRate: "2x" }); // ~1 s shots
const clips: ClipInfo[] = Array.from({ length: 8 }, (_, i) => ({ id: `clip-${i}`, duration_ms: 3_000 + i * 1_000 }));

describe("assignClips", () => {
  it("same seed = same result, also when the clips come in another order", () => {
    const a = assignClips(plan, clips, 42);
    expect(assignClips(plan, clips, 42)).toEqual(a);
    expect(assignClips(plan, [...clips].reverse(), 42)).toEqual(a);
  });

  it("different seed = different result", () => {
    const a = assignClips(plan, clips, 1).map((s) => `${s.clip_id}@${s.clip_start_frame}`);
    const b = assignClips(plan, clips, 2).map((s) => `${s.clip_id}@${s.clip_start_frame}`);
    expect(a).not.toEqual(b);
  });

  it("covers the section with one shot per gap between cuts", () => {
    const shots = assignClips(plan, clips, 7);
    expect(shots).toHaveLength(plan.cuts.length + 1);
    expect(shots[0].start_frame).toBe(plan.start_frame);
    expect(shots[shots.length - 1].end_frame).toBe(plan.end_frame);
    shots.slice(1).forEach((s, i) => expect(s.start_frame).toBe(shots[i].end_frame));
  });

  it("never repeats a clip within the last 3 shots when the pool allows", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const ids = assignClips(plan, clips, seed).map((s) => s.clip_id);
      ids.forEach((id, i) => expect(ids.slice(Math.max(0, i - 3), i)).not.toContain(id));
    }
  });

  it("with a small pool, still never the same clip twice in a row", () => {
    for (const n of [2, 3]) {
      const ids = assignClips(plan, clips.slice(0, n), 5).map((s) => s.clip_id);
      ids.slice(1).forEach((id, i) => expect(id).not.toBe(ids[i]));
    }
    expect(assignClips(plan, clips.slice(0, 1), 5).every((s) => s.clip_id === "clip-0")).toBe(true);
  });

  it("start offsets stay inside the clip: the shot never plays past the clip's end", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const s of assignClips(plan, clips, seed)) {
        const clip = clips.find((c) => c.id === s.clip_id)!;
        const clipFrames = Math.floor((clip.duration_ms * 30) / 1000);
        expect(s.playback_rate).toBe(1);
        expect(s.clip_start_frame).toBeGreaterThanOrEqual(0);
        expect(s.clip_start_frame + s.duration_frames * s.playback_rate).toBeLessThanOrEqual(clipFrames);
      }
    }
  });

  it("a clip shorter than the shot is slowed down to fit (not below 0.5x)", () => {
    const longShot = getCutPoints(grid(120, 40), { start_ms: 0, end_ms: 4_000 }, { cutRate: "0.5x" }); // one 4 s shot
    expect(longShot.cuts).toHaveLength(0);
    const [shot] = assignClips(longShot, [{ id: "short", duration_ms: 3_000 }], 1);
    expect(shot.playback_rate).toBe(0.75);
    expect(shot.hold_last_frame).toBe(false);
    expect(shot.clip_start_frame).toBe(0);
    expect(shot.duration_frames * shot.playback_rate).toBeLessThanOrEqual(90);
  });

  it("a clip too short even at 0.5x plays at 0.5x and then holds its last frame", () => {
    const longShot = getCutPoints(grid(120, 40), { start_ms: 0, end_ms: 4_000 }, { cutRate: "0.5x" });
    const [shot] = assignClips(longShot, [{ id: "tiny", duration_ms: 1_000 }], 1);
    expect(shot.playback_rate).toBe(0.5);
    expect(shot.hold_last_frame).toBe(true);
    expect(shot.clip_start_frame).toBe(0);
  });

  it("prefers clips long enough for the shot", () => {
    const longShot = getCutPoints(grid(120, 40), { start_ms: 0, end_ms: 4_000 }, { cutRate: "0.5x" });
    const pool = [{ id: "a-short", duration_ms: 1_000 }, { id: "b-long", duration_ms: 10_000 }];
    for (const seed of [1, 2, 3, 4, 5]) expect(assignClips(longShot, pool, seed)[0].clip_id).toBe("b-long");
  });

  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
