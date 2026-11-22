// Song style (22 Nov 2026, Paul's three levels): song.json "songStyle"; the default from what the song has; which
// tools show; a wrong value never blocks the song.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { effectiveSongStyle, showsFilm, showsSinging } from "../src/song-style";
import { checkRecipe, findOrCreateSongProject, readRecipe, songPathsById } from "../src/node";
import { setSongStyle, songStyle } from "../src/node/song-style";
import { makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-songstyle-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id = "";

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const file = path.join(root, "Wedding Day.wav");
  makeSong(file, 4);
  id = (await findOrCreateSongProject(ws, file)).project.id;
});
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("song style", () => {
  it("defaults from what the song has, and decides which tools show", () => {
    expect(effectiveSongStyle(undefined, 0)).toBe("cut");
    expect(effectiveSongStyle(undefined, 2)).toBe("singing");
    expect(effectiveSongStyle("film", 0)).toBe("film");
    expect(showsSinging("cut", 0)).toBe(false);
    expect(showsSinging("cut", 1)).toBe(true); // singing lines in use are never hidden
    expect(showsSinging("singing", 0)).toBe(true);
    expect(showsSinging("film", 0)).toBe(true);
    expect(showsFilm("singing")).toBe(false);
    expect(showsFilm("film")).toBe(true);
  });

  it("is saved in song.json, keeps the rest, and a wrong value is left out", () => {
    expect(songStyle(ws, id)).toEqual({ style: "cut", chosen: false, singingLines: 0 });
    const file = songPathsById(ws, id).recipe!;
    const before = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
    writeFileSync(file, JSON.stringify({ ...before, theme: "Paper", anchors: [{ line: 3, clip: "sing.mp4", sync: 12.5 }] }));
    expect(songStyle(ws, id)).toEqual({ style: "singing", chosen: false, singingLines: 1 });
    expect(setSongStyle(ws, id, "film")).toEqual({ style: "film", chosen: true, singingLines: 1 });
    const saved = readRecipe(file);
    expect(saved).toMatchObject({ songStyle: "film", theme: "Paper" });
    expect(saved.anchors).toHaveLength(1);
    expect(() => setSongStyle(ws, id, "reel")).toThrow(/cut", "singing" or "film/);
    expect(checkRecipe({ songStyle: "reel" })).toEqual({ recipe: {}, problems: [] });
  });
});
