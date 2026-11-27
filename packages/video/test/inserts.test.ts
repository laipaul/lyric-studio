// B-roll here (27 Nov 2026): inserts laid over the edit on the beat, never over a singing shot; the interrupted shot plays
// on after the insert; in a Mini film too.
import { describe, expect, it } from "vitest";

import { composeProps, getCutPoints, type RawLyric, type RenderBase, type ResolvedAnchor } from "../src";
import { planInserts } from "../src/inserts";
import { grid } from "./helpers";

const beats = grid(120, 240, 500); // a beat every 0.5 s from 0:00.5, a bar every 2 s
const plan = () => getCutPoints(beats, { start_ms: 10_500, end_ms: 40_500 }, { cutRate: "1x" });
const f = (ms: number) => Math.round((ms * 30) / 1000);

describe("B-roll inserts (pure)", () => {
  it("start and end snap to the beat (or a cut already close); the cuts it covers go", () => {
    const p = plan();
    const r = planInserts(p, beats, [{ fromMs: 21_700, toMs: 25_300, clipId: "hands.mp4", clipName: "hands.mp4" }], []);
    const start = [...r.shots.keys()][0];
    const onBeat = (frame: number) => beats.some((b) => f(b.time_ms) - 2 === frame);
    expect(onBeat(start)).toBe(true);
    expect(Math.abs(start - f(21_700))).toBeLessThanOrEqual(f(800));
    const after = r.plan.cuts.find((c) => c.frame > start)!;
    expect(onBeat(after.frame)).toBe(true);
    expect(Math.abs(after.frame - f(25_300))).toBeLessThanOrEqual(f(800));
    expect(r.plan.cuts.some((c) => c.frame > start && c.frame < after.frame)).toBe(false);
  });

  it("never over a singing shot (its own cut-away keeps the lips in time), never over another insert", () => {
    const p = plan();
    const r = planInserts(p, beats, [{ fromMs: 15_000, toMs: 17_000, clipId: "a", clipName: "a" }], [{ from: f(14_000), to: f(20_000) }]);
    expect(r.shots.size).toBe(0);
    expect(r.notes[0]).toMatch(/over a singing shot: use Cut away to B-roll/);
    const two = planInserts(p, beats, [{ fromMs: 15_000, toMs: 18_000, clipId: "a", clipName: "a" }, { fromMs: 16_000, toMs: 19_000, clipId: "b", clipName: "b" }], []);
    expect(two.shots.size).toBe(1);
    expect(two.notes[0]).toMatch(/overlaps another B-roll insert/);
  });
});

describe("B-roll inserts in the edit", () => {
  const names = ["01_a.mp4", "02_b.mp4", "hands.mp4", "sings.mp4"];
  const clips = names.map((name) => ({ id: name, name, duration_ms: 30_000, path: `cache/${name}`, durationFrames: 900 }));
  const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
  const lyrics: RawLyric[] = [{ text: "Hold my hands", start_ms: 15_450, end_ms: 20_000, isHook: false, sung_end_ms: 19_000 }];
  const base = (over: Partial<RenderBase> = {}): RenderBase => {
    const p = getCutPoints(beats, { start_ms: 10_500, end_ms: 40_500 }, { cutRate: "0.5x" });
    return { plan: p, clips, audio: null, durationInFrames: p.end_frame - p.start_frame, lyrics, styles: { simple: { style, textSize: 64, hookFont: null, fonts: [] }, bold: { style, textSize: 72, hookFont: null, fonts: [] } }, colour: "#fff", cinematicBars: false, pins: [], anchors: [], beats, ...over };
  };
  const start = f(10_500);

  it("the insert shows its clip over its stretch, and the shot it interrupted plays on after it", () => {
    const b = base({ clips: clips.filter((c) => c.name !== "sings.mp4"), inserts: [{ fromMs: 25_000, toMs: 27_000, clipId: "hands.mp4", clipName: "hands.mp4" }] });
    const { props } = composeProps(b, { seed: 1, style: "simple", order: "story" });
    const k = props.shots.findIndex((s) => s.src === "cache/hands.mp4" && Math.abs(s.start - (f(25_000) - start)) <= f(800));
    expect(k).toBeGreaterThan(0);
    const [before, ins, after] = [props.shots[k - 1], props.shots[k], props.shots[k + 1]];
    expect(Math.abs(ins.start + ins.duration - (f(27_000) - start))).toBeLessThanOrEqual(f(800));
    if (after && after.src === before.src) expect(after.clipStartFrame).toBe(before.clipStartFrame + before.duration + ins.duration);
  });

  it("in a Mini film the planned shot plays on after the insert, from where it was", () => {
    const b0 = base({ clips: clips.filter((c) => c.name !== "sings.mp4") });
    const filmShots = [b0.plan.cuts, [0]].flat().map((_, i) => (i % 2 ? "02_b.mp4" : "01_a.mp4"));
    const p0 = b0.plan;
    const mid = p0.cuts[2]; // insert inside the shot after this cut
    const next = p0.cuts[3];
    const from = ((mid.frame + 0.4 * (next.frame - mid.frame)) * 1000) / 30;
    const { props } = composeProps({ ...b0, filmShots, inserts: [{ fromMs: from, toMs: from + 1000, clipId: "hands.mp4", clipName: "hands.mp4" }] }, { seed: 1, style: "simple", order: "story" });
    const k = props.shots.findIndex((s) => s.src === "cache/hands.mp4");
    expect(k).toBeGreaterThan(0);
    const [before, ins, after] = [props.shots[k - 1], props.shots[k], props.shots[k + 1]];
    expect(after.src).toBe(before.src);
    expect(after.clipStartFrame).toBe(before.clipStartFrame + before.duration + ins.duration);
  });

  it("a singing shot is never covered by an insert: the note says to cut away instead", () => {
    const sing: ResolvedAnchor = { line: 5, text: "Hold my hands", lyric: 0, clipId: "sings.mp4", clipName: "sings.mp4", clipInMs: null, transition: "cut", syncMs: 13_500 };
    const { props, warnings } = composeProps(base({ anchors: [sing], inserts: [{ fromMs: 16_000, toMs: 18_000, clipId: "hands.mp4", clipName: "hands.mp4" }] }), { seed: 1, style: "simple", order: "story" });
    expect(props.shots.some((s) => s.src === "cache/hands.mp4" && s.start >= f(15_000) - start && s.start < f(19_000) - start)).toBe(false);
    expect(warnings.join(" ")).toMatch(/over a singing shot/);
  });
});
