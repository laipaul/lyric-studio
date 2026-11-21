// "Pick a frame from a video" (Paul, 21 Nov 2026): a video goes in, the app pulls evenly spaced frames out of it
// (FFmpeg) and ranks them by the local face check (a Ready face first: big, sharp, frontal, eyes open); Paul picks
// one as a character's picture (or a Creation picture). The video he dropped is only read: the app works on its own
// copy in workspace\frames\<session>\, which is cleared after a day.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ffmpegBin, probeMedia, type Workspace } from "@lyric/db";

import type { FaceTool } from "./face";

export const FRAMES_DIR = "frames";
export const FRAME_COUNT = 24; // pulled from the video, evenly spaced
export const FRAMES_SHOWN = 12; // the best ones shown
const KEEP_MS = 24 * 3600 * 1000;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;

export type Frame = { file: string; url: string; atMs: number; verdict: string | null; score: number | null; reasons: string[] };
export type FramesResult = { session: string; video: string; durationMs: number; frames: Frame[]; ranked: boolean; note: string | null };

function sweep(root: string, now = Date.now()): void {
  if (!existsSync(root)) return;
  for (const d of readdirSync(root)) {
    const full = path.join(root, d);
    try {
      if (now - statSync(full).mtimeMs > KEEP_MS) rmSync(full, { recursive: true, force: true });
    } catch {
      // in use: next time
    }
  }
}

export async function framesFromVideo(ws: Workspace, video: Buffer, fileName: string, face: FaceTool | null, count = FRAME_COUNT): Promise<FramesResult> {
  const name = path.basename(fileName || "video.mp4");
  if (!VIDEO.test(name)) throw new Error("Choose a video (.mp4, .mov, .webm …).");
  const root = path.join(ws.dir, FRAMES_DIR);
  sweep(root);
  const session = randomUUID();
  const dir = path.join(root, session);
  mkdirSync(dir, { recursive: true });
  const source = path.join(dir, `source${path.extname(name).toLowerCase()}`);
  writeFileSync(source, video);
  try {
    const info = await probeMedia(source).catch(() => null);
    const durationMs = Math.round(info?.durationMs ?? 0);
    if (!durationMs) throw new Error(`${name} could not be read as a video.`);
    // Evenly spaced, away from the very first and last frame (fades); full size, good JPEG.
    const n = Math.max(1, Math.min(count, Math.floor(durationMs / 200)));
    const times = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * durationMs) / n));
    const frames: Frame[] = [];
    for (const [i, t] of times.entries()) {
      const out = path.join(dir, `frame_${String(i + 1).padStart(2, "0")}.jpg`);
      try {
        execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", (t / 1000).toFixed(3), "-i", source, "-frames:v", "1", "-q:v", "2", out]);
      } catch {
        continue;
      }
      if (existsSync(out)) frames.push({ file: out, url: `${FRAMES_DIR}/${session}/${path.basename(out)}`, atMs: t, verdict: null, score: null, reasons: [] });
    }
    if (!frames.length) throw new Error(`No frames could be taken from ${name}.`);
    let ranked = false;
    let note: string | null = null;
    if (face?.rankFrames) {
      try {
        const r = await face.rankFrames(frames.map((f) => f.file));
        const by = new Map(r.frames.map((x) => [path.resolve(x.file), x]));
        for (const f of frames) {
          const x = by.get(path.resolve(f.file));
          if (x) Object.assign(f, { verdict: x.verdict, score: x.score, reasons: x.reasons });
        }
        frames.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.atMs - b.atMs);
        ranked = true;
      } catch (error) {
        note = `The face check could not run (${(error as Error).message}): the frames are in time order.`;
      }
    } else note = "The frames are in time order.";
    // Ranked: the best ones; in time order: spread over the whole video.
    const step = Math.ceil(frames.length / FRAMES_SHOWN);
    const shown = ranked ? frames.slice(0, FRAMES_SHOWN) : frames.filter((_, i) => i % step === 0).slice(0, FRAMES_SHOWN);
    return { session, video: name, durationMs, frames: shown, ranked, note };
  } finally {
    rmSync(source, { force: true }); // only the frames are kept (for a day)
  }
}
