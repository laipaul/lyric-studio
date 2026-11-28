// The time a singing shot frees (28 Nov 2026, Paul: "shot 5 is squeezed again; from shot 15 to 17 the lyrics are too late"): a singing
// shot ends at its footage end, and the B-roll that FOLLOWS it enters there itself (the same clip, earlier), so the story order and
// where each of his clips falls on the lyrics stay as they were. Where that clip has no footage, the freed shot is filled apart.
import { describe, expect, it } from "vitest";

import { composeProps, getCutPoints, planAnchors, type RawLyric, type RenderBase, type ResolvedAnchor } from "../src";
import { grid } from "./helpers";

const beats = grid(120, 240, 500);
const f = (ms: number) => Math.round((ms * 30) / 1000);
const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
const lyrics: RawLyric[] = [{ text: "Hold my hands", start_ms: 15_450, end_ms: 20_000, isHook: false, sung_end_ms: 19_000 }];
const sing: ResolvedAnchor = { line: 5, text: "Hold my hands", lyric: 0, clipId: "sings.mp4", clipName: "sings.mp4", clipInMs: null, transition: "cut", syncMs: 13_500 };
const broll = (n: number, ms: number) => Array.from({ length: n }, (_, i) => { const name = `0${i + 1}_b.mp4`; return { id: name, name, duration_ms: ms, path: `cache/${name}`, durationFrames: f(ms) }; });
const singer = (ms: number) => ({ id: "sings.mp4", name: "sings.mp4", duration_ms: ms, path: "cache/sings.mp4", durationFrames: f(ms) });
const base = (clips: ReturnType<typeof broll>, singMs: number): RenderBase => {
  const p = getCutPoints(beats, { start_ms: 10_500, end_ms: 40_500 }, { cutRate: "1x" });
  return { plan: p, clips: [...clips, singer(singMs)], audio: null, durationInFrames: p.end_frame - p.start_frame, lyrics, styles: { simple: { style, textSize: 64, hookFont: null, fonts: [] }, bold: { style, textSize: 72, hookFont: null, fonts: [] } }, colour: "#fff", cinematicBars: false, pins: [], anchors: [sing], beats };
};
const choices = { seed: 1, style: "simple" as const, order: "story" as const };
const names = (b: RenderBase) => composeProps(b, choices).props.shots.map((s) => ({ start: s.start, src: s.src, hold: s.holdLastFrame }));

describe("planAnchors: the freed time", () => {
  const plan = getCutPoints(beats, { start_ms: 10_500, end_ms: 40_500 }, { cutRate: "1x" });
  const lines = [{ startFrame: 100, endFrame: 200, sungEndFrame: 190, stampFrame: 108 }];
  const ra = (footage: number): ResolvedAnchor => ({ ...sing, footageFrames: footage });
  it("the regular cut after the footage end goes (the next B-roll enters at the footage end); keepFoot keeps it", () => {
    const long = planAnchors(plan, beats, [ra(2000)], lines, { singerFade: true });
    const at = f(long.uses[0].at_ms!);
    const natural = long.plan.cuts.find((c) => c.frame > at)!.frame;
    const footage = natural - 390 - 6; // ends 6 frames before the natural cut: that one is the regular cut right behind it
    const far = footage - 40; // 40 frames before it
    const joined = planAnchors(plan, beats, [ra(far)], lines, { singerFade: true });
    expect(joined.footCuts).toHaveLength(1);
    expect(joined.joined).toEqual(joined.footCuts);
    expect(joined.plan.cuts.some((c) => c.frame === natural)).toBe(false);
    const kept = planAnchors(plan, beats, [ra(far)], lines, { singerFade: true, keepFoot: new Set(joined.footCuts) });
    expect(kept.joined).toEqual([]);
    expect(kept.plan.cuts.some((c) => c.frame === natural)).toBe(true);
    // every other cut is the one of the unshortened plan
    const rest = (p: typeof joined) => p.plan.cuts.map((c) => c.frame).filter((x) => x !== natural && !p.footCuts!.includes(x));
    expect(rest(joined)).toEqual(rest({ ...long, footCuts: [] }));
  });
});

describe("composed: a singer whose footage ends early", () => {
  it("every other shot starts where it did with a long singer, with the same clip: no story clip moves; the next B-roll enters earlier", () => {
    const clips = broll(8, 30_000);
    const longShots = names(base(clips, 60_000)); // footage reaches past the shot: no freed time
    const short = names(base(clips, 3_200)); // ends 3.2 s into the take
    const sungAt = f(13_500) - f(10_500);
    const freedIdx = short.findIndex((s) => s.src === "cache/sings.mp4") + 1;
    const startsLong = new Map(longShots.map((s) => [s.start, s.src]));
    // the shot right after the singer starts earlier than before; all the others are where they were, with their clips
    for (const [i, s] of short.entries()) {
      if (i === freedIdx) continue;
      expect(startsLong.get(s.start), `shot ${i + 1} at ${s.start}`).toBe(s.src);
    }
    const after = short[freedIdx];
    const was = longShots.find((s) => s.src === after.src)!;
    expect(after.start).toBeLessThan(was.start); // entered earlier
    expect(after.start).toBeGreaterThan(sungAt);
    expect(short.some((s) => s.hold)).toBe(false);
    expect(short.length).toBe(longShots.length); // no extra shot
  });

  it("the next clip has no footage to enter earlier: the freed time is a shot of its own, filled without a frozen frame", () => {
    const clips = broll(8, 30_000).map((c, i) => ({ ...c, duration_ms: i === 0 ? 30_000 : 1_000, durationFrames: i === 0 ? 900 : 30 })); // only the first B-roll clip has footage
    const r = composeProps(base(clips, 3_200), choices);
    expect(r.props.shots.some((s) => s.holdLastFrame && s.src === "cache/sings.mp4")).toBe(false);
    const k = r.props.shots.findIndex((s) => s.src === "cache/sings.mp4");
    // the singer is followed by a shot of its own and then the regular cut: more shots than the long-singer plan has
    expect(r.props.shots.length).toBeGreaterThan(names(base(clips, 60_000)).length - 1);
    expect(r.props.shots[k + 1].start).toBe(r.props.shots[k].start + r.props.shots[k].duration);
  });
});
