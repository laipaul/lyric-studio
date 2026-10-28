// Storyboard stage 2: the story order (clips.json) persists and re-plans, a clip's edits (in / out,
// speed, best moment) re-plan, dragging a clip onto a lyric line makes an anchor, and Generate renders
// exactly the plan the storyboard shows (after every edit).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, makeVideos, readClipEdits, readManifest, readRecipe, songPathsById, storyboardEdit, storyboardPlan, writeRecipe, type RenderOptions } from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-storyboard-edit-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "Edit Test.wav");
const sample = path.join(root, "s.mp4");
const previousWorkspace = process.env.WORKSPACE_DIR;
const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
const CLIPS = ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4"];
let ws: Workspace;
let id: string;
let songRoot: string;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  makeSong(song, 20);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, name] of CLIPS.entries()) makeClip(path.join(paths.clips!, name), 8, ["blue", "yellow", "red", "green"][i]);
  writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 } });
  // Aligned once (a storyboard never aligns).
  await makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32" });
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

// What Generate makes now: v1's manifest props (rendered with the stand-in renderer).
async function rendered() {
  const r = await makeVideos({ workspaceDir: wsDir, song: songPathsById(ws, id).audio!, lyrics: songPathsById(ws, id).lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32" });
  return readManifest(r.platforms[0].variations[0].manifestFile).props;
}

describe("storyboard stage 2", () => {
  it("the story order: file names first; a new order persists in clips.json and re-plans", async () => {
    const before = await storyboardPlan(ws, id, "reels", "v1");
    expect(before.editable).toBe(true);
    expect(before.clips.map((c) => c.name)).toEqual(CLIPS);
    expect(before.shots.slice(0, 4).map((s) => s.clip)).toEqual(CLIPS);
    const order = [...CLIPS].reverse();
    storyboardEdit(ws, id, { action: "order", order });
    expect(readClipEdits(songRoot).order).toEqual(order);
    expect(JSON.parse(readFileSync(path.join(songRoot, "clips.json"), "utf8")).order).toEqual(order); // the file itself
    const after = await storyboardPlan(ws, id, "reels", "v1");
    expect(after.clips.map((c) => [c.name, c.ranked])).toEqual(order.map((n) => [n, true]));
    expect(after.shots.slice(0, 4).map((s) => s.clip)).toEqual(order);
    expect((await rendered()).shots).toEqual(after.props.shots); // Generate renders exactly this
  }, 300_000);

  it("the clip editor: best moment (wins over the automatic one), speed, in / out; every edit re-plans", async () => {
    storyboardEdit(ws, id, { action: "clip", clip: "04_d.mp4", edit: { best: 3, speed: 0.8 } });
    storyboardEdit(ws, id, { action: "clip", clip: "03_c.mp4", edit: { in: 1, out: 3.5 } });
    const plan = await storyboardPlan(ws, id, "reels", "v1");
    const d = plan.clips.find((c) => c.name === "04_d.mp4")!;
    expect(d).toMatchObject({ bestS: 3, bestFrom: "clip editor", speed: 0.8 });
    const first = plan.shots[0];
    expect(first).toMatchObject({ clip: "04_d.mp4", speed: 0.8, best: true });
    expect(Math.abs((first.inS + first.outS) / 2 - 4)).toBeLessThan(0.1); // centred on the best 2 s (3-5 s)
    for (const s of plan.shots.filter((x) => x.clip === "03_c.mp4")) {
      expect(s.inS).toBeGreaterThanOrEqual(1);
      expect(s.outS).toBeLessThanOrEqual(3.51);
    }
    expect(readClipEdits(songRoot).clips).toEqual({ "04_d.mp4": { best: 3, speed: 0.8 }, "03_c.mp4": { in: 1, out: 3.5 } });
    expect((await rendered()).shots).toEqual(plan.props.shots);
    // Back to the whole clip and the automatic best moment.
    storyboardEdit(ws, id, { action: "clip", clip: "03_c.mp4", edit: null });
    expect(readClipEdits(songRoot).clips).toEqual({ "04_d.mp4": { best: 3, speed: 0.8 } });
    expect(() => storyboardEdit(ws, id, { action: "clip", clip: "03_c.mp4", edit: { in: 3, out: 2 } })).toThrow(/out must be after in/);
  }, 300_000);

  it("drag a clip onto a lyric line: an anchor in song.json; the plan puts that clip on the line", async () => {
    storyboardEdit(ws, id, { action: "anchor", line: 4, clip: "01_a.mp4" });
    expect(readRecipe(songPathsById(ws, id).recipe!).anchors).toEqual([{ line: 4, clip: "01_a.mp4" }]);
    const plan = await storyboardPlan(ws, id, "reels", "v1");
    expect(plan.lines.find((l) => l.number === 4)?.anchor).toBe("01_a.mp4");
    const anchored = plan.shots.filter((s) => s.anchor);
    expect(anchored.map((s) => [s.clip, s.anchor?.line])).toEqual([["01_a.mp4", 4]]);
    expect((await rendered()).shots).toEqual(plan.props.shots);
    // Another clip onto the same line replaces it; unanchor removes it.
    storyboardEdit(ws, id, { action: "anchor", line: 4, clip: "02_b.mp4", transition: "dissolve" });
    expect(readRecipe(songPathsById(ws, id).recipe!).anchors).toEqual([{ line: 4, clip: "02_b.mp4", transition: "dissolve" }]);
    storyboardEdit(ws, id, { action: "unanchor", line: 4 });
    expect(readRecipe(songPathsById(ws, id).recipe!).anchors).toBeUndefined();
    expect(existsSync(song)).toBe(true);
  }, 300_000);
});
