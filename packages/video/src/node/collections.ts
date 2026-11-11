// The Collections page: the shared clip collections (workspace\collections\<name>\, older ones in
// workspace\clips\<name>\) with their clips, what each format can use and the songs that use them. Clips
// are added by copying (duplicates by content are not copied), removed into _removed\ (never deleted) and
// restored from there. No rendering code is imported here, so the studio's server can use it directly.
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";

import { absPath, collection as collectionTable, collectionDir, makeRun, project as projectTable, safeName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { cardKey, CLIP_EDITS_FILE, readClipEdits, writeClipEdits } from "./clip-edits";
import { folderClips, importClipsInto, removeClipFrom, restoreClipTo, type ClipAsset, type ImportResult } from "./assets";
import { rememberCollection, rememberedCollection, updateProjectSettings } from "./project-settings";
import { readRecipe, writeRecipe } from "./recipe";
import { COLLECTIONS_DIR, isRemovedSong, moveEntry, relocatePaths, REMOVED_COLLECTIONS_DIR, sharedCollections, songBusy, songPathsById } from "./song-folder";

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
  sameAs: string | null; // another collection holding exactly the same clips (by content)
};

export type CollectionDetail = CollectionSummary & { list: ClipAsset[]; removed: string[] };
export type RemovedCollection = { folder: string; name: string; removedAt: string }; // folder: its name in collections\_removed\

// Where a collection lives (collections\<name>\, or the older clips\<name>\).
export function collectionFolder(ws: Workspace, name: string): string {
  if (!name || name !== path.basename(name) || name.startsWith(".")) throw new Error(`Not a collection name: ${name}`);
  return absPath(ws, collectionDir({ name }, ws.dir));
}

// The songs that use each collection: song.json "collections", else the one remembered (older songs).
function songsByCollection(ws: Workspace): Map<string, CollectionSummary["songs"]> {
  const out = new Map<string, CollectionSummary["songs"]>();
  for (const p of ws.db.select().from(projectTable).all()) {
    if (isRemovedSong(p.folder)) continue; // a deleted song (songs\_removed\)
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

async function detail(ws: Workspace, name: string, songs: CollectionSummary["songs"]): Promise<CollectionDetail & { hashes: string[] }> {
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
    sameAs: null,
    list: listed.clips,
    removed: listed.removed,
    hashes: listed.hashes,
  };
}

export async function listCollections(ws: Workspace): Promise<CollectionSummary[]> {
  const songs = songsByCollection(ws);
  const all: (CollectionSummary & { key: string })[] = [];
  for (const name of sharedCollections(ws)) {
    const { list: _list, removed: _removed, hashes, ...summary } = await detail(ws, name, songs.get(name) ?? []);
    all.push({ ...summary, key: hashes.join(",") });
  }
  // Collections holding the same clips: the one songs use most (else the first by name) is the
  // original; the others are flagged "same clips as <original>".
  const original = new Map<string, string>();
  for (const c of [...all].sort((a, b) => b.songs.length - a.songs.length)) if (c.key && !original.has(c.key)) original.set(c.key, c.name);
  return all.map(({ key, ...c }) => ({ ...c, sameAs: key && original.get(key) !== c.name ? original.get(key)! : null }));
}

export async function collectionDetail(ws: Workspace, name: string): Promise<CollectionDetail> {
  if (!sharedCollections(ws).includes(name)) throw new Error(`No collection "${name}".`);
  const { hashes: _hashes, ...d } = await detail(ws, name, songsByCollection(ws).get(name) ?? []);
  return d;
}

// ---- rename, remove, restore -----------------------------------------------------------------------
// A collection is its folder, and songs name it in song.json "collections" (older songs: the one
// remembered in .studio\settings.json). Renaming or removing moves the folder, every path the database
// stores follows (relocatePaths, recorded in moved-paths.json so old manifests still re-render), and the
// songs' references follow the new name. Never while a song using it is rendering.

const cleanName = (name: string): string => {
  const clean = safeName(name.trim());
  if (!name.trim() || !clean || clean.startsWith(".") || clean === REMOVED_COLLECTIONS_DIR) throw new Error("Give the collection a name (letters, numbers, spaces).");
  return clean;
};

function mustExist(ws: Workspace, name: string): void {
  if (!sharedCollections(ws).includes(name)) throw new Error(`No collection "${name}".`);
}

function refuseWhileRendering(ws: Workspace, name: string, songs: CollectionSummary["songs"], doing: string): void {
  const busy = songs.find((s) => songBusy(ws, s.id));
  if (busy) throw new Error(`"${busy.title}" is being rendered with "${name}" right now; ${doing} it when the run has finished.`);
}

// Every song naming `from`: song.json "collections" and the remembered collection get `to` (null: removed).
// A rename follows even into a locked song.json: the song keeps the same clips, only the name changed.
function renameInSongs(ws: Workspace, from: string, to: string | null, folderTo: string | null): void {
  for (const p of ws.db.select().from(projectTable).all()) {
    try {
      const file = songPathsById(ws, p.id).recipe;
      const recipe = readRecipe(file);
      if (file && recipe.collections?.includes(from)) {
        const next = [...new Set(recipe.collections.flatMap((c) => (c === from ? (to ? [to] : []) : [c])))];
        const { collections: _c, ...rest } = recipe;
        writeRecipe(file, next.length ? { ...rest, collections: next } : rest);
      }
    } catch {
      // a song.json that cannot be read is left alone (the Style tab reports it)
    }
    // The story line (clips.json): picked clips and the "app picks" card follow the new name (removed: they go).
    try {
      const paths = songPathsById(ws, p.id);
      if (!paths.legacy && existsSync(path.join(paths.root, CLIP_EDITS_FILE))) {
        const edits = readClipEdits(paths.root);
        if (edits.picked?.[from] || edits.order.includes(cardKey(from))) {
          const picked = { ...(edits.picked ?? {}) };
          const names = picked[from] ?? [];
          delete picked[from];
          if (to && names.length) picked[to] = names;
          const order = edits.order.flatMap((e) => (e === cardKey(from) ? (to ? [cardKey(to)] : []) : !to && names.includes(e) ? [] : [e]));
          const { picked: _p, ...rest } = edits;
          writeClipEdits(paths.root, { ...rest, order, ...(Object.keys(picked).length ? { picked } : {}) });
        }
      }
    } catch {
      // a clips.json that cannot be read is left alone (Shape reports it)
    }
    const remembered = rememberedCollection(ws, p.id);
    if (remembered?.name === from) {
      if (to) rememberCollection(ws, p.id, { name: to, ...(folderTo ? { folder: folderTo } : {}) });
      else updateProjectSettings(ws, p.id, { collection: undefined });
    }
  }
  // Runs still waiting or able to Resume name their collections in "collection": "a,b".
  for (const r of ws.db.select().from(makeRun).all()) {
    const named = r.options_json.collection;
    if (typeof named !== "string" || !named.split(",").includes(from)) continue;
    const next = named.split(",").flatMap((c) => (c === from ? (to ? [to] : []) : [c])).join(",");
    const options = { ...r.options_json } as Record<string, unknown>;
    if (next) options.collection = next;
    else delete options.collection;
    ws.db.update(makeRun).set({ options_json: options as typeof r.options_json }).where(eq(makeRun.id, r.id)).run();
  }
}

// Moves a collection's folder (also a change of case only, which Windows treats as the same name).
function moveCollection(ws: Workspace, fromRel: string, toRel: string): void {
  const fromAbs = absPath(ws, fromRel);
  const toAbs = absPath(ws, toRel);
  if (fromAbs.toLowerCase() === toAbs.toLowerCase()) {
    const tmp = `${fromAbs}.renaming`;
    renameSync(fromAbs, tmp);
    renameSync(tmp, toAbs);
  } else moveEntry(fromAbs, toAbs);
  relocatePaths(ws, fromRel, toRel);
}

function renameRow(ws: Workspace, from: string, to: string): void {
  const row = ws.db.select().from(collectionTable).where(eq(collectionTable.name, from)).get();
  if (!row) return;
  // A row left over under the new name (an older collection of that name) gives way.
  const taken = ws.db.select().from(collectionTable).where(eq(collectionTable.name, to)).get();
  if (taken && taken.id !== row.id) ws.db.update(collectionTable).set({ name: `${to} (old ${taken.id.slice(0, 8)})` }).where(eq(collectionTable.id, taken.id)).run();
  ws.db.update(collectionTable).set({ name: to }).where(eq(collectionTable.id, row.id)).run();
}

// "Rename": the folder gets the new name, the songs follow. Returns the new (Windows-safe) name.
export function renameCollection(ws: Workspace, from: string, to: string): string {
  mustExist(ws, from);
  const clean = cleanName(to);
  if (clean === from) return from;
  if (sharedCollections(ws).some((n) => n !== from && n.toLowerCase() === clean.toLowerCase())) throw new Error(`A collection "${clean}" already exists.`);
  refuseWhileRendering(ws, from, songsByCollection(ws).get(from) ?? [], "rename");
  const fromRel = collectionDir({ name: from }, ws.dir);
  const toRel = `${COLLECTIONS_DIR}/${clean}`;
  moveCollection(ws, fromRel, toRel);
  renameRow(ws, from, clean);
  renameInSongs(ws, from, clean, absPath(ws, toRel));
  return clean;
}

const removedLabel = (name: string, at: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${name} (removed ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())})`;
};
const REMOVED_LABEL = /^(.*) \(removed (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\)$/;

// "Delete": the folder moves to collections\_removed\<name> (removed <date>) — nothing is deleted —
// and the songs that used it no longer name it (their own clips and other collections stay).
export function removeCollection(ws: Workspace, name: string): { movedTo: string; songs: CollectionSummary["songs"] } {
  mustExist(ws, name);
  const songs = songsByCollection(ws).get(name) ?? [];
  refuseWhileRendering(ws, name, songs, "remove");
  const fromRel = collectionDir({ name }, ws.dir);
  const toRel = `${COLLECTIONS_DIR}/${REMOVED_COLLECTIONS_DIR}/${removedLabel(name, new Date())}`;
  moveCollection(ws, fromRel, toRel);
  renameRow(ws, name, `${REMOVED_COLLECTIONS_DIR}/${path.posix.basename(toRel)}`);
  renameInSongs(ws, name, null, null);
  return { movedTo: toRel, songs };
}

export function removedCollections(ws: Workspace): RemovedCollection[] {
  const dir = absPath(ws, `${COLLECTIONS_DIR}/${REMOVED_COLLECTIONS_DIR}`);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const m = REMOVED_LABEL.exec(d.name);
      return m
        ? { folder: d.name, name: m[1], removedAt: new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]).toISOString() }
        : { folder: d.name, name: d.name, removedAt: "" };
    })
    .sort((a, b) => b.removedAt.localeCompare(a.removedAt));
}

// "Restore": back to collections\<name> (" (2)" when that name was taken since). Songs are not
// re-ticked: tick it again in a song's Generate tab.
export function restoreCollection(ws: Workspace, folder: string): string {
  const entry = removedCollections(ws).find((r) => r.folder === folder);
  if (!entry) throw new Error(`No removed collection "${folder}".`);
  const taken = new Set(sharedCollections(ws).map((n) => n.toLowerCase()));
  let name = cleanName(entry.name);
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${cleanName(entry.name)} (${n})`;
  const fromRel = `${COLLECTIONS_DIR}/${REMOVED_COLLECTIONS_DIR}/${folder}`;
  moveCollection(ws, fromRel, `${COLLECTIONS_DIR}/${name}`);
  renameRow(ws, `${REMOVED_COLLECTIONS_DIR}/${folder}`, name);
  return name;
}

// "New collection": an empty folder workspace\collections\<name>\ (a Windows-safe name).
export function newCollection(ws: Workspace, name: string): string {
  const clean = cleanName(name);
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
