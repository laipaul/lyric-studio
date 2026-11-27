// Step B (23 Nov 2026): a Mini film plays shot by shot: every card of the story line is one shot, on its lyric line,
// each take once, a stand-in where a planned shot has no take yet; the whole song.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, makeVideos, readRecipe, songPathsById, storyboardPlan, writeRecipe, type RenderOptions } from "../src/node";
import { filmCuts, filmItems } from "../src/node/film-plan";
import type { Slot } from "../src/node/shotlist";
import { grid } from "./helpers";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const slot = (id: string, order: number, line: number | null): Slot => ({ id, order, shows: `Shot ${id}`, characters: [], scene: null, shot: "wide", line });

describe("the film's shots (pure)", () => {
  const list = { imported_at: "", source: "", slots: [slot("s01", 1, null), slot("s02", 2, 1), slot("s03", 3, null), slot("s04", 4, 3), slot("s05", 5, 4)], filled: { s02: "a.mp4", s04: "c.mp4" } };

  it("the story line as shots: a planned shot is one card (its take, else a stand-in), other clips their own, each once", () => {
    const items = filmItems(["slot:s01", "a.mp4", "slot:s03", "c.mp4", "slot:s05", "A.MP4"], ["a.mp4", "b.mp4", "c.mp4"], list, [{ line: 2, clip: "b.mp4" }]);
    expect(items.map((x) => [x.key, x.clip, x.line])).toEqual([
      ["slot:s01", null, null],
      ["slot:s02", "a.mp4", 1],
      ["slot:s03", null, null],
      ["slot:s04", "c.mp4", 3],
      ["slot:s05", null, 4],
      ["b.mp4", "b.mp4", 2], // never placed in the order: at the end, its anchor's line
    ]);
  });

  it("a singing clip on its lines is no story card (it plays over the film, in time)", () => {
    const items = filmItems(["slot:s01", "sings.mp4", "b.mp4"], ["sings.mp4", "b.mp4"], list, [{ line: 2, clip: "sings.mp4", sync: 12.5 }]);
    expect(items.map((x) => x.key)).toEqual(["slot:s01", "b.mp4"]);
    expect(items.some((x) => x.clip === "sings.mp4")).toBe(false);
  });

  it("the two films: each shot's vertical take in the Film 9:16, its landscape take in the Film 16:9, else a stand-in", () => {
    const both = { ...list, filledWide: { s02: "a-wide.mp4", s03: "s03-wide.mp4" } };
    const order = ["slot:s01", "a.mp4", "slot:s03", "c.mp4", "slot:s05"];
    const tall = filmItems(order, ["a.mp4", "c.mp4"], both, []);
    const wide = filmItems(order, ["a-wide.mp4", "s03-wide.mp4"], both, []);
    expect(tall.map((x) => x.clip)).toEqual([null, "a.mp4", null, "c.mp4", null]);
    expect(wide.map((x) => x.clip)).toEqual([null, "a-wide.mp4", "s03-wide.mp4", null, null]);
    expect(wide.map((x) => x.key)).toEqual(tall.map((x) => x.key)); // the same cards, the same timing
  });

  it("cuts on the beat at or just before each line; shots without a line share the time before the next", () => {
    const beats = grid(120, 40, 0); // a beat every 0.5 s
    const lines = [1, 2, 3, 4].map((n) => ({ number: n, text: `L${n}`, startMs: 2000 + (n - 1) * 4000 + 100, endMs: null }));
    const items = filmItems(["slot:s01", "a.mp4", "slot:s03", "c.mp4", "slot:s05"], ["a.mp4", "c.mp4"], list, []);
    const { cuts, kept, notes } = filmCuts(items, lines, beats, { startFrame: 0, endFrame: 600, fps: 30 });
    expect(kept.length).toBe(5);
    expect(notes).toEqual([]);
    // Line 1 at 2.1 s: the beat at 2.0 s (frame 60, 2 frames early); s03 shares a.mp4's time until line 3 (2.1-10.1 s): 6.1 s -> beat 6.0 s.
    expect(cuts.map((c) => c.frame)).toEqual([58, 178, 298, 418]);
  });

  it("a part of the song (the pink window): only the cards inside it, the one playing at its start opens it; nothing said about the others", () => {
    const beats = grid(120, 40, 0);
    const lines = [1, 2, 3, 4].map((n) => ({ number: n, text: `L${n}`, startMs: 2000 + (n - 1) * 4000 + 100, endMs: null }));
    const items = filmItems(["slot:s01", "a.mp4", "slot:s03", "c.mp4", "slot:s05"], ["a.mp4", "c.mp4"], list, []);
    // The part 7.0-13.0 s (frames 210-390): s03 (6.1-10.1 s) is playing at its start, then c.mp4 on line 3 (10.1 s).
    const part = filmCuts(items, lines, beats, { startFrame: 210, endFrame: 390, fps: 30, songEndMs: 20_000 });
    expect(part.kept.map((x) => x.key)).toEqual(["slot:s03", "slot:s04"]);
    expect(part.cuts.map((c) => c.frame)).toEqual([298]);
    expect(part.notes).toEqual([]);
  });

  it("a shot with no room of its own is said, not silently dropped; a shot on a line wins over one without", () => {
    const beats = grid(120, 40, 0);
    const lines = [{ number: 1, text: "L1", startMs: 2000, endMs: null }, { number: 2, text: "L2", startMs: 2100, endMs: null }];
    const three = { imported_at: "", source: "", slots: [slot("s00", 0, null), slot("s01", 1, 1), slot("s02", 2, 2)] };
    const end = filmCuts(filmItems(["slot:s00", "slot:s01", "slot:s02", "slot:s01"], [], three, []), lines, beats, { startFrame: 0, endFrame: 90, fps: 30 });
    expect(end.kept.map((x) => x.key)).toEqual(["slot:s00", "slot:s01"]);
    expect(end.notes).toEqual(["shot 3 (s02) has no room of its own on the song (too close to the shot before it or to the end): it is left out of this video"]);
    // An intro of 0.3 s: the shot on line 1 opens the video instead.
    const early = filmCuts(filmItems(["slot:s00", "slot:s01"], [], three, []), [{ number: 1, text: "L1", startMs: 300, endMs: null }], beats, { startFrame: 0, endFrame: 300, fps: 30 });
    expect(early.kept.map((x) => x.key)).toEqual(["slot:s01"]);
    expect(early.notes[0]).toMatch(/shot 1 \(s00\) has no room of its own before line 1/);
  });
});

describe("a Mini film planned and made", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-film-"));
  const wsDir = path.join(root, "workspace");
  const sample = path.join(root, "s.mp4");
  const still = path.join(root, "s.jpg");
  const previous = process.env.WORKSPACE_DIR;
  let ws: Workspace;
  let id: string;
  const rendered: RenderOptions["props"][] = [];
  let result: Awaited<ReturnType<typeof makeVideos>>;

  beforeAll(async () => {
    process.env.WORKSPACE_DIR = wsDir;
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", still);
    ws = openWorkspace(wsDir);
    seedStylePresets(ws.db);
    const song = path.join(root, "Film Test.wav");
    makeSong(song, 14);
    id = (await findOrCreateSongProject(ws, song)).project.id;
    const paths = songPathsById(ws, id);
    writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
    mkdirSync(paths.clips!, { recursive: true });
    for (const [i, c] of ["blue", "yellow", "red", "green"].entries()) makeClip(path.join(paths.clips!, `0${i + 1}_${c}.mp4`), 6, c);
    writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), songStyle: "film", platforms: ["reels"], variations: { film: 2 } }); // "reels": a Mini film makes its films instead
    // The shot list: an intro shot, line 1 (blue), line 3 (yellow), line 5 (no take yet). Red and green are set to Omit.
    writeFileSync(path.join(paths.root, "shotlist.json"), JSON.stringify({ imported_at: "", source: "t", slots: [slot("s01", 1, null), slot("s02", 2, 1), slot("s03", 3, 3), slot("s04", 4, 5)], filled: { s02: "01_blue.mp4", s03: "02_yellow.mp4" } }));
    writeFileSync(path.join(paths.root, "clips.json"), JSON.stringify({ order: ["slot:s01", "01_blue.mp4", "02_yellow.mp4", "slot:s04"], clips: { "03_red.mp4": { omit: true }, "04_green.mp4": { omit: true } } }));
    result = await makeVideos({
      workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, platform: "win32",
      renderer: async (o: RenderOptions) => (o.outFile.includes(`${path.sep}film${path.sep}`) && rendered.push(o.props), copyFileSync(sample, o.outFile), o.outFile),
      thumbnailRenderer: async (o) => (copyFileSync(still, o.outFile), o.outFile),
    });
  }, 300_000);
  afterAll(() => {
    ws?.close();
    if (previous === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });

  it("a Mini film makes its two films, never Reels; the Film 16:9 without landscape takes is all stand-ins", () => {
    expect(result.platforms.map((p) => [p.name, p.error ?? null])).toEqual([["film", null], ["film-wide", null]]);
    const wide = result.platforms.find((p) => p.name === "film-wide")!;
    expect(wide.warnings.join(" ")).toMatch(/Mini film: 4 of 4 shots have no take yet/);
  });

  it("every video: the whole song, one shot per card in story order, each take once, stand-ins for the empty shots", () => {
    expect(rendered.length).toBe(2);
    for (const props of rendered) {
      // The intro stand-in (0-0.7 s), blue on line 1, yellow on line 3, the stand-in of shot 4 on line 5.
      expect(props.shots.length).toBe(4);
      const srcs = props.shots.map((s) => s.src);
      expect(srcs[0]).toMatch(/^cache\/standins\//);
      expect(srcs[3]).toMatch(/^cache\/standins\//);
      expect(new Set(srcs.slice(1, 3)).size).toBe(2);
      expect(srcs.slice(1, 3).every((x) => !x.includes("standins"))).toBe(true);
      // Each take on its line: line 1 appears at 0.75 s, line 3 at 3.75 s, line 5 at 6.75 s (lines every 1.5 s, 0.25 s lead).
      for (const [shot, appearS] of [[1, 0.75], [2, 3.75], [3, 6.75]] as const) {
        expect(props.shots[shot].start).toBeLessThanOrEqual(Math.round(appearS * 30) + 6);
        expect(props.shots[shot].start).toBeGreaterThanOrEqual(Math.round((appearS - 0.5) * 30) - 2);
      }
      expect(props.shots.at(-1)!.start + props.shots.at(-1)!.duration).toBe(props.durationInFrames);
    }
    // The variations keep the film's cuts.
    expect(rendered[1].shots.map((s) => s.start)).toEqual(rendered[0].shots.map((s) => s.start));
  });

  it("Shape plans the same film", async () => {
    const view = await storyboardPlan(ws, id, "reels", "v1");
    expect(view.props.shots.length).toBe(4);
    expect(view.props.shots[3].src).toMatch(/standins/);
    expect(view.shots.map((x) => x.clip)).toEqual(["Shot 1 · no take yet", "01_blue.mp4", "02_yellow.mp4", "Shot 4 · no take yet"]);
  });
});
