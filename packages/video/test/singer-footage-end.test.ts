// A singing shot never plays past its own footage (28 Nov 2026, Paul: "the end of this singing video freezes a bit"): it ends where
// its footage ends (on the latest beat that still covers the line's sung end + release, else exactly at the last frame), the next
// shot takes the rest; no frame is ever held. When the footage ends before the line is sung, it says what would fix it.
import { describe, expect, it } from "vitest";

import { getCutPoints, planAnchors, assignClips, type ResolvedAnchor } from "../src";
import { sharedEdges, shotPiece, EDGE_TRIM_MS } from "../src/music-video";
import { grid } from "./helpers";

const beats = grid(120, 240, 500);
const plan = getCutPoints(beats, { start_ms: 10_500, end_ms: 40_500 }, { cutRate: "1x" });
const start = plan.start_frame;
const ra = (n: number, lyric: number, sync: number, footageFrames: number): ResolvedAnchor => ({ line: n, text: `line ${n}`, lyric, clipId: `c${n}`, clipName: `c${n}.mp4`, clipInMs: null, transition: "cut", syncMs: sync, footageFrames });
// Line A shows at section frame 100 (song 415), sung 108..190 (song 505), +9 frames of release = 514.
const lines = [{ startFrame: 100, endFrame: 200, sungEndFrame: 190, stampFrame: 108 }];
const sync = (ms: number) => Math.round((ms * 30) / 1000);
const shotEnd = (p: ReturnType<typeof planAnchors>, frame: number) => p.plan.cuts.find((c) => c.frame > frame)?.frame ?? p.plan.end_frame;

describe("a singing shot ends where its footage ends", () => {
  it("footage ends before the next regular cut: the shot ends on the latest beat at or before the footage end, the next shot fills", () => {
    // Without the footage limit this shot lasts to the first regular cut after the release. Footage: song frames 390..(390+n).
    const long = planAnchors(plan, beats, [ra(5, 0, 13_000, 1000)], lines, { singerFade: true });
    const at = sync(long.uses[0].at_ms!);
    const natural = shotEnd(long, at);
    const footage = natural - 390 - 6; // ends 6 frames before the natural cut, after the sung end + release
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, footage)], lines, { singerFade: true });
    const end = shotEnd(p, at);
    const footEnd = 390 + footage;
    expect(end).toBeLessThanOrEqual(footEnd); // never past the footage: nothing to hold
    expect(end).toBeGreaterThanOrEqual(start + 190 + 9); // the sung end and its release stay covered
    const onBeat = beats.some((b) => Math.round((b.time_ms * 30) / 1000) - 2 === end);
    expect(onBeat).toBe(true);
    expect(p.notes.join(" ")).not.toMatch(/covers only/);
  });

  it("no beat between the release and the footage end: it ends exactly at the footage end, off the beat", () => {
    const footEnd = start + 190 + 9 + 3; // 3 frames after the release: no beat there
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, footEnd - 390)], lines, { singerFade: true });
    const at = sync(p.uses[0].at_ms!);
    expect(shotEnd(p, at)).toBe(footEnd);
  });

  it("footage ends before the line is sung: no hold, cut at the footage end, and the note says what would help", () => {
    const footEnd = start + 150; // 40 frames before the sung end
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, footEnd - 390)], lines, { singerFade: true });
    const at = sync(p.uses[0].at_ms!);
    expect(shotEnd(p, at)).toBe(footEnd);
    expect(p.notes.join(" ")).toMatch(/line 5: the singing clip covers only .* s of the .* s line: a longer take or another shot would cover the whole line/);
  });

  it("compiled into shots, the singing shot holds no frame", () => {
    const footEnd = start + 150;
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, footEnd - 390)], lines, { singerFade: true });
    const clips = [
      { id: "c5", name: "c5.mp4", duration_ms: ((footEnd - 390) * 1000) / 30 },
      { id: "b1", name: "b1.mp4", duration_ms: 20_000 },
      { id: "b2", name: "b2.mp4", duration_ms: 20_000 },
    ];
    const shot = [...p.shots].find(([, a]) => a.clipId === "c5")![0];
    const shots = assignClips(p.plan, clips, 1, { order: "story", pins: new Map([[shot, "c5"]]), clipStarts: new Map([[shot, Math.max(0, start + p.plan.cuts[shot - 1].frame - start - 390)]]), anchored: new Set([shot]), exact: new Set([shot]), anchorOnly: new Set(["c5"]) });
    expect(shots[shot].hold_last_frame).toBe(false);
    expect(shots[shot + 1]?.clip_id).not.toBe("c5"); // the next shot is B-roll
  });
});

describe("two shots of one music video on consecutive lines", () => {
  const mvShots = [{ fromMs: 0, toMs: 4000 }, { fromMs: 4000, toMs: 9000 }, { fromMs: 9000, toMs: 12_000 }];
  const lines = [{ number: 15, shownMs: 1000 }, { number: 16, shownMs: 5000 }, { number: 20, shownMs: 10_000 }];
  it("the shared edge is not trimmed: the second starts where the first ends", () => {
    const shared = sharedEdges(mvShots, 0, 0, lines);
    expect(shared).toEqual({ before: false, after: true });
    const a = shotPiece(mvShots[0], 0, 12_000, null, shared);
    const b = shotPiece(mvShots[1], 0, 12_000, null, sharedEdges(mvShots, 1, 0, lines));
    expect(a.toMs).toBe(4000);
    expect(b.fromMs).toBe(4000);
    expect(b.toMs).toBe(9000); // line 20 is the next sung line after 16: shared as well
  });
  it("a shot whose neighbour is used on a later, not directly following line keeps its trim", () => {
    const far = [{ number: 15, shownMs: 1000 }, { number: 16, shownMs: 5000 }, { number: 18, shownMs: 10_000 }];
    const l = [...far, { number: 17, shownMs: 20_000 }]; // 17 sits between 16 and 18 in the list
    expect(sharedEdges(mvShots, 1, 0, l).after).toBe(false);
    expect(shotPiece(mvShots[1], 0, 12_000, null, sharedEdges(mvShots, 1, 0, l)).toMs).toBe(9000 - EDGE_TRIM_MS);
  });
  it("without a shared edge nothing changes", () => {
    expect(shotPiece({ fromMs: 4000, toMs: 9000 }, 0, 16_000, null)).toEqual({ fromMs: 4000 + EDGE_TRIM_MS, toMs: 9000 - EDGE_TRIM_MS });
  });
});

describe("two singing clips with a small hole between them", () => {
  const two = [{ startFrame: 100, endFrame: 200, sungEndFrame: 190, stampFrame: 108 }, { startFrame: 195, endFrame: 300, sungEndFrame: 290, stampFrame: 203 }];
  it("a hole of 6 frames or less: the first holds its last frame to the second's cut, no B-roll flash between", () => {
    // A footage ends at song frame 490; B footage from 16.3 s (489) -> first shown 491 + ... use 16.4 s (492), first shown 494: hole 4 frames.
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, 100), ra(6, 1, 16_400, 150)], two, { singerFade: true });
    const a = sync(p.uses.find((u) => u.line === 5)!.at_ms!);
    const b = sync(p.uses.find((u) => u.line === 6)!.at_ms!);
    expect(shotEnd(p, a)).toBe(b); // one cut between the two singers: no shot of B-roll in between
    expect(b - 490).toBeLessThanOrEqual(6);
    expect(p.notes.join(" ")).toMatch(/line 5: line 6's singing clip starts .* that frame is held/);
  });
  it("a bigger hole: the footage end is a cut as before (the next clip fills)", () => {
    const p = planAnchors(plan, beats, [ra(5, 0, 13_000, 100), ra(6, 1, 16_900, 100)], two, { singerFade: true });
    const a = sync(p.uses.find((u) => u.line === 5)!.at_ms!);
    expect(shotEnd(p, a)).toBeLessThanOrEqual(490);
  });
});
