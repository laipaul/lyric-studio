// A music video made elsewhere, end to end (27 Nov 2026): added to Creation, found in the song, its shots, a shot used
// on its lines (a singing take locked to the song), a shot without a sung line sent to the Storyboard.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, probeMedia, project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, ensureAlignment, songPathsById } from "../src/node";
import { addPictures, picturesView, readPictures } from "../src/node/animate";
import { analyseMusicVideo, useAllMusicVideoShots, useMusicVideoShot, withMusicVideos } from "../src/node/music-video";
import { singerContext } from "../src/node/singer";
import { fakeAlign, ffmpeg, LYRICS } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-mv-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id = "";
let pics = "";

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  // A 12 s song that never repeats (noise shaped by a slow swell), so it lines up in one place only.
  const song = path.join(root, "MV Song.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='(random(0)*2-1)*(0.4+0.3*sin(2*PI*0.37*t))':s=44100:d=12", "-ac", "2", song);
  writeFileSync(path.join(root, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  id = (await createSong(ws, { song, lyrics: path.join(root, "lyrics.txt") })).id;
  const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
  const paths = songPathsById(ws, id);
  const sp = { project: p, songFile: absPath(ws, p.audio_path!), songHash: p.audio_hash!, created: false };
  await ensureAlignment(ws, sp, { lyricsTxt: paths.lyricsTxt, durationMs: 12_000, align: fakeAlign }); // a line every 1.5 s from 1 s
  // "WaveSpeed's" music video: song 2.0-11.0 s under two shots (red 0-5 s, blue 5-9 s), re-encoded to AAC.
  const mv = path.join(root, "mv.mp4");
  ffmpeg(
    "-f", "lavfi", "-i", "color=c=red:s=160x96:r=25:d=5",
    "-f", "lavfi", "-i", "color=c=blue:s=160x96:r=25:d=4",
    "-ss", "2", "-t", "9", "-i", paths.audio!,
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,noise=alls=6:allf=t[v]",
    "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", mv,
  );
  await addPictures(ws, id, [{ file: mv, name: "WaveSpeed bride.mp4" }]);
  pics = path.join(paths.root, "pictures");
}, 120_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("a music video made elsewhere", () => {
  it("is found in the song (its sound is the song) and split into its shots", async () => {
    const mv = await analyseMusicVideo(ws, id, "WaveSpeed bride.mp4");
    expect(mv.matched).toBe(true);
    expect(Math.abs(mv.offsetMs - 2000)).toBeLessThan(30); // AAC re-encoding: within a frame
    expect(mv.score).toBeGreaterThan(0.9);
    expect(mv.shots.map((s) => [Math.round(s.fromMs / 100) / 10, Math.round(s.toMs / 100) / 10])).toEqual([
      [0, 5],
      [5, 9],
    ]);
    expect(readPictures(pics).pictures["WaveSpeed bride.mp4"].mv?.shots).toHaveLength(2);
    // Creation shows each shot with its song time and lines.
    const view = await withMusicVideos(ws, id, await picturesView(ws, id));
    const shots = view.pictures.find((p) => p.file === "WaveSpeed bride.mp4")!.mv!.shots;
    expect(shots[0].songFromMs).toBe(Math.round(mv.offsetMs));
  });

  it("a shot used on its lines is a singing take locked to the song, without sound", async () => {
    const c = await singerContext(ws, id);
    if (!c.lines) throw new Error(`no lines: ${c.why}`);
    const lines = c.lines;
    const mv = readPictures(pics).pictures["WaveSpeed bride.mp4"].mv!;
    const inShot = lines.filter((l) => l.shownMs + 500 >= mv.offsetMs + mv.shots[1].fromMs && l.shownMs + 500 < mv.offsetMs + mv.shots[1].toMs).map((l) => l.number);
    expect(inShot.length).toBeGreaterThan(0);
    const r = await useMusicVideoShot(ws, id, "WaveSpeed bride.mp4", 1);
    expect(r.placed).toBe("lines");
    expect([r.first, r.last]).toEqual([Math.min(...inShot), Math.max(...inShot)]);
    const t = readPictures(pics).pictures["WaveSpeed bride.mp4"].takes.find((x) => x.n === r.n)!;
    expect(t).toMatchObject({ kind: "lipsync", mvShot: 1, model: "WaveSpeed Music Video Generator", status: "done", cost_usd: 0 });
    expect(Math.abs(t.sync_ms! - (mv.offsetMs + 5080))).toBeLessThan(2); // its first frame: the cut + the crossfade frames left out
    const info = await probeMedia(path.join(pics, t.file!));
    expect(info.hasAudio).toBe(false);
    const recipe = JSON.parse(readFileSync(songPathsById(ws, id).recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number }[] };
    expect(recipe.anchors).toContainEqual(expect.objectContaining({ line: r.first, clip: r.clip, sync: t.sync_ms! / 1000 }));
    // Used again: the same take, not a second one.
    const again = await useMusicVideoShot(ws, id, "WaveSpeed bride.mp4", 1);
    expect(again.n).toBe(r.n);
    const view = await withMusicVideos(ws, id, await picturesView(ws, id));
    expect(view.pictures.find((p) => p.file === "WaveSpeed bride.mp4")!.mv!.shots[1].inUse).toBe(true);
  });

  it("Use every singing shot places each shot that carries sung lines", async () => {
    const r = await useAllMusicVideoShots(ws, id, "WaveSpeed bride.mp4");
    expect(r.used).toContain(1);
  });

  it("a video whose sound is another recording is not matched (it stays an ordinary video)", async () => {
    const other = path.join(root, "other.mp4");
    ffmpeg("-f", "lavfi", "-i", "color=c=green:s=160x96:r=25:d=6", "-f", "lavfi", "-i", "aevalsrc='(random(7)*2-1)*0.5':s=44100:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", other);
    await addPictures(ws, id, [{ file: other, name: "other.mp4" }]);
    const mv = await analyseMusicVideo(ws, id, "other.mp4");
    expect(mv.matched).toBe(false);
    expect(mv.shots).toEqual([]);
    await expect(useMusicVideoShot(ws, id, "other.mp4", 0)).rejects.toThrow(/Check it first/);
  });
});
