// The Collections page: the shared clip collections (workspace\collections\<name>\, older ones in
// workspace\clips\<name>\) with their clips, what each format can use and the songs that use them. Clips
// are added by copying (duplicates by content are not copied), removed into _removed\ (never deleted) and
// restored from there. No rendering code is imported here, so the studio's server can use it directly.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { absPath, collectionDir, project as projectTable, safeName, type Workspace } from "@lyric/db";

import { folderClips, importClipsInto, removeClipFrom, restoreClipTo, type ClipAsset, type ImportResult } from "./assets";
import { rememberedCollection } from "./project-settings";
import { readRecipe } from "./recipe";
import { COLLECTIONS_DIR, sharedCollections, songPathsById } from "./song-folder";

export type CollectionSummary = {
  name: string;
  folder: string; // workspace-relative
  folderPath: string; // on disk
  clips: number; // usable sources (duplicates not counted)
  photos: number;
  durationMs: number; // the videos together
  usable: { vertical: number; horizontal: number };
  thumbs: string[]; // up to 4 thumbnails (workspace-relative)
  songs: { id: string; title: string; artist: string }[]; // the songs that use it (song.json, else remembered)
};

export type CollectionDetail = CollectionSummary & { list: ClipAsset[]; removed: string[] };

// Where a collection lives (collections\<name>\, or the older clips\<name>\).
export function collectionFolder(ws: Workspace, name: string): string {
  if (!name || name !== path.basename(name) || name.startsWith(".")) throw new Error(`Not a collection name: ${name}`);
  return absPath(ws, collectionDir({ name }, ws.dir));
}

// The songs that use each collection: song.json "collections", else the one remembered (older songs).
function songsByCollection(ws: Workspace): Map<string, CollectionSummary["songs"]> {
  const out = new Map<string, CollectionSummary["songs"]>();
  for (const p of ws.db.select().from(projectTable).all()) {
    let names: string[] = [];
    try {
      const recipe = readRecipe(songPathsById(ws, p.id).recipe);
      names = recipe.collections ?? [];
    } catch {
      names = [];
    }
    if (!names.length) {
      const remembered = rememberedCollection(ws, p.id);
      if (remembered) names = [remembered.name];
    }
    for (const n of names) out.set(n, [...(out.get(n) ?? []), { id: p.id, title: p.title, artist: p.artist }]);
  }
  return out;
}

async function detail(ws: Workspace, name: string, songs: CollectionSummary["songs"]): Promise<CollectionDetail> {
  const folder = collectionFolder(ws, name);
  const listed = await folderClips(ws, folder, name);
  const unique = listed.clips.filter((c) => !c.duplicateOf);
  return {
    name,
    folder: path.relative(ws.dir, folder).split(path.sep).join("/"),
    folderPath: folder,
    clips: unique.length,
    photos: unique.filter((c) => c.kind === "photo").length,
    durationMs: unique.reduce((sum, c) => sum + c.durationMs, 0),
    usable: listed.usable,
    thumbs: unique.flatMap((c) => (c.thumb ? [c.thumb] : [])).slice(0, 4),
    songs,
    list: listed.clips,
    removed: listed.removed,
  };
}

export async function listCollections(ws: Workspace): Promise<CollectionSummary[]> {
  const songs = songsByCollection(ws);
  const out: CollectionSummary[] = [];
  for (const name of sharedCollections(ws)) {
    const { list: _list, removed: _removed, ...summary } = await detail(ws, name, songs.get(name) ?? []);
    out.push(summary);
  }
  return out;
}

export async function collectionDetail(ws: Workspace, name: string): Promise<CollectionDetail> {
  if (!sharedCollections(ws).includes(name)) throw new Error(`No collection "${name}".`);
  return detail(ws, name, songsByCollection(ws).get(name) ?? []);
}

// "New collection": an empty folder workspace\collections\<name>\ (a Windows-safe name).
export function newCollection(ws: Workspace, name: string): string {
  if (!name.trim()) throw new Error("Give the collection a name (letters, numbers, spaces).");
  const clean = safeName(name.trim());
  if (!clean || clean.startsWith(".") || clean === "_removed") throw new Error("Give the collection a name (letters, numbers, spaces).");
  if (sharedCollections(ws).some((n) => n.toLowerCase() === clean.toLowerCase())) throw new Error(`A collection "${clean}" already exists.`);
  mkdirSync(absPath(ws, `${COLLECTIONS_DIR}/${clean}`), { recursive: true });
  return clean;
}

export async function importCollectionClips(ws: Workspace, name: string, files: readonly { file: string; name: string }[]): Promise<ImportResult> {
  if (!sharedCollections(ws).includes(name)) throw new Error(`No collection "${name}".`);
  return importClipsInto(ws, collectionFolder(ws, name), name, files);
}

export async function removeCollectionClip(ws: Workspace, name: string, clip: string): Promise<string> {
  const folder = collectionFolder(ws, name);
  if (!existsSync(folder)) throw new Error(`No collection "${name}".`);
  return removeClipFrom(ws, folder, clip, `the collection "${name}"`);
}

export function restoreCollectionClip(ws: Workspace, name: string, clip: string): string {
  const folder = collectionFolder(ws, name);
  if (!existsSync(folder)) throw new Error(`No collection "${name}".`);
  return restoreClipTo(ws, folder, clip);
}
