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
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
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

// Stored paths use "/" on every OS; this turns one back into a full path on this PC.
export function absPath(ws: Workspace, relative: string): string {
  return path.join(ws.dir, ...relative.split("/"));
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
  file: string; // the video on disk; it is copied into the collection folder
  source?: ClipSource;
};

export async function addClip(ws: Workspace, input: AddClipInput): Promise<Clip> {
  const coll = ws.db.select().from(collection).where(eq(collection.id, input.collectionId)).get();
  if (!coll) throw new Error(`Collection not found: ${input.collectionId}`);
  if (!existsSync(input.file)) throw new Error(`Video file not found: ${input.file}`);

  const info = await probeMedia(input.file);
  if (!info.hasVideo || !info.width || !info.height) throw new Error(`No video found in ${input.file}`);

  const id = randomUUID();
  const folder = collectionDir(coll);
  mkdirSync(absPath(ws, folder), { recursive: true });
  const clipPath = rel(folder, uniqueFileName(absPath(ws, folder), path.basename(input.file)));
  const thumbPath = rel("thumbs", `${id}.jpg`);

  copyFileSync(input.file, absPath(ws, clipPath));
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
      })
      .returning()
      .get();
  } catch (error) {
    rmSync(absPath(ws, clipPath), { force: true });
    rmSync(absPath(ws, thumbPath), { force: true });
    throw error;
  }
}
