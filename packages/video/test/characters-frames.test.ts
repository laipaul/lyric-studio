// "Pick a frame from a video" (21 Nov 2026): evenly spaced frames out of a video, ranked by the face check (the
// stand-in here: no face models), the best shown first; the video the user dropped is only read, the app's own copy
// is removed at once, and the frames are kept a day under workspace\frames\<session>\.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, expect, test } from "vitest";

import { FRAMES_DIR, FRAMES_SHOWN, framesFromVideo } from "../src/node/characters";
import { stubFace } from "../src/node/characters/stub";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-frames-"));
const video = path.join(root, "my clip.mp4");
let ws: Workspace;

beforeAll(() => {
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x240:d=6:r=25", "-pix_fmt", "yuv420p", video]);
  ws = openWorkspace(path.join(root, "workspace"));
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

test("frames come out ranked, best faces first, at most 12, and the video is untouched", async () => {
  const before = readFileSync(video);
  const r = await framesFromVideo(ws, before, "my clip.mp4", stubFace());
  expect(r.ranked).toBe(true);
  expect(r.video).toBe("my clip.mp4");
  expect(r.durationMs).toBeGreaterThan(5500);
  expect(r.frames.length).toBe(FRAMES_SHOWN);
  const scores = r.frames.map((f) => f.score ?? -1);
  expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  expect(r.frames.every((f) => f.verdict === "Ready")).toBe(true); // the stand-in's "No face" frames are not shown first
  for (const f of r.frames) {
    expect(f.url).toMatch(new RegExp(`^${FRAMES_DIR}/[0-9a-f-]{36}/frame_\\d+\\.jpg$`));
    expect(existsSync(path.join(ws.dir, f.url))).toBe(true);
  }
  const dir = path.join(ws.dir, FRAMES_DIR, r.session);
  expect(readdirSync(dir).some((n) => n.startsWith("source"))).toBe(false); // the app's copy is gone
  expect(readFileSync(video).equals(before)).toBe(true);
});

test("without a face check the frames are spread over the whole video, in time order", async () => {
  const r = await framesFromVideo(ws, readFileSync(video), "my clip.mp4", null);
  expect(r.ranked).toBe(false);
  expect(r.note).toMatch(/time order/);
  const t = r.frames.map((f) => f.atMs);
  expect([...t].sort((a, b) => a - b)).toEqual(t);
  expect(t[t.length - 1]).toBeGreaterThan(r.durationMs * 0.8);
});

test("a file that is not a video is refused; old sessions are cleared after a day", async () => {
  await expect(framesFromVideo(ws, Buffer.from("x"), "notes.txt", null)).rejects.toThrow(/Choose a video/);
  const old = path.join(ws.dir, FRAMES_DIR, "00000000-0000-0000-0000-000000000000");
  mkdirSync(old, { recursive: true });
  const t = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  utimesSync(old, t, t);
  expect(statSync(old).isDirectory()).toBe(true);
  await framesFromVideo(ws, readFileSync(video), "my clip.mp4", null);
  expect(existsSync(old)).toBe(false);
});
