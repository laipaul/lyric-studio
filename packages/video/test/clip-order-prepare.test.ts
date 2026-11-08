// The clip order after clips are added in Prepare (Assets) and reordered there: Shape plans exactly that order.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, importSongClips, makeVideos, readClipEdits, setSongClipOrder, songAssets, songPathsById, storyboardEdit, storyboardPlan, writeRecipe, type RenderOptions } from "../src/node";
import { LYRICS, fakeAlign, ffmpeg, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-clip-order-prepare-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "Order Test.wav");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id: string;
let songRoot: string;
const sample = path.join(root, "s.mp4");
const incoming = path.join(root, "incoming");
const COLOURS = ["blue", "yellow", "red", "green", "white", "magenta", "cyan", "orange"];

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  makeSong(song, 20);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  mkdirSync(incoming, { recursive: true });
  writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 }, shotLength: "rate" });
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  for (const [i, n] of ["old_a.mp4", "old_b.mp4", "old_c.mp4"].entries()) makeClip(path.join(paths.clips!, n), 6, COLOURS[i]);
  const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
  await makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32" });
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

let used = 0;
const upload = async (names: string[]) => {
  const files = names.map((n, i) => {
    const f = path.join(incoming, n);
    makeClip(f, 6, COLOURS[3 + used++]);
    return { file: f, name: n };
  });
  return importSongClips(ws, id, files);
};
const assetsOrder = async () => (await songAssets(ws, id)).clips.map((c) => c.name);
const shapeOrder = async () => (await storyboardPlan(ws, id, "reels", "v1")).clips.map((c) => c.name);

describe("the clip order across Prepare and Shape", () => {
  it("Shape and Prepare show the order set in Prepare, also after new clips are added and reordered", async () => {
    // The user orders the three clips (Shape lifts / reorders them too), then adds new ones.
    storyboardEdit(ws, id, { action: "order", order: ["old_c.mp4", "old_a.mp4", "old_b.mp4"] });
    await upload(["new_2.mp4", "New_1.MOV.mp4"]);
    let want = ["old_c.mp4", "old_a.mp4", "old_b.mp4", "New_1.MOV.mp4", "new_2.mp4"];
    expect(await assetsOrder()).toEqual(want);
    expect(await shapeOrder()).toEqual(want);
    // Then reorders in Prepare (drag and drop), new clips among the old ones.
    want = ["New_1.MOV.mp4", "old_b.mp4", "new_2.mp4", "old_c.mp4", "old_a.mp4"];
    setSongClipOrder(ws, id, want);
    expect(readClipEdits(songRoot).order).toEqual(want);
    expect(await assetsOrder()).toEqual(want);
    expect(await shapeOrder()).toEqual(want);
    const plan = await storyboardPlan(ws, id, "reels", "v1");
    expect(plan.shots.slice(0, 5).map((s) => s.clip)).toEqual(want);
    // Another upload goes after, and Shape's own re-save of what it shows keeps the order.
    await upload(["zz_new.mp4"]);
    want = [...want, "zz_new.mp4"];
    expect(await shapeOrder()).toEqual(want);
    storyboardEdit(ws, id, { action: "order", order: await shapeOrder() });
    expect(await assetsOrder()).toEqual(want);
  }, 300_000);

  it("a slip on a shot does not pin its clip there: reordering in Prepare is followed, the slip only applies where its clip still plays", async () => {
    const names = await assetsOrder();
    setSongClipOrder(ws, id, names);
    const before = await storyboardPlan(ws, id, "reels", "v1");
    const second = before.shots[1];
    // Slip shot 2 (drag inside it): saved on the song's timeline by song time and clip name.
    storyboardEdit(ws, id, { action: "slip", slip: { at: second.songMs / 1000, clip: second.clip, in: 1 } });
    expect((await storyboardPlan(ws, id, "reels", "v1")).shots[1]).toMatchObject({ clip: second.clip });
    // Prepare reorder: the story order decides, the clips are in the user's order from shot 1.
    const want = [...names].reverse();
    setSongClipOrder(ws, id, want);
    const after = await storyboardPlan(ws, id, "reels", "v1");
    expect(after.clips.map((c) => c.name)).toEqual(want);
    expect(after.shots.slice(0, want.length).map((x) => x.clip)).toEqual(want);
  }, 300_000);
});
