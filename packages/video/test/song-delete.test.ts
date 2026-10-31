// The song's title (editable on its page) and Delete song (31 Oct 2026): the folder follows a new title;
// Delete moves the whole song folder to songs\_removed\ (nothing deleted) and hides it from the Library,
// Themes and Collections; Restore brings it back with its videos and settings.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, listSongs, readRecipe, removedSongs, removeSong, renameSong, restoreSong, songPathsById, themesPageData } from "../src/node";
import { makeSong } from "./media-helpers";

describe("song title and Delete song", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-song-delete-"));
  const wsDir = path.join(root, "workspace");
  let ws: Workspace;
  let id = "";
  let other = "";
  beforeAll(async () => {
    ws = openWorkspace(wsDir);
    const lyrics = path.join(root, "lyrics.txt");
    writeFileSync(lyrics, "Hold on to me\n* Never let go\n");
    makeSong(path.join(root, "Hold On.wav"), 4);
    makeSong(path.join(root, "Let Go.wav"), 5);
    id = (await createSong(ws, { song: path.join(root, "Hold On.wav"), lyrics })).id;
    other = (await createSong(ws, { song: path.join(root, "Let Go.wav"), lyrics })).id;
    writeFileSync(path.join(songPathsById(ws, id).root, "clips", "note.txt"), "a file of mine");
  }, 120_000);
  afterAll(() => {
    ws?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("a new title renames the song folder; an empty title is refused", () => {
    expect(renameSong(ws, id, "  Hold   On Tight ")).toBe("Hold On Tight");
    expect(songPathsById(ws, id).rel).toBe("songs/Life Lyrics/Hold On Tight");
    expect(existsSync(path.join(songPathsById(ws, id).root, "clips", "note.txt"))).toBe(true);
    expect(() => renameSong(ws, id, "  ")).toThrow(/needs a title/);
  });

  it("Delete moves the folder to songs\\_removed\\ and hides the song; Restore brings it back", () => {
    const moved = removeSong(ws, id);
    expect(moved).toMatch(/^songs\/_removed\/Life Lyrics - Hold On Tight \(removed \d{4}-\d{2}-\d{2} \d{6}\)$/);
    expect(existsSync(path.join(wsDir, moved, "clips", "note.txt"))).toBe(true);
    expect(existsSync(path.join(wsDir, "songs", "Life Lyrics", "Hold On Tight"))).toBe(false);
    expect(listSongs(ws).map((s) => s.title)).toEqual(["Let Go"]);
    expect(themesPageData(ws).songs.map((s) => s.title)).toEqual(["Let Go"]);
    expect(removedSongs(ws).map((s) => s.title)).toEqual(["Hold On Tight"]);
    expect(() => renameSong(ws, id, "X")).toThrow(/restore it first/);
    expect(restoreSong(ws, id)).toBe("songs/Life Lyrics/Hold On Tight");
    expect(listSongs(ws).map((s) => s.title).sort()).toEqual(["Hold On Tight", "Let Go"]);
    expect(readRecipe(songPathsById(ws, id).recipe).theme).toBeTruthy();
    expect(ws.db.select().from(project).where(eq(project.id, id)).get()!.audio_path).toMatch(/^songs\/Life Lyrics\/Hold On Tight\//);
    expect(removedSongs(ws)).toEqual([]);
    expect(other).toBeTruthy();
  });
});
