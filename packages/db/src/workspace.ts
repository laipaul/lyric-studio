// Workspace service: saves songs and clips into the folder layout from CLAUDE.md and records them
// in the database.
//
//   <workspace>/studio.db
//   <workspace>/projects/<project id>/audio/
//   <workspace>/projects/<project id>/exports/
//   <workspace>/clips/<collection name>/
//   <workspace>/thumbs/<clip id>.jpg
//
// Paths in the database are relative to the workspace folder, so the folder can be moved.
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { openDb, runMigrations, type Db } from "./client";
import { resolveWorkspaceDir } from "./config";
import { makeThumbnail, probeMedia, thumbnailTimeSeconds } from "./ffmpeg";
import { clip, collection, project, type Clip, type ClipSource, type Collection, type Project } from "./schema";

export type Workspace = {
  dir: string;
  db: Db;
  close: () => void;
};

// Opens the workspace (default: WORKSPACE_DIR from .env), creating folders and applying migrations.
export function openWorkspace(dir: string = resolveWorkspaceDir()): Workspace {
  for (const sub of ["projects", "clips", "thumbs"]) mkdirSync(path.join(dir, sub), { recursive: true });
  const db = openDb(dir);
  runMigrations(db);
  return { dir, db, close: () => db.$client.close() };
}

// Stored paths use "/" on every OS; this turns one back into a full path on this PC. Files outside
// the workspace (a clips folder given with --collection-path) are stored as full paths.
export function absPath(ws: Workspace, relative: string): string {
  if (path.isAbsolute(relative) || /^[a-zA-Z]:[\\/]/.test(relative)) return path.resolve(relative);
  return path.join(ws.dir, ...relative.split("/"));
}

// How a file is stored in the database: relative to the workspace ("/" separators) when it is
// inside it, otherwise its full path.
export function storedPath(ws: Workspace, file: string): string {
  const relative = path.relative(ws.dir, path.resolve(file));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return path.resolve(file);
  return relative.split(path.sep).join("/");
}

// SHA-256 of a file's content (streamed, so large videos do not need to fit in memory).
export function fileHash(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

const rel = (...parts: string[]) => parts.join("/");

// Makes a name safe as a Windows file or folder name.
export function safeName(name: string): string {
  let cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .replace(/[. ]+$/, "");
  if (!cleaned) cleaned = "untitled";
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned;
}

// Picks "name.ext", "name-2.ext", ... so an existing file is never overwritten.
function uniqueFileName(dir: string, fileName: string): string {
  const { name, ext } = path.parse(safeName(fileName));
  let candidate = `${name}${ext}`;
  for (let n = 2; existsSync(path.join(dir, candidate)); n++) candidate = `${name}-${n}${ext}`;
  return candidate;
}

export function projectDirs(projectId: string) {
  return {
    audio: rel("projects", projectId, "audio"),
    exports: rel("projects", projectId, "exports"),
  };
}

export type CreateProjectInput = {
  title: string;
  artist?: string;
  audioFile: string; // the song on disk (WAV/MP3); it is copied into the workspace
  coverFile?: string;
};

export async function createProject(ws: Workspace, input: CreateProjectInput): Promise<Project> {
  if (!existsSync(input.audioFile)) throw new Error(`Song file not found: ${input.audioFile}`);
  const info = await probeMedia(input.audioFile);
  if (!info.hasAudio) throw new Error(`No audio found in ${input.audioFile}`);

  const id = randomUUID();
  const dirs = projectDirs(id);
  const projectRoot = absPath(ws, rel("projects", id));
  mkdirSync(absPath(ws, dirs.audio), { recursive: true });
  mkdirSync(absPath(ws, dirs.exports), { recursive: true });

  try {
    const audioName = safeName(path.basename(input.audioFile));
    const audioPath = rel(dirs.audio, audioName);
    copyFileSync(input.audioFile, absPath(ws, audioPath));

    let coverPath: string | null = null;
    if (input.coverFile) {
      coverPath = rel(dirs.audio, uniqueFileName(absPath(ws, dirs.audio), `cover${path.extname(input.coverFile)}`));
      copyFileSync(input.coverFile, absPath(ws, coverPath));
    }

    return ws.db
      .insert(project)
      .values({
        id,
        title: input.title,
        artist: input.artist ?? "Life Lyrics",
        audio_path: audioPath,
        cover_path: coverPath,
        duration_ms: info.durationMs,
      })
      .returning()
      .get();
  } catch (error) {
    rmSync(projectRoot, { recursive: true, force: true });
    throw error;
  }
}

export function collectionDir(c: Pick<Collection, "name">): string {
  return rel("clips", safeName(c.name));
}

export function createCollection(ws: Workspace, name: string): Collection {
  const row = ws.db.insert(collection).values({ name }).returning().get();
  mkdirSync(absPath(ws, collectionDir(row)), { recursive: true });
  return row;
}

export type AddClipInput = {
  collectionId: string;
  file: string; // the video on disk; it is copied into the collection folder (unless inPlace)
  source?: ClipSource;
  inPlace?: boolean; // the file already is where it belongs (a collection folder): record it, do not copy
  contentHash?: string;
};

export async function addClip(ws: Workspace, input: AddClipInput): Promise<Clip> {
  const coll = ws.db.select().from(collection).where(eq(collection.id, input.collectionId)).get();
  if (!coll) throw new Error(`Collection not found: ${input.collectionId}`);
  if (!existsSync(input.file)) throw new Error(`Video file not found: ${input.file}`);

  const info = await probeMedia(input.file);
  if (!info.hasVideo || !info.width || !info.height) throw new Error(`No video found in ${input.file}`);

  const id = randomUUID();
  let clipPath: string;
  if (input.inPlace) {
    clipPath = storedPath(ws, input.file);
  } else {
    const folder = collectionDir(coll);
    mkdirSync(absPath(ws, folder), { recursive: true });
    clipPath = rel(folder, uniqueFileName(absPath(ws, folder), path.basename(input.file)));
    copyFileSync(input.file, absPath(ws, clipPath));
  }
  const thumbPath = rel("thumbs", `${id}.jpg`);

  try {
    await makeThumbnail(absPath(ws, clipPath), absPath(ws, thumbPath), thumbnailTimeSeconds(info.durationMs));
    return ws.db
      .insert(clip)
      .values({
        id,
        collection_id: coll.id,
        path: clipPath,
        duration_ms: info.durationMs,
        width: info.width,
        height: info.height,
        thumb_path: thumbPath,
        source: input.source ?? "upload",
        content_hash: input.contentHash ?? null,
      })
      .returning()
      .get();
  } catch (error) {
    if (!input.inPlace) rmSync(absPath(ws, clipPath), { force: true });
    rmSync(absPath(ws, thumbPath), { force: true });
    throw error;
  }
}

// The clip's file changed on disk: read its size and duration again, make a new thumbnail and store
// the new content hash. The clip keeps its id.
export async function refreshClip(ws: Workspace, existing: Clip, contentHash: string): Promise<Clip> {
  const file = absPath(ws, existing.path);
  const info = await probeMedia(file);
  if (!info.hasVideo || !info.width || !info.height) throw new Error(`No video found in ${file}`);
  const thumbPath = existing.thumb_path ?? rel("thumbs", `${existing.id}.jpg`);
  await makeThumbnail(file, absPath(ws, thumbPath), thumbnailTimeSeconds(info.durationMs));
  return ws.db
    .update(clip)
    .set({ duration_ms: info.durationMs, width: info.width, height: info.height, thumb_path: thumbPath, content_hash: contentHash })
    .where(eq(clip.id, existing.id))
    .returning()
    .get();
}
