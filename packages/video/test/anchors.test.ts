// Story anchors: a clip lands on a lyric line, cutting in on the downbeat at or just before the line's
// on-screen time and staying until the line ends; the gaps are filled in story order; the conflicts are
// named; a 90 s Reel keeps more anchors than a 25 s TikTok of the same song.
import { describe, expect, it } from "vitest";

import { anchorProblems, anchorsInside, autoSection, checkAnchors, composeProps, getCutPoints, matchPinClips, parsePins, runQa, type RawLyric, type RenderBase, type ResolvedAnchor, type SectionLine } from "../src";
import { planVariations } from "../src/node";
import { grid } from "./helpers";

// 120 BPM from 0:00.5: a bar every 2 s (downbeats at 0:00.5, 0:02.5, ... 0:14.5, 0:16.5, ...).
const beats = grid(120, 240, 500);
const section = (start: number, end: number) => getCutPoints(beats, { start_ms: start, end_ms: end }, { cutRate: "1x" });
const clipNames = ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4", "05_e.mp4", "06_f.mp4", "hands.mp4", "short.mp4"];
const clips = clipNames.map((name) => {
  const ms = name === "short.mp4" ? 1_500 : 10_000;
  return { id: name, name, duration_ms: ms, path: `cache/${name}`, durationFrames: Math.round((ms * 30) / 1000) };
});
const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
// Lines by lyrics.txt number; on screen 0.25 s before their stamp.
const line = (text: string, startMs: number, sungEndMs: number, endMs = sungEndMs + 1_000): RawLyric => ({ text, start_ms: startMs, end_ms: endMs, isHook: false, sung_end_ms: sungEndMs });
const LYRICS: RawLyric[] = [
  line("Verse one", 11_000, 13_800), // line 3
  line("Hold my hands", 15_450, 19_000), // line 5: on screen 0:15.2, the bar at 0:14.5
  line("Look at me", 21_000, 24_000), // line 6: on screen 0:20.75, the bar at 0:20.5
  line("Close behind", 21_900, 24_500), // line 7: on screen 0:21.65, the same bar
  line("Turn around", 30_450, 33_000), // line 9: on screen 0:30.2
  line("Far away", 60_450, 63_000), // line 11
  line("Coming home", 85_450, 88_000), // line 14
];
const NUMBERS = [3, 5, 6, 7, 9, 11, 14];
const anchor = (lyric: number, clip: string, more: Partial<ResolvedAnchor> = {}): ResolvedAnchor => ({
  line: NUMBERS[lyric], text: LYRICS[lyric].text, lyric, clipId: clip, clipName: clip, clipInMs: 0, transition: "cut", ...more,
});
function base(start: number, end: number, anchors: ResolvedAnchor[], over: Partial<RenderBase> = {}): RenderBase {
  const plan = section(start, end);
  return {
    plan, clips, audio: null, durationInFrames: plan.end_frame - plan.start_frame, lyrics: LYRICS,
    styles: { simple: { style, textSize: 64, hookFont: null, fonts: [] }, bold: { style, textSize: 72, hookFont: null, fonts: [] } },
    colour: "#fff", cinematicBars: false, pins: [], anchors, beats, ...over,
  };
}
const startFrame = Math.round((10_500 * 30) / 1000); // 315
const rel = (songMs: number, early = 2) => Math.round((songMs * 30) / 1000) - early - startFrame;

describe("story anchors", () => {
  it("an anchored clip cuts in on the downbeat at or just before its line and stays until the line ends", () => {
    const { props, anchors } = composeProps(base(10_500, 40_500, [anchor(1, "hands.mp4")]), { seed: 1, style: "simple" });
    const shot = props.shots.find((s) => s.src === "cache/hands.mp4")!;
    expect(shot.start).toBe(rel(14_500)); // the bar at 0:14.5 (2 frames early, as every cut)
    // Sung until 0:19.0: the regular cuts at 0:16.5 and 0:18.5 give way; the next cut is the bar at 0:20.5.
    expect(shot.start + shot.duration).toBe(rel(20_500));
    expect(props.shots.filter((s) => s.src === "cache/hands.mp4")).toHaveLength(1);
    expect(anchors!.uses).toEqual([{ line: 5, text: "Hold my hands", clip: "hands.mp4", used: true, shot: 2, at_ms: 14_433, transition: "cut", why: null }]);
    expect(anchors!.conflicts).toEqual([]);
  });

  it("the gaps are filled in story order (file-name order) with the other clips; clipIn sets where the clip starts", () => {
    const { props } = composeProps(base(10_500, 40_500, [anchor(1, "hands.mp4", { clipInMs: 2_000 })]), { seed: 1, style: "simple", order: "story" });
    const names = props.shots.map((s) => s.src.replace("cache/", ""));
    expect(names).toEqual(["01_a.mp4", "02_b.mp4", "hands.mp4", "03_c.mp4", "04_d.mp4", "05_e.mp4", "06_f.mp4", "short.mp4", "01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4", "05_e.mp4"]);
    expect(props.shots[2].clipStartFrame).toBe(60); // 2 s into hands.mp4
    // Shuffled gaps (a song setting): the anchored clip is still kept 3 shots away from its anchor.
    for (let seed = 1; seed <= 40; seed++) {
      const shuffled = composeProps(base(10_500, 40_500, [anchor(1, "hands.mp4")]), { seed, style: "simple", order: "shuffle" }).props.shots.map((s) => s.src);
      const at = shuffled.indexOf("cache/hands.mp4");
      shuffled.forEach((src, i) => i !== at && Math.abs(i - at) <= 3 && expect(src).not.toBe("cache/hands.mp4"));
    }
  });

  it("a 90 s Reel and a 25 s TikTok of the same song: each uses the anchors inside its section and lists the others", () => {
    const all = [anchor(1, "hands.mp4"), anchor(4, "03_c.mp4"), anchor(5, "05_e.mp4"), anchor(6, "06_f.mp4")];
    const reel = composeProps(base(10_500, 100_500, all), { seed: 1, style: "simple" }).anchors!;
    expect(reel.uses.map((u) => [u.line, u.used])).toEqual([[5, true], [9, true], [11, true], [14, true]]);
    expect(reel.notes).toEqual([]);
    const tiktok = composeProps(base(10_500, 35_500, all), { seed: 1, style: "simple" }).anchors!;
    expect(tiktok.uses.map((u) => [u.line, u.used, u.why])).toEqual([[5, true, null], [9, true, null], [11, false, "outside this section"], [14, false, "outside this section"]]);
    expect(tiktok.notes).toEqual(["not in this section: line 11 (05_e.mp4), line 14 (06_f.mp4)"]);
    expect(tiktok.conflicts).toEqual([]);
  });

  it("anchors too close: the second cuts in on a beat (named), or is not shown (named), never dropped silently", () => {
    const close = composeProps(base(10_500, 40_500, [anchor(2, "hands.mp4"), anchor(3, "01_a.mp4")]), { seed: 1, style: "simple" }).anchors!;
    expect(close.uses.map((u) => [u.line, u.used, u.at_ms])).toEqual([[6, true, 20_433], [7, true, 21_433]]);
    expect(close.conflicts).toEqual([
      'line 7 "Close behind" and line 6 are too close (one bar): line 7 "Close behind" cuts in on the beat at 0:21.5 instead of the downbeat',
      'line 6 "Look at me" (hands.mp4) cannot stay until its line ends (0:24.0): line 7 "Close behind" cuts in at 0:21.4',
    ]);
    const tooClose = { ...LYRICS[3], start_ms: 21_050 }; // on screen 0:20.8: no beat left after line 6's cut
    const none = composeProps(base(10_500, 40_500, [anchor(2, "hands.mp4"), anchor(3, "01_a.mp4")], { lyrics: LYRICS.map((l, i) => (i === 3 ? tooClose : l)) }), { seed: 1, style: "simple" }).anchors!;
    expect(none.uses.find((u) => u.line === 7)).toMatchObject({ used: false, why: "too close to line 6 (anchored at 0:20.4): no beat left for it" });
    expect(none.conflicts).toContain('line 7 "Close behind" (01_a.mp4) is not shown: too close to line 6 (anchored at 0:20.4): no beat left for it');
  });

  it("the same clip anchored twice nearby, and a clip shorter than its line (slowed: QA WARN)", () => {
    const twice = composeProps(base(10_500, 40_500, [anchor(1, "hands.mp4"), anchor(2, "hands.mp4")]), { seed: 1, style: "simple" }).anchors!;
    expect(twice.conflicts).toContain("lines 5 and 6 both land on hands.mp4, 6.0 s apart: the repeat is visible");
    const short = composeProps(base(10_500, 40_500, [anchor(1, "short.mp4")]), { seed: 1, style: "simple" });
    expect(short.anchors!.uses[0].playback_rate).toBe(0.5); // 1.5 s for a 6 s shot: 0.5x, then its last frame held
    expect(short.props.shots.find((s) => s.src === "cache/short.mp4")!.holdLastFrame).toBe(true);
  });

  it("a dissolve (~1 bar centred on the downbeat), per anchor or for a whole variation", () => {
    const { props } = composeProps(base(10_500, 40_500, [anchor(1, "hands.mp4", { transition: "dissolve" })]), { seed: 1, style: "simple" });
    const i = props.shots.findIndex((s) => s.src === "cache/hands.mp4");
    expect(props.shots[i].dissolve).toEqual({ before: 30, after: 30 }); // half a bar on each side (a bar = 60 frames)
    expect(props.shots[i - 1].tail).toBe(30);
    const cut = composeProps(base(10_500, 40_500, [anchor(1, "hands.mp4", { transition: "dissolve" })]), { seed: 1, style: "simple", transitions: "cut" });
    expect(cut.props.shots.some((s) => s.dissolve)).toBe(false);
    expect(cut.anchors!.uses[0].transition).toBe("cut");
  });

  it("an anchor wins over a pin on the same line (and says so)", () => {
    const pins = matchPinClips(parsePins("Hold my hands = 01_a.mp4\n").rules, clips).pins;
    const { props, anchors } = composeProps(base(10_500, 40_500, [anchor(1, "hands.mp4")], { pins }), { seed: 1, style: "simple" });
    expect(props.shots[2].src).toBe("cache/hands.mp4");
    expect(anchors!.notes).toEqual(['pins.txt line 1 "Hold my hands" (01_a.mp4) gives way to the anchor on line 5 (hands.mp4)']);
  });
});

describe("the Lyrics tab's checks (before any section is chosen)", () => {
  const lines = new Map(LYRICS.map((l, i) => [NUMBERS[i], { text: l.text, shownMs: l.start_ms - 250, sungEndMs: l.sung_end_ms! }]));
  const durations = new Map(clips.map((c) => [c.name, c.duration_ms] as [string, number | null]));
  const downbeats = beats.filter((b) => b.is_downbeat).map((b) => b.time_ms);

  it("names every conflict by line", () => {
    const problems = anchorProblems(
      [{ line: 6, clip: "hands.mp4" }, { line: 7, clip: "hands.mp4" }, { line: 5, clip: "short.mp4" }, { line: 2, clip: "01_a.mp4" }, { line: 9, clip: "missing.mp4" }],
      lines, durations, downbeats,
    );
    expect(problems).toEqual([
      { line: 2, problem: "line 2 is not a sung line of this song" },
      { line: 5, problem: "short.mp4 has 1.5 s, line 5 lasts 3.8 s: it will be slowed to 0.50x and its last frame held" },
      { line: 7, problem: "line 7 and line 6 land on the same bar: line 7 will cut in on a beat instead" },
      { line: 7, problem: "lines 6 and 7 both land on hands.mp4, 0.9 s apart: the repeat is visible" },
      { line: 9, problem: "missing.mp4 is not in the song's clips or its collections" },
    ]);
  });

  it("song.json anchors are checked, every problem named", () => {
    expect(checkAnchors([{ line: 9, clip: " hands.mp4 ", clipIn: 1.5, transition: "dissolve" }])).toEqual({ anchors: [{ line: 9, clip: "hands.mp4", clipIn: 1.5, transition: "dissolve" }], problems: [] });
    expect(checkAnchors([{ line: 0, clip: "a.mp4" }, { line: 3 }, { line: 4, clip: "b.mp4", transition: "wipe" }]).problems).toEqual([
      "anchors[0]: line must be a line number (1, 2, ...)",
      "anchors[1]: clip must be a clip file name",
      'anchors[2]: transition must be "cut" or "dissolve"',
    ]);
  });
});

describe("story anchors in pnpm make", () => {
  it("auto prefers the clean end that keeps more anchors (and says so), never cutting a sung line", () => {
    // Hook-first from 0:10.5; two clean chorus ends in the window: 0:36.5 (26 s) and 0:40.5 (30 s, the target).
    const l = (text: string, start: number, end: number): SectionLine => ({ text, start_ms: start, end_ms: end + 400, isHook: true, sung_end_ms: end });
    const lines = [l("You had a heart", 11_000, 14_000), l("And I had none", 15_000, 18_000), l("We were three", 19_000, 24_000), l("Now we are one", 25_000, 36_300), l("Heart for two", 37_000, 40_200), l("Again", 41_000, 49_000)];
    const options = { durationMs: 60_000, targetMs: 30_000, minMs: 25_500, maxMs: 34_500, hardMaxMs: 39_000, shortestMs: 22_500, anchorMode: "hook-first" as const };
    // Anchors on lines 2 and 4 (inside both) and on line 5 (sung until 0:40.2: only the later end keeps it).
    const anchors = [{ line: 2, shownMs: 14_750, sungEndMs: 18_000 }, { line: 4, shownMs: 24_750, sungEndMs: 36_300 }, { line: 5, shownMs: 36_750, sungEndMs: 40_200 }];
    const kept = (a: number, b: number) => anchorsInside(anchors, a, b);
    // The target alone would also pick 0:40.5; move the target so the anchors decide.
    const s = autoSection(lines, grid(120, 480, 500), { ...options, targetMs: 26_000, anchorsKept: kept });
    expect(s.end_ms).toBe(40_500);
    expect(s.reason).toContain("; anchors: keeps 3 of 3, more than 0:36.5 keeps 2");
    expect(s.cuts).toEqual([]);
    expect(autoSection(lines, grid(120, 480, 500), { ...options, targetMs: 26_000 }).end_ms).toBe(36_500); // without anchors: nearest the target
  });

  it('QA "Story anchors": conflicts and every slowed clip are a WARN naming the clip; outside anchors and pins are notes', () => {
    const report = composeProps(base(10_500, 35_500, [anchor(1, "short.mp4"), anchor(5, "05_e.mp4")]), { seed: 1, style: "simple" }).anchors!;
    const qa = runQa({ props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 750 }, shotClips: [], poolSize: 8, lyrics: [], frames: null, anchors: { ...report, missing: [] } });
    const check = qa.checks.find((c) => c.name === "Story anchors")!;
    expect(check.ok).toBe(false);
    expect(check.details).toEqual([
      'line 5 "Hold my hands": short.mp4 is slowed to 0.50x to cover its line (and its last frame may be held); choose a longer clip or an earlier clipIn',
      "used: line 5 -> short.mp4",
      "not in this section: line 11 (05_e.mp4)",
    ]);
    const fine = composeProps(base(10_500, 35_500, [anchor(1, "hands.mp4")]), { seed: 1, style: "simple" }).anchors!;
    expect(runQa({ props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 750 }, shotClips: [], poolSize: 8, lyrics: [], frames: null, anchors: { ...fine, missing: [] } }).checks.find((c) => c.name === "Story anchors")!.ok).toBe(true);
  });

  it("a story: every video in story order, differing by style, cut rate and cut / dissolve", () => {
    expect(planVariations(4, { rate: "1x" }).map((v) => [v.name, v.order, v.style, v.rate, v.transitions])).toEqual([
      ["v1", "story", "simple", "1x", "as-set"],
      ["v2", "story", "bold", "1x", "dissolve"],
      ["v3", "story", "simple", "0.5x", "as-set"],
      ["v4", "story", "bold", "2x", "cut"],
    ]);
    expect(planVariations(2).map((v) => v.order)).toEqual(["story", "shuffle"]); // no story: as before
  });
});
