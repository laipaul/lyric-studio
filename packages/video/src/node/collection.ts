// Collections for "pnpm make": a collection is a folder of clips, WORKSPACE_DIR\clips\<name>\ (or any
// folder given with --collection-path). Every run compares the folder with the database by content
// hash (SHA-256): new clips are added, changed ones are refreshed, unchanged ones are skipped, and
// rows whose file is gone are removed from the collection. Clips are recorded where they are (not
// copied). Hashes are cached by file size + modification time, so unchanged clips are not re-read.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  absPath,
  addClip,
  clip as clipTable,
  collection as collectionTable,
  collectionDir,
  fileHash,
  refreshClip,
  storedPath,
  type Clip,
  type Collection,
  type Workspace,
} from "@lyric/db";
import { eq, inArray } from "drizzle-orm";

import { sourceFit, type Format } from "../platform";
import { normaliseClip, type NormalisedClip } from "./clips";

export const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
export const SOURCE_FILE = /\.(mp4|m4v|mov|webm|mkv|avi|jpe?g|png|webp)$/i; // videos and photos

type HashCache = Record<string, { size: number; mtimeMs: number; sha256: string }>;
const hashCacheFile = (ws: Workspace) => path.join(ws.dir, "cache", "hashes.json");

// SHA-256 of a file, cached by full path + size + modification time.
export async function cachedFileHash(ws: Workspace, file: string): Promise<string> {
  const cacheFile = hashCacheFile(ws);
  let cache: HashCache = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, "utf8")) as HashCache;
  } catch {
    // no cache yet
  }
  const key = path.resolve(file);
  const stat = statSync(key);
  const hit = cache[key];
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.sha256;
  const sha256 = await fileHash(key);
  cache[key] = { size: stat.size, mtimeMs: stat.mtimeMs, sha256 };
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache));
  return sha256;
}

export type SourceClip = { clip: Clip; name: string; file: string; hash: string };

export type CollectionSync = {
  collection: Collection;
  folder: string;
  sources: SourceClip[]; // every video and photo, in file-name order
  clips: (NormalisedClip & { file: string; hash: string })[]; // prepared for 1080x1920 cover (unless prepare: false)
  added: string[];
  changed: string[];
  unchanged: string[];
  removed: string[];
};

export async function syncCollection(
  ws: Workspace,
  options: { name: string; folder?: string; log?: (m: string) => void; prepare?: boolean },
): Promise<CollectionSync> {
  const log = options.log ?? (() => {});
  const existingColl = ws.db.select().from(collectionTable).where(eq(collectionTable.name, options.name)).get();
  const folder = path.resolve(options.folder ?? absPath(ws, collectionDir({ name: options.name })));
  if (!existsSync(folder)) {
    throw new Error(
      `Collection folder not found: ${folder}\n` +
        `Create it and copy your clips into it, or point to another folder with --collection-path.`,
    );
  }
  const files = readdirSync(folder)
    .filter((f) => SOURCE_FILE.test(f) && statSync(path.join(folder, f)).isFile())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  if (!files.length) throw new Error(`No videos or photos (.mp4, .mov, .webm, .jpg, .png, .webp, ...) in ${folder}`);

  const coll = existingColl ?? ws.db.insert(collectionTable).values({ name: options.name }).returning().get();
  const rows = ws.db.select().from(clipTable).where(eq(clipTable.collection_id, coll.id)).all();
  const byPath = new Map(rows.map((r) => [r.path, r]));

  const result: CollectionSync = { collection: coll, folder, sources: [], clips: [], added: [], changed: [], unchanged: [], removed: [] };
  const seen = new Set<string>();
  for (const name of files) {
    const file = path.join(folder, name);
    const stored = storedPath(ws, file);
    seen.add(stored);
    const hash = await cachedFileHash(ws, file);
    const row = byPath.get(stored);
    let clipRow: Clip;
    if (!row) {
      log(`new clip ${name}`);
      clipRow = await addClip(ws, { collectionId: coll.id, file, inPlace: true, contentHash: hash });
      result.added.push(name);
    } else if (row.content_hash !== hash) {
      log(row.content_hash ? `changed clip ${name}` : `clip ${name}: recording its content hash`);
      clipRow = await refreshClip(ws, row, hash);
      (row.content_hash ? result.changed : result.unchanged).push(name);
    } else {
      clipRow = row;
      result.unchanged.push(name);
    }
    result.sources.push({ clip: clipRow, name, file, hash });
    if (options.prepare !== false) result.clips.push({ ...(await normaliseClip(ws, clipRow, name, log)), file, hash });
  }

  const gone = rows.filter((r) => !seen.has(r.path));
  if (gone.length) {
    ws.db.delete(clipTable).where(inArray(clipTable.id, gone.map((r) => r.id))).run();
    result.removed.push(...gone.map((r) => path.basename(absPath(ws, r.path))));
  }
  return result;
}

export type PreparedForFormat = {
  clips: (NormalisedClip & { file: string; hash: string })[];
  usable: number; // sources that suit the format without a blurred fill
  filled: string[]; // shown whole over a blurred copy (--allow-fill)
  skipped: string[]; // not suitable for this format
  kind: "vertical" | "horizontal";
};

// The sources a platform can use, prepared at its size: matching orientation, cover-cropped; other
// sources only with --allow-fill (whole picture over a blurred copy).
export async function prepareForFormat(
  ws: Workspace,
  sources: readonly SourceClip[],
  format: Format,
  options: { allowFill?: boolean; log?: (m: string) => void } = {},
): Promise<PreparedForFormat> {
  const out: PreparedForFormat = { clips: [], usable: 0, filled: [], skipped: [], kind: format.height > format.width ? "vertical" : "horizontal" };
  for (const s of sources) {
    const fit = sourceFit(s.clip.width, s.clip.height, format, !!options.allowFill);
    if (!fit) {
      out.skipped.push(s.name);
      continue;
    }
    if (fit === "cover") out.usable += 1;
    else out.filled.push(s.name);
    const prepared = await normaliseClip(ws, s.clip, s.name, options.log, { fit, width: format.width, height: format.height });
    out.clips.push({ ...prepared, file: s.file, hash: s.hash });
  }
  return out;
}
