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
): Promise<Clip[]> {
  if (!existsSync(folder)) throw new Error(`Clips folder not found: ${folder}`);
  const files = readdirSync(folder).filter((f) => VIDEO_FILE.test(f)).sort();
  if (!files.length) throw new Error(`No video files in ${folder}`);

  const coll =
    ws.db.select().from(collectionTable).where(eq(collectionTable.name, collectionName)).get() ??
    createCollection(ws, collectionName);
  const existing = ws.db.select().from(clipTable).where(eq(clipTable.collection_id, coll.id)).all();

  const clips: Clip[] = [];
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
      clips.push(match);
      continue;
    }
    log(`importing clip ${file}`);
    clips.push(await addClip(ws, { collectionId: coll.id, file: source }));
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

export type NormalisedClip = { clip: Clip; path: string; durationFrames: number; durationMs: number };

export async function normaliseClip(ws: Workspace, clip: Clip, log: (m: string) => void = () => {}): Promise<NormalisedClip> {
  const relative = `cache/normalised/${clip.id}-v${NORMALISE_VERSION}.mp4`;
  const out = absPath(ws, relative);
  if (!existsSync(out)) {
    log(`preparing clip ${path.posix.basename(clip.path)} (1080x1920, 30 fps)`);
    mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.tmp.mp4`;
    try {
      await run(ffmpegBin(), [
        "-y", "-v", "error",
        "-i", absPath(ws, clip.path),
        "-an",
        "-vf", `scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=increase,crop=${VIDEO.width}:${VIDEO.height},setsar=1,fps=${VIDEO.fps},format=yuv420p`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", String(VIDEO.fps),
        "-movflags", "+faststart",
        tmp,
      ]);
      renameSync(tmp, out);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }
  const info = await probeMedia(out);
  return { clip, path: relative, durationMs: info.durationMs, durationFrames: Math.floor((info.durationMs * VIDEO.fps) / 1000) };
}

export async function prepareClips(
  ws: Workspace,
  folder: string,
  collectionName: string,
  log: (m: string) => void = () => {},
): Promise<NormalisedClip[]> {
  const clips = await importClipsFromFolder(ws, folder, collectionName, log);
  const out: NormalisedClip[] = [];
  for (const c of clips) out.push(await normaliseClip(ws, c, log));
  return out;
}

