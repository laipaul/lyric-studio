// The Shape timeline's pro edits: roll (move a cut), slip (another part of the clip in the same shot).
import { describe, expect, it } from "vitest";

import { applyCutMoves, composeProps, cutAtMs, getCutPoints, mergeTimeline, resetShot, rollEdit, slipEdit, slipFor, type CutPlan, type EditShot, type RenderBase } from "../src";
import { cutPointAt } from "../src/cuts";
import { grid } from "./helpers";

const FPS = 30;
// 120 BPM: a beat every 500 ms, from 0 to 30 s.
const beats = Array.from({ length: 61 }, (_, i) => ({ time_ms: i * 500, strength: 1, is_downbeat: i % 4 === 0 }));
// A section 10-26 s with a cut every 2 bars (4 s): 14, 18, 22.
const plan: CutPlan = { start_frame: 300, end_frame: 780, fps: FPS, cuts: [28, 36, 44].map((b) => cutPointAt(beats, b, FPS)), requested_grid_beats: 8, grid_beats: 8 };
const cutSecs = (p: CutPlan) => p.cuts.map((c) => Math.round(c.time_ms / 10) / 100);

describe("roll: move a cut", () => {
  it("lands on the nearest beat (two frames early, as the planner cuts); Alt: exactly there", () => {
    expect(cutAtMs(beats, 15_180, FPS)!.beat_time_ms).toBe(15_000);
    expect(cutAtMs(beats, 15_180, FPS)!.frame).toBe(448); // 15 s = frame 450, two frames early
    expect(cutAtMs(beats, 15_180, FPS, true)!.frame).toBe(455);
  });

  it("moves only that cut; the others stay where they are", () => {
    const before = cutSecs(plan);
    const { plan: p, moved } = applyCutMoves(plan, beats, [{ from: before[1], to: 19 }]);
    expect(cutSecs(p)).toEqual([before[0], 18.93, before[2]]);
    expect(moved).toEqual([18_933]);
  });

  it("never crosses or crushes a neighbour, and a cut that is not in this plan is left aside", () => {
    const at = cutSecs(plan);
    expect(cutSecs(applyCutMoves(plan, beats, [{ from: at[1], to: 22 }]).plan)).toEqual(at); // onto the next cut
    expect(cutSecs(applyCutMoves(plan, beats, [{ from: 5, to: 6 }]).plan)).toEqual(at); // not in this section
  });

  it("keeps what the viewer sees around the cut: the left shot starts on the same frame, the right one ends on it", () => {
    const left: EditShot = { startMs: 14_000, endMs: 18_000, clip: "a.mp4", kind: "video", inS: 2, speed: 1, clipInS: 0, clipOutS: 10 };
    const right: EditShot = { startMs: 18_000, endMs: 22_000, clip: "b.mp4", kind: "video", inS: 3, speed: 1, clipInS: 0, clipOutS: 10 };
    const r = rollEdit(left, right, 18_000, 19_000);
    expect(r.move).toEqual({ from: 18, to: 19 });
    expect(r.slips).toEqual([{ at: 14, clip: "a.mp4", in: 2 }, { at: 19, clip: "b.mp4", in: 4 }]);
    // Earlier, within what the clip has: never before its usable start.
    expect(rollEdit(left, { ...right, inS: 0.5 }, 18_000, 17_000).slips[1]).toEqual({ at: 17, clip: "b.mp4", in: 0 });
  });
});

describe("slip: another part of the clip in the same shot", () => {
  const shot: EditShot = { startMs: 14_000, endMs: 18_000, clip: "a.mp4", kind: "video", inS: 2, speed: 1, clipInS: 0.5, clipOutS: 9 };
  it("dragging right brings earlier frames in (as in Premiere); kept inside the clip so the shot never runs out", () => {
    expect(slipEdit(shot, 1000).in).toBe(1);
    expect(slipEdit(shot, -1500).in).toBe(3.5);
    expect(slipEdit(shot, 5000).in).toBe(0.5); // the clip's usable start
    expect(slipEdit(shot, -9000).in).toBe(5); // 9 s - the 4 s the shot needs
  });
  it("is found again by its shot's start and clip", () => {
    const slips = [{ at: 14, clip: "A.mp4", in: 1.2 }];
    expect(slipFor(slips, 14_066, "a.mp4")?.in).toBe(1.2);
    expect(slipFor(slips, 14_066, "b.mp4")).toBeUndefined();
  });
});

describe("stored edits", () => {
  it("a cut moved twice is one move from its first place; moved back, no move is left", () => {
    let t = mergeTimeline({ cuts: [], slips: [] }, { move: { from: 18, to: 19 } });
    t = mergeTimeline(t, { move: { from: 18.93, to: 20 } });
    expect(t.cuts).toEqual([{ from: 18, to: 20 }]);
    t = mergeTimeline(t, { move: { from: 19.93, to: 18 } });
    expect(t.cuts).toEqual([]);
  });
  it("a slip replaces the one on the same shot; ↺ automatic drops the shot's slip and the moves at its edges", () => {
    let t = mergeTimeline({ cuts: [{ from: 18, to: 19 }], slips: [] }, { slips: [{ at: 14, clip: "a.mp4", in: 1 }] });
    t = mergeTimeline(t, { slips: [{ at: 14, clip: "a.mp4", in: 2 }] });
    expect(t.slips).toEqual([{ at: 14, clip: "a.mp4", in: 2 }]);
    expect(resetShot(t, 14_000, 19_000)).toEqual({ cuts: [], slips: [] });
  });
});

describe("the planner uses the edits (the same composition Shape previews and Make renders)", () => {
  // 120 BPM from 0:00.5 (a bar every 2 s); a 10.5-40.5 s section cut on every bar; eight 10 s clips.
  const g = grid(120, 240, 500);
  const plan2 = getCutPoints(g, { start_ms: 10_500, end_ms: 40_500 }, { cutRate: "1x" });
  const names = ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4", "05_e.mp4", "06_f.mp4"];
  const clips = names.map((name) => ({ id: name, name, duration_ms: 10_000, path: `cache/${name}`, durationFrames: 300 }));
  const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
  const base = (timeline?: RenderBase["timeline"]): RenderBase => ({
    plan: plan2, clips, audio: null, durationInFrames: plan2.end_frame - plan2.start_frame, lyrics: [],
    styles: { simple: { style, textSize: 64, hookFont: null, fonts: [] }, bold: { style, textSize: 72, hookFont: null, fonts: [] } },
    colour: "#fff", cinematicBars: false, pins: [], beats: g, ...(timeline ? { timeline } : {}),
  });
  const songMs = (frame: number) => Math.round(((plan2.start_frame + frame) * 1000) / 30);

  it("a rolled cut moves just that cut (on the beat); a slip plays its clip from the chosen moment", () => {
    const auto = composeProps(base(), { seed: 1, style: "simple", order: "story" }).props.shots;
    const cut2 = songMs(auto[2].start); // the third shot starts on the bar at 14.5 s
    expect(cut2).toBe(14_433);
    const edited = composeProps(base({ cuts: [{ from: cut2 / 1000, to: 15.5 }], slips: [{ at: 15.5, clip: "05_e.mp4", in: 3 }] }), { seed: 1, style: "simple", order: "story" }).props.shots;
    expect(songMs(edited[2].start)).toBe(15_433); // the beat at 15.5 s, two frames early
    expect(edited[1].start).toBe(auto[1].start); // the cut before it did not move
    expect(edited[3].start).toBe(auto[3].start); // nor the one after
    expect(edited[2].src).toBe("cache/05_e.mp4");
    expect(edited[2].clipStartFrame).toBe(90); // 3 s into 05_e.mp4
  });

  it("a slip on a Reel's first clip survives the loop ending (it plays the frames before the slip instead)", () => {
    const reel = (timeline?: RenderBase["timeline"]): RenderBase => ({
      ...base(timeline), platform: { format: { width: 1080, height: 1920 }, safeZone: { top: 0, bottom: 0, left: 0, right: 0 }, lyricsAt: 0.45, textScale: 1, loopEnding: true } as unknown as RenderBase["platform"],
    });
    const first = composeProps(reel(), { seed: 1, style: "simple", order: "story" }).props.shots;
    const lastOf = (shots: typeof first) => shots[shots.length - 1];
    expect(lastOf(first).src).toBe(first[0].src); // the loop shot continues into shot 1
    // Without a slip the loop ending makes room before shot 1 by moving its start.
    expect(first[0].clipStartFrame).toBe(lastOf(first).clipStartFrame + lastOf(first).duration);
    expect(first[0].clipStartFrame).not.toBe(15);
    const atS = (plan2.start_frame * 1000) / 30 / 1000;
    const slipped = composeProps(reel({ cuts: [], slips: [{ at: atS, clip: first[0].src.replace("cache/", ""), in: 0.5 }] }), { seed: 1, style: "simple", order: "story" }).props.shots;
    expect(slipped[0].clipStartFrame).toBe(15); // the slip, not moved by the loop
    // 15 frames are not enough for the last shot: an ordinary last shot (not the first clip again).
    expect(lastOf(slipped).duration).toBeGreaterThan(0);
    expect(lastOf(slipped).clipStartFrame).toBeGreaterThanOrEqual(0);
    expect(lastOf(slipped).src).not.toBe(slipped[0].src);
  });

  it("a slip on a Reel's last clip plays from the slip (it is not turned into the loop shot)", () => {
    const reel: RenderBase = {
      ...base(), platform: { format: { width: 1080, height: 1920 }, safeZone: { top: 0, bottom: 0, left: 0, right: 0 }, lyricsAt: 0.45, textScale: 1, loopEnding: true } as unknown as RenderBase["platform"],
    };
    const auto = composeProps(reel, { seed: 1, style: "simple", order: "story" }).props.shots;
    const last = auto[auto.length - 1];
    expect(last.src).toBe(auto[0].src); // without a slip the last shot is the loop shot
    expect(last.clipStartFrame + last.duration).toBe(auto[0].clipStartFrame);
    const other = names.find((n) => `cache/${n}` !== auto[0].src && `cache/${n}` !== auto[auto.length - 2].src)!;
    const atS = (plan2.start_frame + last.start) / 30;
    const slipped = composeProps({ ...reel, timeline: { cuts: [], slips: [{ at: atS, clip: other, in: 2 }] } }, { seed: 1, style: "simple", order: "story" }).props.shots;
    const l2 = slipped[slipped.length - 1];
    expect(l2.src).toBe(`cache/${other}`);
    expect(l2.clipStartFrame).toBe(60); // 2 s into the clip
  });
});

describe("clips.json keeps the timeline edits", () => {
  it("accepts cuts and slips in song seconds and names a wrong one", async () => {
    const { checkClipEdits } = await import("../src/node/clip-edits");
    const ok = checkClipEdits({ cuts: [{ from: 47.8, to: 48.333 }], slips: [{ at: 48.33, clip: "06_rings.mp4", in: 1.4 }] });
    expect(ok.problems).toEqual([]);
    expect(ok.edits.cuts).toEqual([{ from: 47.8, to: 48.33 }]);
    expect(ok.edits.slips).toEqual([{ at: 48.33, clip: "06_rings.mp4", in: 1.4 }]);
    expect(checkClipEdits({ cuts: [{ from: "x" }] }).problems[0]).toContain("cuts must be a list");
    expect(checkClipEdits({ slips: [{ at: 1 }] }).problems[0]).toContain("slips must be a list");
  });
});
