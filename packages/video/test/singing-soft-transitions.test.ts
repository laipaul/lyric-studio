// The soft entry into and exit out of singing clips (28 Nov 2026, Paul: "the transition into singing clips is harsh again").
// A singing clip is locked to the song at 1.00x: never moved, slowed, frozen or faded. The B-roll beside it carries the
// dissolve: the shot before plays on past the cut and fades out over the singer's first 0.4 s; the shot after starts early and
// fades in over the singer's last 0.4 s. Every source alike: all of them are anchors with a sync time.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileHyperframes, composeProps, getCutPoints, type LyricVideoProps, type RawLyric, type RenderBase, type ResolvedAnchor } from "../src";
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
const line = (text: string, startMs: number, sungEndMs: number, endMs = sungEndMs + 1_000): RawLyric => ({ text, start_ms: startMs, end_ms: endMs, isHook: false, sung_end_ms: sungEndMs });
const LYRICS: RawLyric[] = [
  line("Verse one", 11_000, 13_800), // line 3
  line("Hold my hands", 15_450, 19_000), // line 5: on screen 0:15.2, the bar at 0:14.5
  line("Look at me", 21_000, 24_000), // line 6
  line("Close behind", 21_900, 24_500), // line 7
  line("Turn around", 30_450, 33_000), // line 9
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
const songFrame0 = Math.round((10_500 * 30) / 1000);
const singer = { id: "sings.mp4", name: "sings.mp4", duration_ms: 25_000, path: "cache/sings.mp4", durationFrames: 750 };
const withSinger = (anchors: ResolvedAnchor[], over: Partial<RenderBase> = {}) => base(10_500, 40_500, anchors, { clips: [...clips, singer], ...over });
const choices = { seed: 1, style: "simple" as const, order: "story" as const };
const hide = { fromMs: 19_500, toMs: 21_500, clipId: "hands.mp4", clipName: "hands.mp4", clipInMs: null };
type Props = ReturnType<typeof composeProps>["props"];

// Each way a singing clip gets here: the same anchor with a sync time (the song time of the clip's first frame).
const SOURCES: { name: string; sync: number }[] = [
  { name: "an InfiniteTalk take with a long lead-in (starts 1 s before the cut)", sync: 13_433 },
  { name: "an InfiniteTalk take with half a second of lead-in", sync: 14_000 },
  { name: "a shot of a music video, cut out exactly at the cut (no lead-in)", sync: 14_433 },
  { name: "an MV Generator take trimmed exactly to the song range (starts after the downbeat)", sync: 14_450 },
];

// The singing shots of a composition, with the checks that hold for every source.
function singingShots(props: Props, sync: number): number[] {
  const syncFrames = Math.round((sync * 30) / 1000);
  const idx = props.shots.map((s, i) => (s.src === "cache/sings.mp4" ? i : -1)).filter((i) => i >= 0);
  for (const i of idx) {
    const s = props.shots[i];
    expect(s.playbackRate).toBe(1); // never slowed
    expect(s.dissolve).toBeUndefined(); // never faded in: full from its cut frame
    expect(s.tail ?? 0).toBe(0); // never played on past its end
    expect(s.tailOver).toBeUndefined();
    expect(s.holdLastFrame).toBe(false); // never frozen
    // Exactly in time on every frame: the clip's frame is the song's frame minus the clip's first frame.
    for (let f = 0; f < s.duration; f++) expect(s.clipStartFrame + f).toBe(songFrame0 + s.start + f - syncFrames);
    expect(s.clipStartFrame + s.duration).toBeLessThanOrEqual(singer.durationFrames);
  }
  return idx;
}
// Clip frames a shot plays up to (one past), with its early start and tail.
const playsUntil = (s: Props["shots"][number]) => s.clipStartFrame + Math.ceil(((s.dissolve?.before ?? 0) + s.duration + (s.tail ?? 0) - 1) * s.playbackRate) + 1;

describe("a soft entry into and exit out of every kind of singing clip", () => {
  for (const src of SOURCES) {
    it(`${src.name}: the shot before dissolves out over its first 0.4 s, the shot after dissolves in over its last 0.4 s`, () => {
      const a = anchor(1, "sings.mp4", { clipInMs: null, syncMs: src.sync });
      const { props, anchors } = composeProps(withSinger([a]), choices);
      const [i] = singingShots(props, src.sync);
      const before = props.shots[i - 1];
      const after = props.shots[i + 1];
      // Entry: the B-roll before plays on 12 frames (0.4 s) past the cut, on top, and fades out; the cut did not move.
      expect(before.tail).toBe(12);
      expect(before.tailOver).toBe(true);
      expect(before.start + before.duration).toBe(props.shots[i].start);
      // It plays real footage the whole time (never past the clip's last frame, never a frozen frame).
      expect(before.holdLastFrame).toBe(false);
      expect(playsUntil(before)).toBeLessThanOrEqual(before.clipDurationFrames);
      // Exit: the B-roll after starts 12 frames early and fades in over the singer's last 12 frames; the singer is not touched.
      expect(after.dissolve).toEqual({ before: 12, after: 0 });
      expect(after.start).toBe(props.shots[i].start + props.shots[i].duration);
      expect(after.clipStartFrame).toBeGreaterThanOrEqual(0);
      expect(playsUntil(after)).toBeLessThanOrEqual(after.clipDurationFrames);
      // Both dissolves lie inside the singer's own span (0.3 to 0.5 s of its first / last frames).
      expect(props.shots[i].duration).toBeGreaterThanOrEqual(24);
      expect(anchors!.uses[0].transition).toBe("dissolve");
    });
  }

  it("the singer coming back after a hidden moment: the cut-away dissolves in over the singer's end, and out over the returning singer", () => {
    const a = anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500, throughLyric: 4, hides: [hide] });
    const { props } = composeProps(withSinger([a]), choices);
    const idx = props.shots.map((s, i) => (s.src === "cache/sings.mp4" ? i : -1)).filter((i) => i >= 0);
    expect(idx).toHaveLength(2); // before and after the hidden moment
    const [first, second] = idx;
    const cover = props.shots[first + 1];
    expect(cover.src).toBe("cache/hands.mp4");
    expect(second).toBe(first + 2);
    expect(cover.dissolve).toEqual({ before: 12, after: 0 });
    expect(cover.tail).toBe(12);
    expect(cover.tailOver).toBe(true);
    expect(playsUntil(cover)).toBeLessThanOrEqual(cover.clipDurationFrames);
    for (const i of idx) {
      const s = props.shots[i];
      expect(s.dissolve).toBeUndefined();
      expect(s.playbackRate).toBe(1);
      expect(s.tail ?? 0).toBe(0);
      for (let f = 0; f < s.duration; f++) expect(s.clipStartFrame + f).toBe(songFrame0 + s.start + f - Math.round((13_500 * 30) / 1000)); // lips in time on every frame
    }
  });

  it("a Mini film: the singing clip plays over the film on its lines and is entered and left just as softly", () => {
    const plan = section(10_500, 40_500);
    const filmShots = plan.cuts.map((_, i) => clipNames[i % 6]);
    filmShots.push(clipNames[plan.cuts.length % 6]);
    const { props } = composeProps(withSinger([anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500 })], { filmShots }), choices);
    const [i] = singingShots(props, 13_500);
    expect(props.shots[i - 1]).toMatchObject({ tail: 12, tailOver: true });
    expect(props.shots[i + 1].dissolve).toEqual({ before: 12, after: 0 });
  });

  it("a B-roll with no footage left to play on: no frozen frame from the dissolve, a hard cut with a note in plain words", () => {
    // Every other clip is 1.5 s: each shot uses all of it (slowed to the limit, or held by design, as before): nothing to play on.
    const tiny = clips.map((c) => ({ ...c, duration_ms: 1_500, durationFrames: 45 }));
    const { props } = composeProps(withSinger([anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500 })], { clips: [...tiny, singer] }), choices);
    const [i] = singingShots(props, 13_500);
    const before = props.shots[i - 1];
    expect(playsUntil(before)).toBeGreaterThanOrEqual(before.clipDurationFrames - 1); // the shot already uses the clip to its last frame (slowed to the limit)
    expect(before.tail).toBeUndefined();
    expect(before.tailOver).toBeUndefined();
    expect(props.shots[i].dissolve).toBeUndefined();
    expect(props.shots[i].fitNotes).toEqual(["a hard cut into this singing take (the clip before it has no footage left to play on)"]);
  });

  it("\"comes in with: cut\", the crisp style and an all-cuts variation still win: a hard cut as before", () => {
    const a = () => anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500 });
    const tr = { feel: "calm" as const, hooks: [], sung: [] };
    const none = (props: Props) => props.shots.every((s) => !s.tailOver && !s.dissolve);
    expect(none(composeProps(withSinger([a()]), { ...choices, transitions: "cut" }).props)).toBe(true);
    expect(none(composeProps(withSinger([a()], { transitions: { style: "crisp", ...tr } }), choices).props)).toBe(true);
    // The singing clip's own choice: no soft entry (the shot before has no tail).
    const own = composeProps(withSinger([a()], { transitions: { style: "auto", ...tr, byClip: { "sings.mp4": "cut" } } }), choices).props;
    const i = own.shots.findIndex((s) => s.src === "cache/sings.mp4");
    expect(own.shots[i - 1].tailOver).toBeUndefined();
    expect(own.shots[i - 1].tail).toBeUndefined();
    expect(own.shots[i].dissolve).toBeUndefined();
    // The clip coming in after the singer says cut: no early start.
    const after = composeProps(withSinger([a()]), choices).props.shots[i + 1];
    const afterCut = composeProps(withSinger([a()], { transitions: { style: "auto", ...tr, byClip: { [after.src.replace("cache/", "")]: "cut" } } }), choices).props;
    expect(afterCut.shots[i + 1].dissolve).toBeUndefined();
  });

  it("two singing takes back to back: nothing of either is faded", () => {
    const a = anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500, throughLyric: 1 });
    const b = anchor(2, "sings.mp4", { clipInMs: null, syncMs: 13_500 });
    const { props } = composeProps(withSinger([a, b]), choices);
    const idx = props.shots.map((s, i) => (s.src === "cache/sings.mp4" ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < idx.length; k++) {
      if (idx[k] !== idx[k - 1] + 1) continue;
      expect(props.shots[idx[k - 1]].tailOver).toBeUndefined();
      expect(props.shots[idx[k]].dissolve).toBeUndefined();
    }
  });

  it("lyric timing and the cuts do not change", () => {
    const soft = composeProps(withSinger([anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500 })]), choices).props;
    const hard = composeProps(withSinger([anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500 })]), { ...choices, transitions: "cut" }).props;
    expect(soft.lyrics).toEqual(hard.lyrics);
    expect(soft.cutFrames).toEqual(hard.cutFrames);
    expect(soft.shots.map((s) => [s.start, s.duration])).toEqual(hard.shots.map((s) => [s.start, s.duration]));
  });

  it("HyperFrames draws it from the same props: the shot fades out on top of the singer, which has no fade", () => {
    const { props } = composeProps(withSinger([anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500 })]), choices);
    const i = props.shots.findIndex((s) => s.src === "cache/sings.mp4");
    const { html } = compileHyperframes({ ...props, mediaBaseUrl: "" } as LyricVideoProps, {});
    const prev = props.shots[i - 1];
    const fade = html.match(new RegExp(`tl\\.fromTo\\("#s${i - 1}", \\{ opacity: 1 \\}, \\{ opacity: 0, duration: ([0-9.]+), ease: "power1\\.inOut", immediateRender: false \\}, ([0-9.]+)\\);`));
    expect(fade).not.toBeNull();
    expect(Number(fade![1])).toBeCloseTo(12 / 30, 4); // 0.4 s
    expect(Number(fade![2])).toBeCloseTo((prev.start + prev.duration) / 30, 4); // starting on the cut
    expect(html).not.toContain(`tl.fromTo("#s${i}",`); // the singer is never faded
    const z = (id: string) => Number(html.match(new RegExp(`id="${id}" [^>]*z-index:(\\d+)(?:[^>]*z-index:(\\d+))?`))?.slice(1).filter(Boolean).pop());
    expect(z(`s${i - 1}`)).toBeGreaterThan(z(`s${i}`)); // on top of the singer
  });

  it("the clips sit in their own stacking context, so the shots' z-indexes never reach the lyrics, vignette or bars", () => {
    // HyperFrames: #picture is a positioned layer with its own z-index (a stacking context, with or without a grade), below the text layer.
    const { props } = composeProps(withSinger([anchor(1, "sings.mp4", { clipInMs: null, syncMs: 13_500 })]), choices);
    const { html } = compileHyperframes({ ...props, mediaBaseUrl: "", lyricEffects: { verse: { name: "glide", intensity: "balanced" }, hook: { name: "karaoke-highlight", intensity: "balanced" }, accent: "#E8A3B5" } } as LyricVideoProps, {});
    const pic = html.match(/<div id="picture" style="([^"]*)"/)![1];
    expect(pic).toMatch(/position:absolute/);
    const picZ = Number(pic.match(/z-index:(\d+)/)![1]);
    const textZ = Number(html.match(/<div id="text" style="[^"]*z-index:(\d+)/)![1]);
    expect(textZ).toBeGreaterThan(picZ);
    for (const m of html.matchAll(/id="s\d+" [^>]*z-index:(\d+)/g)) expect(Number(m[1])).toBeLessThan(textZ);
    // Remotion: the clips wrapper isolates its children (no grade filter needed for that).
    expect(readFileSync(path.join(__dirname, "../src/LyricVideo.tsx"), "utf8")).toMatch(/style=\{\{ filter: grade\.filter, isolation: "isolate" \}\}/);
  });
});
