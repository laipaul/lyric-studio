// The Collections page: shared collections with their counts and the songs that use them; a new one;
// clips added by copy (content already there is not copied), removed into _removed\ and restored.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionDetail, collectionFolder, importCollectionClips, listCollections, newCollection, removeCollectionClip, restoreCollectionClip } from "../src/node/collections";
import { findOrCreateSongProject, songPathsById, writeRecipe } from "../src/node";
import { makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-collections-"));
const wsDir = path.join(root, "workspace");
const inDir = path.join(root, "in");
let ws: Workspace;

beforeAll(async () => {
  mkdirSync(inDir, { recursive: true });
  ws = openWorkspace(wsDir);
  const wedding = path.join(wsDir, "collections", "wedding");
  mkdirSync(wedding, { recursive: true });
  makeClip(path.join(wedding, "01_vows.mp4"), 3, "blue");
  makeClip(path.join(wedding, "02_rings.mp4"), 2, "red", "384x216");
  makeClip(path.join(inDir, "03_dance.mp4"), 2, "green");
  makeSong(path.join(inDir, "Song.wav"), 4);
  const sp = await findOrCreateSongProject(ws, path.join(inDir, "Song.wav"));
  writeRecipe(songPathsById(ws, sp.project.id).recipe!, { collections: ["wedding"] });
}, 120_000);
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("collections", () => {
  it("lists each collection with its clips, what each format can use and the songs that use it", async () => {
    const [w] = await listCollections(ws);
    expect(w).toMatchObject({ name: "wedding", folder: "collections/wedding", clips: 2, photos: 0, usable: { vertical: 1, horizontal: 1 } });
    expect(w.durationMs).toBeGreaterThan(4500);
    expect(w.songs.map((s) => s.title)).toEqual(["Song"]);
    expect(w.thumbs.length).toBe(2);
  });

  it("a new collection is an empty folder; names are checked", async () => {
    expect(newCollection(ws, "City nights")).toBe("City nights");
    expect(existsSync(path.join(wsDir, "collections", "City nights"))).toBe(true);
    expect(() => newCollection(ws, "city nights")).toThrow(/already exists/);
    expect(() => newCollection(ws, "  ")).toThrow(/Give the collection a name/);
    expect((await collectionDetail(ws, "City nights")).list).toEqual([]);
    expect(() => collectionFolder(ws, "../songs")).toThrow(/Not a collection name/);
  });

  it("adds clips by copy, never twice the same content; remove moves to _removed, restore brings it back", async () => {
    const r = await importCollectionClips(ws, "wedding", [
      { file: path.join(inDir, "03_dance.mp4"), name: "03_dance.mp4" },
      { file: path.join(wsDir, "collections", "wedding", "01_vows.mp4"), name: "vows copy.mp4" },
    ]);
    expect(r.added).toEqual(["03_dance.mp4"]);
    expect(r.duplicates).toEqual([{ name: "vows copy.mp4", sameAs: "01_vows.mp4" }]);
    writeFileSync(path.join(inDir, "notes.txt"), "x");
    expect((await importCollectionClips(ws, "wedding", [{ file: path.join(inDir, "notes.txt"), name: "notes.txt" }])).skipped[0].name).toBe("notes.txt");

    expect(await removeCollectionClip(ws, "wedding", "02_rings.mp4")).toBe("collections/wedding/_removed/02_rings.mp4");
    let d = await collectionDetail(ws, "wedding");
    expect(d.list.map((c) => c.name)).toEqual(["01_vows.mp4", "03_dance.mp4"]);
    expect(d.removed).toEqual(["02_rings.mp4"]);
    await expect(removeCollectionClip(ws, "wedding", "../01_vows.mp4")).rejects.toThrow(/No clip/);

    expect(restoreCollectionClip(ws, "wedding", "02_rings.mp4")).toBe("collections/wedding/02_rings.mp4");
    d = await collectionDetail(ws, "wedding");
    expect(d.list.map((c) => c.name)).toEqual(["01_vows.mp4", "02_rings.mp4", "03_dance.mp4"]);
    expect(d.removed).toEqual([]);
    expect(readdirSync(path.join(wsDir, "collections", "wedding", "_removed"))).toEqual([]);
  });
});
