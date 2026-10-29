// Reactions (Step C): a keyword on a video says what it would change for the next run, then changes one
// recipe setting (this song, or every song of the artist); the Videos data carries the assessment and the
// reactions; "love this one" marks the video; the pace adjustment and readability reach the next plan.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, makeVideos, readRecipe, songPathsById, songRuns, storyboardPlan, writeRecipe, type RenderOptions } from "../src/node";
import { applyReaction, planReaction } from "../src/node/reactions";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-reactions-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "React Test.wav");
const sample = path.join(root, "s.mp4");
const previousWorkspace = process.env.WORKSPACE_DIR;
const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
let ws: Workspace;
let id: string;
let video: string;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  makeSong(song, 20);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, name] of ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4"].entries()) makeClip(path.join(paths.clips!, name), 8, ["blue", "yellow", "red", "green"][i]);
  writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 } });
  await makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32" });
  video = songRuns(ws, id)[0].platforms[0].videos[0].id;
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("reactions", () => {
  it("the Videos data carries the pro assessment and the reactions a Reel offers", () => {
    const v = songRuns(ws, id)[0].platforms[0].videos[0];
    expect(["ready", "good", "not-ready"]).toContain(v.assessment.verdict);
    expect(v.assessment.handled.some((h) => h.startsWith("Pacing: "))).toBe(true);
    expect(v.reactions.map((r) => r.id)).toEqual(["too-fast", "too-slow", "fewer-dissolves", "more-dreamy", "abrupt-ending", "hard-to-read", "repetitive", "love"]);
  });

  it("'cuts too fast' says what it changes, then adds a bar to the automatic pacing (this song)", async () => {
    const plan = planReaction(ws, id, { video, reaction: "too-fast" });
    expect(plan.text).toMatch(/^Next run: shots one bar longer/);
    expect(plan.changes).toEqual([{ field: "paceShift", value: 1 }]);
    const before = await storyboardPlan(ws, id, "reels", "v1");
    applyReaction(ws, id, { video, reaction: "too-fast", scope: "song" });
    expect(readRecipe(songPathsById(ws, id).recipe!).paceShift).toBe(1);
    const after = await storyboardPlan(ws, id, "reels", "v1");
    expect(after.shots.length).toBeLessThanOrEqual(before.shots.length);
    expect(after.decisions.find((d) => d.startsWith("Pacing: "))).toContain("your adjustment: +1 bar");
    expect(readFileSync(path.join(songPathsById(ws, id).root, ".studio", "feedback.jsonl"), "utf8")).toContain('"reaction":"too-fast"');
  }, 300_000);

  it("'too many dissolves' -> crisp; asked again: nothing to change", () => {
    applyReaction(ws, id, { video, reaction: "fewer-dissolves", scope: "song" });
    expect(readRecipe(songPathsById(ws, id).recipe!).transitions).toBe("crisp");
    expect(planReaction(ws, id, { video, reaction: "fewer-dissolves" }).none).toMatch(/already crisp/);
  });

  it("'lyrics hard to read' -> a soft band behind the lyrics in the next plan", async () => {
    applyReaction(ws, id, { video, reaction: "hard-to-read", scope: "song" });
    expect(readRecipe(songPathsById(ws, id).recipe!).readability).toBe("strong");
    expect((await storyboardPlan(ws, id, "reels", "v1")).props.lyricBacking).toBe(true);
  }, 300_000);

  it("'ending too abrupt' for all the artist's songs: brand.json, loop platforms only", () => {
    const r = applyReaction(ws, id, { video, reaction: "abrupt-ending", scope: "artist" });
    expect(r.applied).toBe("all Life Lyrics songs (brand.json)");
    const brand = JSON.parse(readFileSync(path.join(wsDir, "brand", "brand.json"), "utf8")) as { perPlatform: Record<string, { ending?: string }> };
    expect(brand.perPlatform.reels.ending).toBe("ring-out");
    expect(brand.perPlatform.youtube?.ending).toBeUndefined();
  });

  it("'love this one' marks it favourite and approved", () => {
    applyReaction(ws, id, { video, reaction: "love", scope: "song" });
    expect(songRuns(ws, id)[0].platforms[0].videos[0].mark).toEqual({ favourite: true, status: "approved" });
  });

  it("'this clip doesn't fit here' moves the clip to the end of the story order", () => {
    applyReaction(ws, id, { video, reaction: "clip-misfit", clip: "01_a.mp4", scope: "song" });
    const edits = JSON.parse(readFileSync(path.join(songPathsById(ws, id).root, "clips.json"), "utf8")) as { order: string[] };
    expect(edits.order.at(-1)).toBe("01_a.mp4");
    expect(existsSync(song)).toBe(true);
  });
});
