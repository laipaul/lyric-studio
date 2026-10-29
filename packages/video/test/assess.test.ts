// The pro assessment (Step C): QA warnings become one verdict with plain-words points and creative
// actions; it learns from approved videos; the strongest of several; the Canvas prefers longer loops.
import { describe, expect, it } from "vitest";

import { assessVideo, chooseCanvasFit, canvasLengths, strongest } from "../src";

const reviewLine = { check: "Line starts to review", details: ['line 22 "Friends are a good thing": flagged for review (the signals do not agree); kept where the alignment has it'] };
const cutLine = { check: "Section start/end", details: ['the video ends at 1:42.1 in the song while line 16 "I wasn\'t lost" is sung'] };

describe("pro assessment", () => {
  it("nothing a viewer would notice: ready to post, with what the app handled", () => {
    const a = assessVideo({ problems: [], decisions: ["Pacing: a calm song …", "Ending: a soft fade …"] });
    expect(a).toMatchObject({ verdict: "ready", headline: "Ready to post", points: [], handled: ["Pacing: a calm song …", "Ending: a soft fade …"] });
  });
  it("small things: good, each in plain words with a creative action", () => {
    const a = assessVideo({ problems: [reviewLine, { check: "Clips repeated within 3 shots", details: ["shot 5 (0:42.3) repeats 05_dress.mp4 from shot 3"] }] });
    expect(a.verdict).toBe("good");
    expect(a.headline).toBe("Good — 2 things to improve");
    expect(a.points[0]).toEqual({ code: "review:22", major: false, text: "Line 22 “Friends are a good thing” may start a little early or late (the app was not sure).", action: 'Listen to it in the Lyrics tab (▶), then nudge it or mark it "Checked by ear".' });
    expect(a.points[1].text).toBe("The same clip comes back within a few seconds (05_dress.mp4 at 0:42).");
  });
  it("a sung line cut: not ready, the serious point first", () => {
    const a = assessVideo({ problems: [reviewLine, cutLine] });
    expect(a.verdict).toBe("not-ready");
    expect(a.headline).toBe("Not ready — fix 1 thing first");
    expect(a.points[0]).toMatchObject({ major: true, text: "The video ends while line 16 “I wasn't lost” is being sung." });
  });
  it("slow motion below 0.75x and a short Canvas are pointed out with what would fix them", () => {
    const a = assessVideo({ problems: [], shots: [{ start_s: 0, speed: 1, hold: false, photo: false }, { start_s: 42, speed: 0.7, hold: false, photo: false }], canvas: { seconds: 3, possibleS: 8, needClipS: 6.4 } });
    expect(a.points.map((p) => p.code)).toEqual(["slow-motion", "canvas-short"]);
    expect(a.points[0].text).toBe("One shot plays in slow motion below 0.75x (from 0:42) and may look choppy.");
    expect(a.points[1]).toMatchObject({ text: "The Canvas loop is only 3.0 s (8.0 s is possible).", action: 'Add a vertical clip of at least 7 s (or pick one with "Use for Canvas").' });
  });
  it("learns: a point approved twice stops counting", () => {
    expect(assessVideo({ problems: [reviewLine], acceptedCodes: { "review:22": 1 } }).verdict).toBe("good");
    const a = assessVideo({ problems: [reviewLine], acceptedCodes: { "review:22": 2 } });
    expect(a.verdict).toBe("ready");
    expect(a.accepted.map((p) => p.code)).toEqual(["review:22"]);
  });
  it("the strongest of several videos, only when it is clearly better", () => {
    const v = (name: string, problems: (typeof reviewLine)[]) => ({ name, assessment: assessVideo({ problems }) });
    expect(strongest([v("v1", [reviewLine]), v("v2", []), v("v3", [reviewLine, cutLine])])).toEqual({ name: "v2", why: "nothing to improve; v1: 1, v3: 2" });
    expect(strongest([v("v1", []), v("v2", [])])).toBeNull();
  });
  it("a prediction says so", () => {
    expect(assessVideo({ problems: [], prediction: true }).headline).toBe("Ready to post (prediction before rendering)");
  });
});

describe("Canvas: the longest loop first, slowed gently rather than short", () => {
  const lengths = canvasLengths(120); // 4, 3, 2 bars = 8, 6, 4 s
  it("6 s clips make 3 bars at 0.92x instead of 2 bars at normal speed", () => {
    expect(chooseCanvasFit(lengths, [180], 15, 0)).toMatchObject({ fallback: "fewer-bars", length: { bars: 3 }, rates: [0.92] });
  });
  it("a 7 s clip makes the full 8 s at 0.82x; a long clip at normal speed wins", () => {
    expect(chooseCanvasFit(lengths, [210], 15, 0)).toMatchObject({ fallback: "slow", length: { bars: 4 }, rates: [0.82] });
    expect(chooseCanvasFit(lengths, [210, 300], 15, 0)).toMatchObject({ fallback: "none", length: { bars: 4 }, rates: [null, 1] });
  });
  it("very short clips still use the old fallbacks (0.6x on the shortest loop, then a photo)", () => {
    expect(chooseCanvasFit(lengths, [90], 15, 0)).toMatchObject({ fallback: "slow", length: { bars: 2 }, rates: [0.66] });
    expect(chooseCanvasFit(lengths, [60], 15, 1)).toMatchObject({ fallback: "photo" });
  });
});
