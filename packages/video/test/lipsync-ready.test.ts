// Nextgen step 2 (26 Nov 2026): lip-sync readiness (the verdict from measured frames) and the singing slots.
import { describe, expect, it } from "vitest";

import { judgeLipsync, LIPSYNC_LIMITS, type LipFrame } from "../src/lipsync-check";
import { matchSlots, singingMeter, singingSlots, singingTargetMs, type SlotLine, type SlotSection } from "../src/singing-slots";

// Frames every 1/3 s over `duration`, each made by `at(t)`.
const clip = (duration: number, at: (t: number) => Partial<LipFrame>) => ({
  duration,
  frames: Array.from({ length: Math.floor(duration * 3) }, (_, i) => ({ t: i / 3, face: true, face_frac: 0.4, yaw: 8, mouth_light: 120, sharp: 120, center: [0.5, 0.4] as [number, number], mouth_covered: false, ...at(i / 3) })),
});

describe("lip-sync check", () => {
  it("a front medium close-up: ✅ Good, the whole clip usable", () => {
    const r = judgeLipsync(clip(5, () => ({})));
    expect(r.verdict).toBe("good");
    expect(r.turn).toBe("front");
    expect(r.reasons[0]).toMatch(/front face, close-up, mouth clear/);
    expect(r.window).toEqual({ from: 0, to: 5 });
  });
  it("a side profile: ❌ with the reason", () => {
    const r = judgeLipsync(clip(5, () => ({ yaw: 75 })));
    expect(r.verdict).toBe("bad");
    expect(r.turn).toBe("near profile");
    expect(r.reasons).toContain("side profile");
    expect(r.window).toBeNull();
  });
  it("frontal turning to profile: ⚠️ with the best window and when the profile starts", () => {
    const r = judgeLipsync(clip(6, (t) => ({ yaw: t < 3 ? 5 : 80 })));
    expect(r.verdict).toBe("risky");
    expect(r.window!.from).toBe(0);
    expect(r.window!.to).toBeGreaterThanOrEqual(2.8);
    expect(r.window!.to).toBeLessThan(3.4);
    expect(r.reasons.join(" ")).toMatch(/side profile from 3\.0 s/);
  });
  it("a wide shot with a tiny face: ❌ face too small", () => {
    const r = judgeLipsync(clip(5, () => ({ face_frac: 0.03 })));
    expect(r.verdict).toBe("bad");
    expect(r.reasons[0]).toMatch(/^face too small \(3 % of the frame height/);
  });
  it("a hand over the mouth, deep shadow, blur and fast movement are named", () => {
    expect(judgeLipsync(clip(5, (t) => ({ mouth_covered: t >= 1 }))).reasons.join(" ")).toMatch(/mouth covered from 1\.0 s/);
    expect(judgeLipsync(clip(5, () => ({ mouth_light: 10 }))).reasons.join(" ")).toMatch(/mouth in deep shadow/);
    expect(judgeLipsync(clip(5, () => ({ sharp: 5 }))).reasons.join(" ")).toMatch(/face blurred/);
    expect(judgeLipsync(clip(5, (t) => ({ center: [0.5 + (Math.round(t * 3) % 2) * 0.4, 0.4] }))).reasons.join(" ")).toMatch(/fast face or camera movement/);
  });
  it("faces missing part of the time: said as a share of the clip", () => {
    const r = judgeLipsync(clip(6, (t) => (t >= 4 ? { face: false } : {})));
    expect(r.reasons.join(" ")).toMatch(/no face in 3\d % of the clip/);
    expect(r.window).toEqual({ from: 0, to: expect.closeTo(4, 0.25) });
  });
  it("the limits are in one place (for the calibration)", () => {
    expect(Object.keys(LIPSYNC_LIMITS)).toEqual(expect.arrayContaining(["faceBad", "yawBad", "shadowBad", "sharpBad", "moveBad"]));
  });
});

// A song: verse lines 1-4, chorus 5-8, verse 9-12, chorus 13-16; 4 s apart, each sung 3.2 s (line 11 held 3.9 s).
const L = (n: number, at: number, held = 3200): SlotLine => ({ number: n, text: `Line ${n}`, startMs: at, endMs: at + held, isHook: n === 5 || n === 13 });
const lines: SlotLine[] = Array.from({ length: 16 }, (_, i) => L(i + 1, 10_000 + i * 4000, i + 1 === 11 ? 3900 : 3200));
const sections: SlotSection[] = [
  { line: 1, lastLine: 4, kind: "verse", name: "Verse 1" },
  { line: 5, lastLine: 8, kind: "chorus", name: "Chorus 1" },
  { line: 9, lastLine: 12, kind: "verse", name: "Verse 2" },
  { line: 13, lastLine: 16, kind: "chorus", name: "Chorus 2" },
];

describe("singing slots", () => {
  it("a 90 s Reel: 15 s target, chorus entries first, slots on sung-line boundaries, none over 8 s", () => {
    const target = singingTargetMs(90_000, "short");
    expect(target).toBe(15_000);
    const r = singingSlots(lines, sections, { fromMs: 0, toMs: 90_000 }, target);
    expect(r.slots.map((s) => s.key)).toEqual(["L5-6", "L11-11", "L13-14"]);
    expect(r.slots.filter((s) => s.kind === "chorus").map((s) => s.label)).toEqual(["Chorus 1 · entry", "Chorus 2 · entry"]);
    for (const s of r.slots) {
      expect(lines.some((l) => l.startMs === s.fromMs)).toBe(true);
      expect(lines.some((l) => l.endMs === s.toMs)).toBe(true);
      expect(s.toMs - s.fromMs).toBeLessThanOrEqual(8000);
    }
    expect(r.totalMs).toBeGreaterThanOrEqual(15_000);
    expect(r.slots.find((s) => s.key === "L11-11")!.reason).toMatch(/long held line/);
  });
  it("a full video: 1/3; a split keeps a slot from crossing a line", () => {
    expect(singingTargetMs(180_000, "full")).toBe(60_000);
    const r = singingSlots(lines, sections, { fromMs: 0, toMs: 90_000 }, 15_000, { splits: [5] });
    expect(r.slots.find((s) => s.kind === "chorus")!.key).toBe("L5-5");
  });
  it("the target is a minimum: not enough sung lines in the part, the shortfall is said", () => {
    const r = singingSlots(lines.slice(0, 2), sections, { fromMs: 0, toMs: 90_000 }, 15_000);
    expect(r.linesShortMs).toBeGreaterThan(8000);
  });

  const good = (w: [number, number]) => ({ verdict: "good" as const, reasons: [], window: { from: w[0], to: w[1] }, turn: "front", faceShare: 0.4, goodShare: 1 });
  const risky = (w: [number, number]) => ({ ...good(w), verdict: "risky" as const });
  it("matching: a ✅ clip covering the slot first; a ⚠️ one second; one clip per slot; the meter", () => {
    const { slots } = singingSlots(lines, sections, { fromMs: 0, toMs: 90_000 }, 15_000);
    const m = matchSlots(slots, [{ name: "a.mp4", check: good([0, 8]) }, { name: "b.mp4", check: risky([0, 8]) }, { name: "c.mp4", check: { ...good([0, 1]), verdict: "bad" as const, window: null } }], lines);
    expect(m.map((x) => [x.slot.key, x.clip, x.full])).toEqual([["L5-6", "a.mp4", true], ["L11-11", null, false], ["L13-14", "b.mp4", true]]);
    expect(m[1].text).toBe("Verse 2 · peak: no clip good for lip sync; needs a front or 3/4 medium close-up");
    expect(singingMeter(m, 15_000).text).toBe("Singing: 14 s / 15 s · 1 slot needs a clip");
  });
  it("a 5 s clip on a 7.2 s slot: the best partial match, its coverage and a split on a sung-line boundary", () => {
    const { slots } = singingSlots(lines, sections, { fromMs: 0, toMs: 90_000 }, 5000);
    const m = matchSlots(slots, [{ name: "mj.mp4", label: "Bride smile", check: good([0.2, 5.4]) }], lines);
    expect(m[0].slot.key).toBe("L5-6");
    expect(m[0].full).toBe(false);
    expect(m[0].coverMs).toBe(5200);
    expect(m[0].splitAfter).toBe(5);
    expect(m[0].text).toBe("Bride smile covers 5.2 s of 7.2 s: split after line 5");
  });
  it("accepted and ignored suggestions are kept", () => {
    const { slots } = singingSlots(lines, sections, { fromMs: 0, toMs: 90_000 }, 15_000);
    const clips = [{ name: "a.mp4", check: good([0, 8]) }, { name: "b.mp4", check: good([0, 8]) }];
    const m = matchSlots(slots, clips, lines, { accepted: { "L13-14": "a.mp4" }, ignored: { "L5-6": ["b.mp4"] } });
    expect(m.find((x) => x.slot.key === "L13-14")).toMatchObject({ clip: "a.mp4", accepted: true });
    expect(m.find((x) => x.slot.key === "L5-6")!.clip).toBeNull();
  });
});
