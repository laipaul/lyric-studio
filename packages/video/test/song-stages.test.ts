// The four-stage song page: the Prepare to-do list (only what needs the user) and the song's platforms.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, readRecipe, songPathsById, writeRecipe } from "../src/node";
import { songPlatforms, songTodo } from "../src/node/song-stages";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-stages-"));
const inDir = path.join(root, "in");
let ws: Workspace;
let id: string;

beforeAll(async () => {
  mkdirSync(inDir, { recursive: true });
  ws = openWorkspace(path.join(root, "workspace"));
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", path.join(inDir, "Hold On.wav")]);
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x7a2e4d:s=64x64", "-frames:v", "1", path.join(inDir, "cover.jpg")]);
  writeFileSync(path.join(inDir, "lyrics.txt"), "Chorus:\nHold on to me\nNever let go\n");
  id = (await createSong(ws, { song: path.join(inDir, "Hold On.wav"), lyrics: path.join(inDir, "lyrics.txt") })).id;
}, 60_000);
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("Prepare to-do list", () => {
  it("names what is missing, in plain words, with where to fix it", async () => {
    const todo = await songTodo(ws, id);
    expect(todo.map((t) => t.id)).toEqual(["clips", "vocals", "cover", "labels"]);
    expect(todo.find((t) => t.id === "clips")).toMatchObject({ tab: "clips", blocking: true }); // N1: Prepare → Clips
    // L1a: the vocal stem is suggested, never a blocker.
    expect(todo.find((t) => t.id === "vocals")).toMatchObject({ text: "Add the vocal stem for better lyric timing.", tab: "assets", blocking: false });
    expect(todo.find((t) => t.id === "cover")).toMatchObject({ tab: "assets", blocking: false });
    expect(todo.find((t) => t.id === "labels")?.text).toMatch(/1 line in the lyrics looks like a label \(e\.g\. “Chorus:”\)/);
  });

  it("a collection counts as clips; a cover clears its item; fixing the lyrics clears the label; a vocal stem clears its suggestion", async () => {
    const recipe = songPathsById(ws, id).recipe!;
    writeRecipe(recipe, { ...readRecipe(recipe), collections: ["wedding"] });
    const { storeCover } = await import("../src/node/project-settings");
    storeCover(ws, id, path.join(inDir, "cover.jpg"));
    writeFileSync(songPathsById(ws, id).lyricsTxt, "Hold on to me\nNever let go\n");
    expect((await songTodo(ws, id)).map((t) => t.id)).toEqual(["vocals"]);
    copyFileSync(songPathsById(ws, id).audio!, songPathsById(ws, id).vocals!); // any vocals.wav (not checked in the tests)
    expect(await songTodo(ws, id)).toEqual([]);
  });

  it("no lyrics.txt blocks making videos", async () => {
    rmSync(songPathsById(ws, id).lyricsTxt);
    expect((await songTodo(ws, id))[0]).toMatchObject({ id: "lyrics", blocking: true, tab: "assets" });
  });
});

describe("the song's platforms", () => {
  it("song.json platforms, else null (all of them)", () => {
    expect(songPlatforms(ws, id)).toBe(null);
    const recipe = songPathsById(ws, id).recipe!;
    writeRecipe(recipe, { ...readRecipe(recipe), platforms: ["reels", "youtube"] });
    expect(songPlatforms(ws, id)).toEqual(["reels", "youtube"]);
  });
});
