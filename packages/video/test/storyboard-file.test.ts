// Theme v2 step 2d: the storyboard file (src/storyboard-file.ts). The plan of one video saved with song-time
// milliseconds must give every frame of the plan back (the golden test against a real approved video:
// test/golden/here-with-me-reels.manifest.json, skipped until the user's manifest is copied there).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildStoryboard, frameOf, keepShotIds, sectionsFromLines, storyboardTiming, unmatchedText, unusedSongEdits, type PlanForStoryboard, type StoryboardFile } from "../src/storyboard-file";

const FPS = 30;

function plan(over: Partial<PlanForStoryboard> = {}): PlanForStoryboard {
  // A 30 s Reel from song frame 1237 (0:41.233): odd frame numbers on purpose (ms are not whole frames).
  const shots = [
    { start: 0, duration: 97, playbackRate: 1 },
    { start: 97, duration: 131, playbackRate: 0.9, dissolve: { before: 6, after: 6 } },
    { start: 228, duration: 113, playbackRate: 1, kind: "photo" as const },
    { start: 341, duration: 559, playbackRate: 1 },
  ];
  return {
    id: "reels-1",
    platform: "reels",
    song: { title: "Here With Me", artist: "Life Lyrics", instrumental: false },
    inputs: { song: { slot: "song", file: "Here With Me (Master).wav", sha256: "9f2c" }, vocals: null, lyrics: { slot: "lyrics", file: "hwm.txt", sha256: "c07d" }, alignment: "aligned-abc-20261101-213455.lrc", clips: { file: "clips.json", sha256: null } },
    theme: { name: "Here With Me", version: 1 },
    fps: FPS,
    size: { width: 1080, height: 1920 },
    section: { mode: "auto", startMs: 41233, endMs: 71233, reason: "verse 2 into the chorus", locked: false },
    songStartFrame: 1237,
    durationInFrames: 900,
    bpm: 76,
    beats: [41233, 42022, 42811, 43601, 44390, 90000].map((t, i) => ({ time_ms: t, is_downbeat: i % 4 === 0 })),
    shots,
    shotInfo: [
      { clip: "01_veil.mp4", inS: 0, outS: 3.23, dip: false, anchorLine: null, warnings: [] },
      { clip: "07_rings.mov", inS: 1.4, outS: 5.33, dip: false, anchorLine: 14, warnings: [] },
      { clip: "03_photo.jpg", inS: 0, outS: 0, dip: true, anchorLine: null, warnings: [] },
      { clip: "14_city.mp4", inS: 0.5, outS: 19.13, dip: false, anchorLine: null, warnings: ["the clip is too short: its last frame is held for 0.6 s"] },
    ],
    lyrics: [
      { text: "I walked the shore alone", startFrame: 41, endFrame: 133, stampFrame: 49, sungEndFrame: 121, enterFrame: 11 },
      { text: "Stay with me tonight", startFrame: 133, endFrame: 260, stampFrame: 140, sungEndFrame: 233, isHook: true },
      { text: "Here with me", startFrame: 260, endFrame: 900, stampFrame: 267, sungEndFrame: 345, isHook: true },
    ],
    lineNumbers: [9, 14, 15],
    handSet: [14],
    instrumental: false,
    cards: [
      { id: "title", type: "title", text: "Here With Me", startFrame: 0, endFrame: 75 },
      { id: "tagline", type: "tagline", text: "ここにいて", startFrame: 0, endFrame: 75 },
    ],
    timeline: { cuts: [], slips: [] },
    assessment: { verdict: "good", headline: "Good · 1 thing to improve", points: [] },
    previous: null,
    now: "2026-11-09T08:00:00.000Z",
    app: "b95ad17",
    ...over,
  };
}

describe("storyboard file", () => {
  it("gives every frame of the plan back (shots, lines, cards, length)", () => {
    const p = plan();
    const t = storyboardTiming(buildStoryboard(p));
    expect(t.songStartFrame).toBe(p.songStartFrame);
    expect(t.durationInFrames).toBe(p.durationInFrames);
    expect(t.shots.map((s) => [s.start, s.duration])).toEqual(p.shots.map((s) => [s.start, s.duration]));
    expect(t.lyrics.map(({ id: _id, ...rest }) => rest)).toEqual(p.lyrics.map(({ text: _t, isHook: _h, ...rest }) => rest));
    expect(t.cards).toEqual(p.cards.map((c) => ({ id: c.id, startFrame: c.startFrame, endFrame: c.endFrame })));
  });

  it("song milliseconds round-trip to the same frame for every frame of an hour", () => {
    for (let f = 0; f < 3600 * FPS; f++) expect(frameOf(Math.round((f * 1000) / FPS), FPS)).toBe(f);
  });

  it("holds the output, beat grid, sections, text items and shots of the agreed format", () => {
    const sb = buildStoryboard(plan());
    expect(sb.schemaVersion).toBe(1);
    expect(sb.output).toMatchObject({ platform: "reels", format: "9:16", size: [1080, 1920], fps: 30, range: { mode: "auto", startMs: 41233, endMs: 71233 }, theme: { name: "Here With Me" } });
    expect(sb.analysis.beatsMs).toEqual([41233, 42022, 42811, 43601, 44390]); // inside the video only
    expect(sb.analysis.downbeatsMs).toEqual([41233, 44390]);
    expect(sb.analysis.sections.map((s) => [s.id, s.startMs])).toEqual([["sec-verse-1", 42600], ["sec-chorus-1", 45667]]);
    expect(sb.text.map((t) => [t.id, t.kind, t.timing ?? null])).toEqual([
      ["card-title", "card", null],
      ["card-tagline", "card", null],
      ["line-9", "lyric", "aligned"],
      ["line-14", "lyric", "hand"],
      ["line-15", "lyric", "aligned"],
    ]);
    expect(sb.shots.map((s) => [s.id, s.clip, s.transitionIn.type, s.carries])).toEqual([
      ["sh-01", "01_veil.mp4", "cut", null],
      ["sh-02", "07_rings.mov", "dissolve", "line-14"],
      ["sh-03", "03_photo.jpg", "dip", null],
      ["sh-04", "14_city.mp4", "cut", null],
    ]);
    expect(sb.shots[1].locked).toEqual(["carries"]); // a story anchor is the user's choice
    expect(sb.shots[3].assessment).toEqual([{ level: "warn", text: "shot 4: the clip is too short: its last frame is held for 0.6 s" }]);
    // An instrumental: story sentences.
    expect(buildStoryboard(plan({ instrumental: true })).text.filter((t) => t.kind === "story").length).toBe(3);
  });

  it("imports moved cuts and slips as locks; the ones no shot matches are listed, never dropped", () => {
    const p = plan();
    const songMs = (frame: number) => Math.round(((p.songStartFrame + frame) * 1000) / FPS);
    const cut2 = songMs(97) / 1000; // the cut into shot 2, where the user moved it
    const sb = buildStoryboard(plan({
      timeline: {
        cuts: [
          { from: cut2 - 0.5, to: cut2 },
          { from: 50, to: 50.4 }, // inside the video, but no cut there now
          { from: 150, to: 151 }, // another part of the song: another video's edit
        ],
        slips: [
          { at: cut2, clip: "07_rings.mov", in: 1.4 },
          { at: songMs(228) / 1000, clip: "09_other.mp4", in: 2 }, // the photo plays there now
        ],
      },
    }));
    expect(sb.shots[0].locked).toEqual(["endMs"]);
    expect(sb.shots[1].locked).toEqual(["carries", "startMs", "trim"]);
    expect(sb.edits.unmatched.map((u) => [u.kind, u.atMs, u.nearestShot])).toEqual([
      ["cut", 50400, "sh-03"],
      ["slip", songMs(228), "sh-03"],
    ]);
    const text = unmatchedText(sb);
    expect(text[0]).toMatch(/^Moved cut not used: the cut you moved from 0:50\.0 to 0:50\.4 .* \(nearest: shot 3 at 0:48\.8\)\. It is kept in clips\.json\.$/);
    expect(text[1]).toMatch(/^Slip not used: your slip of 09_other\.mp4 .* \(03_photo\.jpg plays there\)/);
  });

  it("keeps shot ids when the plan is made again", () => {
    const first = buildStoryboard(plan());
    // A new plan: shot 2 a little longer, a new shot in between, the city shot unchanged.
    const second = buildStoryboard(plan({
      previous: first,
      shots: [
        { start: 0, duration: 90, playbackRate: 1 },
        { start: 90, duration: 140, playbackRate: 1 },
        { start: 230, duration: 60, playbackRate: 1 },
        { start: 290, duration: 51, playbackRate: 1 },
        { start: 341, duration: 559, playbackRate: 1 },
      ],
      shotInfo: [
        { clip: "01_veil.mp4", inS: 0, outS: 3, dip: false, anchorLine: null, warnings: [] },
        { clip: "07_rings.mov", inS: 1.4, outS: 6, dip: false, anchorLine: 14, warnings: [] },
        { clip: "22_new.mp4", inS: 0, outS: 2, dip: false, anchorLine: null, warnings: [] },
        { clip: "03_photo.jpg", inS: 0, outS: 0, dip: false, anchorLine: null, warnings: [] },
        { clip: "14_city.mp4", inS: 0.5, outS: 19, dip: false, anchorLine: null, warnings: [] },
      ],
    }));
    expect(second.shots.map((s) => s.id)).toEqual(["sh-01", "sh-02", "sh-05", "sh-03", "sh-04"]);
    expect(second.history.nextShot).toBe(6);
    // The same clip twice: each old id is used once, by the shot that overlaps it most.
    const ids = keepShotIds([{ clip: "a", startMs: 0, endMs: 1000 }, { clip: "a", startMs: 1000, endMs: 3000 }], { ...first, shots: [{ ...first.shots[0], id: "sh-09", clip: "a", startMs: 900, endMs: 2900 }], history: { ...first.history, nextShot: 10 } });
    expect(ids.ids).toEqual(["sh-10", "sh-09"]);
  });

  it("the migration report lists only the edits that no video uses, with the nearest shot", () => {
    const p = plan();
    const songMs = (frame: number) => Math.round(((p.songStartFrame + frame) * 1000) / FPS);
    const timeline = {
      cuts: [
        { from: songMs(97) / 1000 - 0.5, to: songMs(97) / 1000 }, // used (a cut of this video)
        { from: 50, to: 50.4 }, // inside the video, at no cut
        { from: 150, to: 151 }, // outside it
      ],
      slips: [],
    };
    const sb = buildStoryboard(plan({ timeline }));
    expect(unusedSongEdits(timeline, [sb])).toEqual([
      "moved cut 0:50.0 -> 0:50.4: reels 1: not used (nearest: shot 3 at 0:48.8); kept in clips.json",
      "moved cut 2:30.0 -> 2:31.0: outside every planned video's part of the song (reels 1 0:41.2-1:11.2); kept in clips.json",
    ]);
    // Another video (e.g. YouTube, the whole song) that uses the cut at 2:31: no longer listed.
    const yt = { ...sb, id: "youtube-1", output: { ...sb.output, platform: "youtube", range: { ...sb.output.range, startMs: 0, endMs: 240000 } }, edits: { unmatched: [] } };
    expect(unusedSongEdits(timeline, [sb, yt])).toEqual([]);
  });

  it("sections: runs of hook lines are choruses, the rest verses", () => {
    const s = sectionsFromLines([
      { startMs: 0, endMs: 10 },
      { startMs: 10, endMs: 20, isHook: true },
      { startMs: 20, endMs: 30, isHook: true },
      { startMs: 30, endMs: 40 },
      { startMs: 40, endMs: 50, isHook: true },
    ], 60);
    expect(s.map((x) => `${x.id} ${x.startMs}-${x.endMs}`)).toEqual(["sec-verse-1 0-10", "sec-chorus-1 10-30", "sec-verse-2 30-40", "sec-chorus-2 40-60"]);
  });
});

// The golden test: the user's approved "Here with Me" Reel (its manifest, copied from the PC). The storyboard made
// from its plan must give back exactly the frames that video was rendered with.
const GOLDEN = path.join(__dirname, "golden", "here-with-me-reels.manifest.json");
describe.skipIf(!existsSync(GOLDEN))("golden: Here with Me, the approved Reel", () => {
  it("storyboard -> the same shot, lyric and card frames as the approved video", () => {
    const m = JSON.parse(readFileSync(GOLDEN, "utf8")) as {
      props: { durationInFrames: number; audio: { startFrame: number } | null; shots: PlanForStoryboard["shots"][number][]; lyrics: PlanForStoryboard["lyrics"][number][]; textCards?: { id: string; type: string; text: string; startFrame: number; endFrame: number; off?: boolean }[] };
      section: { mode: string; start_ms: number; end_ms: number; reason: string };
      lyric_timings?: { number: number; text: string }[];
    };
    const props = m.props;
    const cards = (props.textCards ?? []).filter((c) => !c.off);
    const p = plan({
      songStartFrame: props.audio?.startFrame ?? 0,
      durationInFrames: props.durationInFrames,
      section: { mode: m.section.mode, startMs: m.section.start_ms, endMs: m.section.end_ms, reason: m.section.reason, locked: false },
      shots: props.shots,
      shotInfo: props.shots.map((s) => ({ clip: String((s as { src?: string }).src ?? "clip"), inS: 0, outS: 0, dip: false, anchorLine: null, warnings: [] })),
      lyrics: props.lyrics,
      lineNumbers: props.lyrics.map((l) => m.lyric_timings?.find((t) => t.text === l.text)?.number ?? null),
      cards,
    });
    const t = storyboardTiming(buildStoryboard(p) as StoryboardFile);
    expect(t.durationInFrames).toBe(props.durationInFrames);
    expect(t.shots.map((s) => [s.start, s.duration])).toEqual(props.shots.map((s) => [s.start, s.duration]));
    expect(t.lyrics.map(({ id: _id, ...rest }) => rest)).toEqual(
      props.lyrics.map((l) => ({
        startFrame: l.startFrame,
        endFrame: l.endFrame,
        ...(l.stampFrame !== undefined ? { stampFrame: l.stampFrame } : {}),
        ...(l.sungEndFrame !== undefined ? { sungEndFrame: l.sungEndFrame } : {}),
        ...(l.enterFrame !== undefined ? { enterFrame: l.enterFrame } : {}),
      })),
    );
    expect(t.cards).toEqual(cards.map((c) => ({ id: c.id, startFrame: c.startFrame, endFrame: Math.min(c.endFrame, props.durationInFrames) })));
  });
});
