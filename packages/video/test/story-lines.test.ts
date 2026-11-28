// Your clips play in your order, on the same lines (Paul, 28 Nov 2026: "if I put the clips in a certain sequence I expect them to play in
// that order, else I'm confused if the app makes decisions to cut them for me resulting in lines being not in sync").
// A singing shot that ends at its footage frees time; when the next shot is a story anchor (a clip of his on a line) it starts earlier
// itself, so no other clip fills the time and none after it moves. Where it cannot (too little footage), the old fill stays and a note
// names the creative choices. And a re-plan lists every story clip that now starts on another lyric line than in the plan he saw.
import { describe, expect, it } from "vitest";

import { composeProps, getCutPoints, lineChanges, storyLineMap, type RawLyric, type RenderBase, type ResolvedAnchor, type StoryboardFile } from "../src";
import { grid } from "./helpers";

const beats = grid(120, 240, 500);
const f = (ms: number) => Math.round((ms * 30) / 1000);
const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
const lyrics: RawLyric[] = [
  { text: "Hold my hands", start_ms: 15_450, end_ms: 20_000, isHook: false, sung_end_ms: 19_000 },
  { text: "Take my heart", start_ms: 22_450, end_ms: 28_000, isHook: false, sung_end_ms: 27_000 },
];
const sing: ResolvedAnchor = { line: 5, text: "Hold my hands", lyric: 0, clipId: "sings.mp4", clipName: "sings.mp4", clipInMs: null, transition: "cut", syncMs: 13_500 };
const worried: ResolvedAnchor = { line: 6, text: "Take my heart", lyric: 1, clipId: "worried.mp4", clipName: "worried.mp4", clipInMs: null, transition: "cut" };
const clip = (name: string, ms: number) => ({ id: name, name, duration_ms: ms, path: `cache/${name}`, durationFrames: f(ms) });
const broll = (n: number, ms: number) => Array.from({ length: n }, (_, i) => clip(`0${i + 1}_b.mp4`, ms));
const base = (singMs: number, worriedMs: number, brollMs = 30_000): RenderBase => {
  const p = getCutPoints(beats, { start_ms: 10_500, end_ms: 40_500 }, { cutRate: "1x" });
  return {
    plan: p, clips: [...broll(8, brollMs), clip("sings.mp4", singMs), clip("worried.mp4", worriedMs)], audio: null, durationInFrames: p.end_frame - p.start_frame, lyrics,
    styles: { simple: { style, textSize: 64, hookFont: null, fonts: [] }, bold: { style, textSize: 72, hookFont: null, fonts: [] } },
    colour: "#fff", cinematicBars: false, pins: [], anchors: [sing, worried], beats,
  };
};
const choices = { seed: 1, style: "simple" as const, order: "story" as const };
const shots = (b: RenderBase) => composeProps(b, choices).props.shots.map((s) => ({ start: s.start, src: s.src.replace("cache/", ""), duration: s.duration, rate: s.playbackRate, hold: s.holdLastFrame }));

describe("a story anchor after a singer that ends at its footage", () => {
  const long = shots(base(60_000, 30_000)); // the singer's footage reaches past its shot: nothing freed
  it("starts where the singer's footage ends: no other clip fills the time, none after it moves", () => {
    const short = composeProps(base(3_200, 30_000), choices);
    const s = short.props.shots.map((x) => ({ start: x.start, src: x.src.replace("cache/", ""), hold: x.holdLastFrame }));
    const sungAt = f(13_500) - f(10_500);
    const k = s.findIndex((x) => x.src === "sings.mp4");
    const was = long.find((x) => x.src === "worried.mp4")!;
    // the anchor follows the singer at once and starts earlier than with the long singer
    expect(s[k + 1].src).toBe("worried.mp4");
    expect(s[k + 1].start).toBeLessThan(was.start);
    expect(s[k + 1].start).toBeGreaterThan(sungAt);
    // same shots otherwise: every other start and clip as with the long singer; no hold
    const startsLong = new Map(long.map((x) => [x.start, x.src]));
    for (const [i, x] of s.entries()) if (i !== k + 1) expect(startsLong.get(x.start), `shot ${i + 1} at ${x.start}`).toBe(x.src);
    expect(s.length).toBe(long.length);
    expect(s.some((x) => x.hold)).toBe(false);
    expect(short.anchors!.uses.find((u) => u.line === 6)!.why).toContain("early");
    expect(short.anchors!.notes.some((n) => n.includes("to fill"))).toBe(false);
  });

  it("the anchor's clip would need slow motion to cover the time: never slowed (Paul: clips play at the speed he made them); the B-roll before the singer carries on instead", () => {
    const r = composeProps(base(3_200, 7_500), choices);
    expect(r.anchors!.notes.some((n) => n.includes("slow motion"))).toBe(false);
    const k = r.props.shots.findIndex((x) => x.src === "cache/sings.mp4");
    // the clip before the singer plays on after her (from where it stopped), at its own speed; the anchor keeps its own cut
    expect(r.props.shots[k + 1].src).toBe(r.props.shots[k - 1].src);
    expect(r.props.shots[k + 1].playbackRate).toBe(1);
    expect(r.props.shots[k + 2].src).toBe("cache/worried.mp4");
    // no slow-motion join (the general fitting of B-roll to its shot, 0.8x and up, goes in the next step, 1d)
    for (const s of r.props.shots.filter((x) => x.src === "cache/worried.mp4")) expect(s.playbackRate).toBeGreaterThanOrEqual(0.8);
  });

  it("the anchor's clip has too little footage even slowed: the old fill stays and a note names the creative choices (no silent decision)", () => {
    const r = composeProps(base(3_200, 3_000, 1_000), choices); // (the B-roll before the singer has no footage to play on either)
    const k = r.props.shots.findIndex((x) => x.src === "cache/sings.mp4");
    // the anchor stays at its own cut; the shot after the singer is filled by a clip of the story
    expect(r.props.shots[k + 1].src).not.toBe("cache/worried.mp4");
    const note = r.anchors!.notes.find((n) => n.includes("to fill"))!;
    expect(note).toMatch(/^line 5: \d+\.\d s to fill after the singing clip: let worried start earlier/);
    expect(note).toContain("add a longer singing take");
  });
});

// ---- the list of clips that changed line against the plan the user saw
const sb = (shots: { clip: string; startMs: number; carries?: string | null }[], over: { range?: [number, number]; texts?: string[] } = {}) =>
  ({
    output: { range: { startMs: over.range?.[0] ?? 0, endMs: over.range?.[1] ?? 60_000 } },
    text: (over.texts ?? ["a", "b", "c", "d"]).map((text, i) => ({ id: `line-${i + 1}`, kind: "lyric", line: i + 1, text, startMs: 10_000 * (i + 1), endMs: 10_000 * (i + 2), locked: [] })),
    shots: shots.map((s, i) => ({ id: `sh-${i}`, clip: s.clip, startMs: s.startMs, endMs: s.startMs + 5_000, carries: s.carries ?? null })),
  }) as unknown as StoryboardFile;

describe("lineChanges", () => {
  const seen = sb([{ clip: "Amalfi.mp4", startMs: 10_000 }, { clip: "Worried Girl.mp4", startMs: 20_000, carries: "line-2" }, { clip: "Bouquet.mp4", startMs: 30_000 }, { clip: "Amalfi.mp4", startMs: 40_000 }]);
  it("is empty when every story clip starts on its line (a cut a hair before the line counts as on it; an anchor's clip is not a story clip)", () => {
    const now = sb([{ clip: "Amalfi.mp4", startMs: 9_900 }, { clip: "Worried Girl.mp4", startMs: 14_000, carries: "line-2" }, { clip: "Bouquet.mp4", startMs: 30_200 }, { clip: "Amalfi.mp4", startMs: 40_000 }]);
    expect(lineChanges(seen, now)).toEqual([]);
    expect(storyLineMap(seen).map((x) => [x.clip, x.line])).toEqual([["Amalfi.mp4", 1], ["Bouquet.mp4", 3], ["Amalfi.mp4", 4]]);
  });
  it("names every story clip on another line, in plain words, a repeated clip by its turn", () => {
    const now = sb([{ clip: "Amalfi.mp4", startMs: 10_000 }, { clip: "Worried Girl.mp4", startMs: 20_000, carries: "line-2" }, { clip: "Bouquet.mp4", startMs: 20_500 }, { clip: "Amalfi.mp4", startMs: 30_000 }]);
    expect(lineChanges(seen, now)).toEqual(["Bouquet: was line 3, now line 2", "Amalfi: was line 4, now line 3"]);
  });
  it("lists a clip that is new or gone; says nothing when the part of the song or the lyric lines changed (the plan changes already say so)", () => {
    const now = sb([{ clip: "Amalfi.mp4", startMs: 10_000 }, { clip: "Rain.mp4", startMs: 30_000 }]);
    expect(lineChanges(seen, now)).toEqual(["Rain: now line 3 (it was not in the plan you saw)", "Bouquet: was line 3, no longer in the video", "Amalfi: was line 4, no longer in the video"]);
    expect(lineChanges(seen, sb([{ clip: "Rain.mp4", startMs: 30_000 }], { range: [1_000, 60_000] }))).toEqual([]);
    expect(lineChanges(seen, sb([{ clip: "Rain.mp4", startMs: 30_000 }], { texts: ["a", "b", "c", "x"] }))).toEqual([]);
  });
});
