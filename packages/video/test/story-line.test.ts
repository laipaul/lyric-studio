// Prepare → Storyboard (11 Nov 2026): shared-collection clips in the story line. Clips picked one by one sit in the
// line like the song's own (Shape and Make follow that order and use only them); a "the app picks" card brings the
// whole collection at its place; removing takes a clip out of the song only. A song from before (a ticked
// collection) becomes one card at the end of its line, and its planned video stays exactly the same.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addFromCollection,
  cardKey,
  expandCards,
  findOrCreateSongProject,
  makeVideos,
  readClipEdits,
  readRecipe,
  removeFromStory,
  setStoryOrder,
  songAssets,
  songPathsById,
  songStory,
  storyboardPlan,
  storyPick,
  writeClipEdits,
  writeRecipe,
  type RenderOptions,
} from "../src/node";
import { renameCollection } from "../src/node/collections";
import { LYRICS, fakeAlign, ffmpeg, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-story-line-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "Story Line.wav");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id: string;
let songRoot: string;
let recipe: string;
const flowers = path.join(wsDir, "collections", "Flowers");

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  makeSong(song, 20);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  recipe = paths.recipe!;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  mkdirSync(flowers, { recursive: true });
  // A song from before the picker: its own clips a, b, c; the collection Flowers ticked; Shape had placed f2 after a.
  writeRecipe(recipe, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 }, shotLength: "rate", collections: ["Flowers"] });
  for (const [i, n] of ["a.mp4", "b.mp4", "c.mp4"].entries()) makeClip(path.join(paths.clips!, n), 6, ["blue", "yellow", "red"][i]);
  for (const [i, n] of ["f1.mp4", "f2.mp4", "f3.mp4"].entries()) makeClip(path.join(flowers, n), 6, ["green", "white", "magenta"][i]);
  writeClipEdits(songRoot, { order: ["a.mp4", "f2.mp4", "b.mp4", "c.mp4"], clips: {} });
  const sample = path.join(root, "s.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
  await makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32" });
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

const plan = async () => {
  const p = await storyboardPlan(ws, id, "reels", "v1");
  return { clips: p.clips.map((c) => c.name), shots: p.shots.map((s) => s.clip) };
};
const story = async () => (await songStory(ws, id, (await songAssets(ws, id)).clips)).items.map((i) => (i.card ? `[${i.card.collection} · app picks · ${i.card.clips}]` : `${i.key}${i.clip?.collection ? ` (${i.clip.collection})` : ""}`));

describe("shared-collection clips in the story line", () => {
  it("the cards and picks: a card brings the whole collection at its place, picks only themselves", () => {
    const edits = { order: ["a.mp4", cardKey("Flowers"), "b.mp4", "f2.mp4"], clips: {}, picked: { Flowers: ["f2.mp4"] } };
    expect(storyPick(edits, "Flowers")).toBeNull(); // a card: all of it
    expect(storyPick({ ...edits, order: ["a.mp4", "f2.mp4"] }, "Flowers")).toEqual(["f2.mp4"]);
    expect(storyPick({ order: [], clips: {} }, "Flowers")).toBeNull(); // a song from before: all of it, as before
    expect(expandCards(edits, { Flowers: ["f3.mp4", "f1.mp4", "f2.mp4"] }).order).toEqual(["a.mp4", "f1.mp4", "f3.mp4", "b.mp4", "f2.mp4"]);
  });

  it("a song from before: one card at the end of the line, the clip Shape placed keeps its place, the video is the same", async () => {
    const before = await plan();
    expect(before.clips).toEqual(["a.mp4", "f2.mp4", "b.mp4", "c.mp4", "f1.mp4", "f3.mp4"]);
    expect(await story()).toEqual(["a.mp4", "f2.mp4 (Flowers)", "b.mp4", "c.mp4", "[Flowers · app picks · 2]"]);
    const edits = readClipEdits(songRoot);
    expect(edits.order).toEqual(["a.mp4", "f2.mp4", "b.mp4", "c.mp4", cardKey("Flowers")]);
    expect(edits.picked).toEqual({ Flowers: ["f2.mp4"] });
    expect(await plan()).toEqual(before); // the same clips in the same order on the same shots
  }, 120_000);

  it("removing the card leaves only the picked clip; picking more adds them at the end; the line can be reordered", async () => {
    await removeFromStory(ws, id, cardKey("Flowers"));
    expect(readRecipe(recipe).collections).toEqual(["Flowers"]); // f2 still comes from it
    expect((await plan()).clips).toEqual(["a.mp4", "f2.mp4", "b.mp4", "c.mp4"]);
    expect(await addFromCollection(ws, id, "Flowers", ["f3.mp4", "f2.mp4"], false)).toEqual(["f3.mp4"]); // f2 is there already
    expect(await story()).toEqual(["a.mp4", "f2.mp4 (Flowers)", "b.mp4", "c.mp4", "f3.mp4 (Flowers)"]);
    await setStoryOrder(ws, id, ["f3.mp4", "a.mp4", "f2.mp4", "b.mp4", "c.mp4"]);
    expect((await plan()).clips).toEqual(["f3.mp4", "a.mp4", "f2.mp4", "b.mp4", "c.mp4"]);
    await expect(setStoryOrder(ws, id, ["f1.mp4"])).rejects.toThrow(/Not in this song's story line: f1\.mp4/);
    await expect(addFromCollection(ws, id, "Flowers", ["nope.mp4"], false)).rejects.toThrow(/not in the collection Flowers/);
  }, 120_000);

  it("a card placed in the middle plays the collection's other clips there", async () => {
    await addFromCollection(ws, id, "Flowers", [], true);
    await setStoryOrder(ws, id, ["f3.mp4", "a.mp4", cardKey("Flowers"), "f2.mp4", "b.mp4", "c.mp4"]);
    expect(await story()).toEqual(["f3.mp4 (Flowers)", "a.mp4", "[Flowers · app picks · 1]", "f2.mp4 (Flowers)", "b.mp4", "c.mp4"]);
    expect((await plan()).clips).toEqual(["f3.mp4", "a.mp4", "f1.mp4", "f2.mp4", "b.mp4", "c.mp4"]);
  }, 120_000);

  it("removing every Flowers item takes the collection off the song; the collection keeps its clips", async () => {
    for (const k of [cardKey("Flowers"), "f2.mp4", "f3.mp4"]) await removeFromStory(ws, id, k);
    expect(readRecipe(recipe).collections).toEqual([]);
    expect((await plan()).clips).toEqual(["a.mp4", "b.mp4", "c.mp4"]);
    expect(readdirSync(flowers).filter((f) => f.endsWith(".mp4")).sort()).toEqual(["f1.mp4", "f2.mp4", "f3.mp4"]);
    await expect(removeFromStory(ws, id, "a.mp4")).rejects.toThrow(/not a collection clip/); // own clips: Remove → clips\_removed\
  }, 120_000);

  it("renaming the collection follows into the story line", async () => {
    await addFromCollection(ws, id, "Flowers", ["f1.mp4"], true);
    const to = renameCollection(ws, "Flowers", "Spring");
    const edits = readClipEdits(songRoot);
    expect(edits.picked).toEqual({ [to]: ["f1.mp4"] });
    expect(edits.order).toContain(cardKey(to));
    expect(readRecipe(recipe).collections).toEqual([to]);
    expect(existsSync(path.join(wsDir, "collections", to, "f1.mp4"))).toBe(true);
  }, 120_000);
});
