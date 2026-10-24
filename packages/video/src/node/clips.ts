// Test clips: import a folder of videos into a collection (Step 2 workspace service) and make
// normalised copies (H.264, 1080x1920 cover-cropped, 30 fps) that play reliably in both the browser
// preview and the render. Copies are cached in <workspace>/cache/normalised/.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

import {
  absPath,
  addClip,
  clip as clipTable,
  collection as collectionTable,
  createCollection,
  ffmpegBin,
  PHOTO_EXTENSION,
  probeMedia,
  safeName,
  type Clip,
  type Workspace,
} from "@lyric/db";
import { eq } from "drizzle-orm";

import { VIDEO } from "../config";

const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
export const NORMALISE_VERSION = 1;

export async function importClipsFromFolder(
  ws: Workspace,
  folder: string,
  collectionName: string,
  log: (message: string) => void = () => {},
): Promise<{ clip: Clip; sourceName: string }[]> {
  if (!existsSync(folder)) throw new Error(`Clips folder not found: ${folder}`);
  const files = readdirSync(folder).filter((f) => VIDEO_FILE.test(f)).sort();
  if (!files.length) throw new Error(`No video files in ${folder}`);

  const coll =
    ws.db.select().from(collectionTable).where(eq(collectionTable.name, collectionName)).get() ??
    createCollection(ws, collectionName);
  const existing = ws.db.select().from(clipTable).where(eq(clipTable.collection_id, coll.id)).all();

  const clips: { clip: Clip; sourceName: string }[] = [];
  for (const file of files) {
    const source = path.join(folder, file);
    // Already imported: same file name and size in this collection.
    const match = existing.find(
      (c) =>
        path.posix.basename(c.path) === safeName(file) &&
        existsSync(absPath(ws, c.path)) &&
        statSync(absPath(ws, c.path)).size === statSync(source).size,
    );
    if (match) {
      clips.push({ clip: match, sourceName: file });
      continue;
    }
    log(`importing clip ${file}`);
    clips.push({ clip: await addClip(ws, { collectionId: coll.id, file: source }), sourceName: file });
  }
  return clips;
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(bin, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, _out, stderr) =>
      error ? reject(new Error(`${bin} failed: ${stderr.trim() || error.message}`)) : resolve(),
    ),
  );
}

export type NormalisedClip = {
  clip: Clip;
  name: string;
  path: string;
  durationFrames: number;
  durationMs: number;
  kind: "video" | "photo";
  fit: "cover" | "fill";
};

export type NormaliseOptions = { fit?: "cover" | "fill"; width?: number; height?: number };

// Prepared copy of a clip for the composition:
//   videos, cover: H.264 at the output size, cover-cropped, 30 fps (cache/normalised/<hash>-v1.mp4)
//   videos, fill:  the whole picture scaled to fit inside the output size (shown over a blurred copy)
//   photos:        a JPEG of at most 3000 px (the Ken Burns move zooms up to 1.12x)
export async function normaliseClip(
  ws: Workspace,
  clip: Clip,
  name: string,
  log: (m: string) => void = () => {},
  options: NormaliseOptions = {},
): Promise<NormalisedClip> {
  const width = options.width ?? VIDEO.width;
  const height = options.height ?? VIDEO.height;
  const fit = options.fit ?? "cover";
  const photo = PHOTO_EXTENSION.test(clip.path);
  // By content when known, so a clip whose file changed gets a new normalised copy.
  const key = clip.content_hash ? clip.content_hash.slice(0, 24) : clip.id;
  const sizeTag = fit === "cover" && width === VIDEO.width && height === VIDEO.height ? "" : `-${fit}${width}x${height}`;
  const relative = photo ? `cache/normalised/${key}-photo-v${NORMALISE_VERSION}.jpg` : `cache/normalised/${key}${sizeTag}-v${NORMALISE_VERSION}.mp4`;
  const out = absPath(ws, relative);
  if (!existsSync(out)) {
    log(`preparing ${photo ? "photo" : "clip"} ${path.posix.basename(clip.path)}${photo ? "" : ` (${width}x${height}, 30 fps${fit === "fill" ? ", whole picture" : ""})`}`);
    mkdirSync(path.dirname(out), { recursive: true });
    const tmp = photo ? `${out}.tmp.jpg` : `${out}.tmp.mp4`;
    const scale =
      fit === "cover"
        ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
        : `scale=${width}:${height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    const args = photo
      ? ["-y", "-v", "error", "-i", absPath(ws, clip.path), "-frames:v", "1", "-vf", "scale=w='min(iw,3000)':h='min(ih,3000)':force_original_aspect_ratio=decrease", "-q:v", "2", tmp]
      : [
          "-y", "-v", "error",
          "-i", absPath(ws, clip.path),
          "-an",
          "-vf", `${scale},setsar=1,fps=${VIDEO.fps},format=yuv420p`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", String(VIDEO.fps),
          "-movflags", "+faststart",
          tmp,
        ];
    try {
      await run(ffmpegBin(), args);
      renameSync(tmp, out);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }
  if (photo) return { clip, name, path: relative, durationMs: 0, durationFrames: 0, kind: "photo", fit };
  const info = await probeMedia(out);
  return { clip, name, path: relative, durationMs: info.durationMs, durationFrames: Math.floor((info.durationMs * VIDEO.fps) / 1000), kind: "video", fit };
}

export async function prepareClips(
  ws: Workspace,
  folder: string,
  collectionName: string,
  log: (m: string) => void = () => {},
): Promise<NormalisedClip[]> {
  const clips = await importClipsFromFolder(ws, folder, collectionName, log);
  const out: NormalisedClip[] = [];
  for (const c of clips) out.push(await normaliseClip(ws, c.clip, c.sourceName, log));
  return out;
}

