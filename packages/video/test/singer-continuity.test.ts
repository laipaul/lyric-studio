// Singing clips in a row (28 Nov 2026, Paul: "the singing clip is squeezed now and the sync is late too"): a singer never loses
// screen time to the lead-in rule (it only ever cuts in EARLIER), and when the next line's singing clip has no footage yet, the
// one before plays on, in time, as long as ITS footage lasts; the next one cuts in as soon as its own footage allows (off the beat
// if need be), never earlier than the other's last frame and never before its own first allowed frame.
import { describe, expect, it } from "vitest";

import { getCutPoints, planAnchors, type ResolvedAnchor } from "../src";
import { grid } from "./helpers";

const beats = grid(120, 240, 500); // beats every 0.5 s from 0:00.5 (15 frames from frame 15), a bar every 2 s
const plan = getCutPoints(beats, { start_ms: 10_500, end_ms: 40_500 }, { cutRate: "1x" });
const start = plan.start_frame; // 315
const ra = (n: number, lyric: number, sync: number, footageFrames: number): ResolvedAnchor => ({ line: n, text: `line ${n}`, lyric, clipId: `c${n}`, clipName: `c${n}.mp4`, clipInMs: null, transition: "cut", syncMs: sync, footageFrames });
// Section-relative lines: A shows at 100 (song 415), sung to 190; B shows at 195 (song 510), sung from 203, to 290.
const lines = [
  { startFrame: 100, endFrame: 200, sungEndFrame: 190, stampFrame: 108 },
  { startFrame: 195, endFrame: 300, sungEndFrame: 290, stampFrame: 203 },
];
const syncFrame = (ms: number) => Math.round((ms * 30) / 1000);
const cutOf = (p: ReturnType<typeof planAnchors>, line: number) => syncFrame(p.uses.find((u) => u.line === line)!.at_ms!);

describe("singing clips in a row", () => {
  it("the next clip has no footage yet: the one before plays on to its last frame, the next cuts in at its first allowed frame (off the beat), both in time", () => {
    // A: footage 13.0 s to 16.33 s (100 frames, song frames 390..490). B: footage from 16.7 s (frame 501), first shown frame 503.
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, 100), ra(6, 1, 16_700, 100)], lines, { singerFade: true });
    const b = cutOf(p, 6);
    expect(b).toBe(503); // footage 501 + 2 skipped frames: not the beat at 17.0 (508)
    expect(b).toBeGreaterThanOrEqual(Math.ceil((16_700 * 30) / 1000) + 2);
    expect(p.uses.find((u) => u.line === 6)!.why).toMatch(/right after line 5's singing clip ends/);
    expect(p.uses.find((u) => u.line === 6)!.lead_in_ms).toBeGreaterThan(0);
    // A is never faded or cut short: no soft-entry shift for B (the singer before it is a singer).
    expect(b - 490).toBeLessThanOrEqual(13); // the bridge is only what the footage lacks (490..503)
  });

  it("the next clip's footage starts before the other ends: the one before plays to its last frame, then the next, in time", () => {
    // B footage from 16.0 s (frame 480, first shown 482); A ends at frame 490.
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, 100), ra(6, 1, 16_000, 150)], lines, { singerFade: true });
    expect(cutOf(p, 6)).toBe(490); // exactly A's end: no held frame, B is in time (clip frame 490 - 480)
  });

  it("a next line far after the first one is placed as before (no early cut)", () => {
    const far = [lines[0], { startFrame: 300, endFrame: 400, sungEndFrame: 390, stampFrame: 308 }];
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, 100), ra(6, 1, 16_000, 400)], far, { singerFade: true });
    expect(cutOf(p, 6)).toBe(553); // the downbeat at 18.5 s (555 - 2) before its line, not right after A
  });

  it("the lead-in rule never shortens a singer: with its footage starting early, the cut is the first beat with footage, not a later one", () => {
    // Take footage from 14.6 s (frame 438, first shown 440); line sung from song frame 423 + 108 ... A alone: shows at song 415.
    const p = planAnchors(plan, beats, [ra(5, 0, 14_600, 300)], lines, { singerFade: true });
    const cut = cutOf(p, 5);
    expect(cut).toBeGreaterThanOrEqual(440);
    expect(cut).toBeLessThanOrEqual(448); // the beat at 15.0 (frame 450 - 2), as before the lead-in rule
  });

  it("a singer cut in by the soft entry is only ever earlier than its beat (never later), on the beat when the footage lacks a fade", () => {
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, 300)], lines, { singerFade: true });
    const q = planAnchors(plan, beats, [ra(5, 0, 13_000, 300)], lines, { singerFade: false });
    expect(cutOf(p, 5)).toBe(cutOf(q, 5) - 10); // 12 frames before the beat instead of 2
  });
});

describe("a singer that follows directly with no breath to show", () => {
  it("says so in plain words", () => {
    // B footage first shown at 510: its sung start (518) is 8 frames later: under the 0.4 s lead-in.
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, 100), ra(6, 1, 16_900, 100)], lines, { singerFade: true });
    expect(p.notes.join(" ")).toMatch(/line 6: follows line 5's singing clip directly/);
  });
});
