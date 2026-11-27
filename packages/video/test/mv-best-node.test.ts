// Best shot for each line across music videos, end to end (27 Nov 2026): two music videos of the same stretch, every
// singing shot cut out and face-checked, the best of each line placed in time; a line Paul set himself stays.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, ensureAlignment, songPathsById } from "../src/node";
import { addPictures, readPictures } from "../src/node/animate";
import type { FaceTool } from "../src/node/characters/face";
import { analyseMusicVideo, useMusicVideoShot } from "../src/node/music-video";
import { bestShotsView, useBestShots } from "../src/node/mv-best";
import { fakeAlign, ffmpeg, LYRICS } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-mvbest-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id = "";
let pics = "";
// The stand-in face check: the "B" video's face goes wrong in its second shot.
const face = {
  takecheck: async (_ref: string, video: string) => {
    const bad = /B run shot 2/.test(video);
    const frames = Array.from({ length: 20 }, (_, k) => ({ t: k * 0.2, face: true, sim: bad && k > 2 ? 0.05 : 0.62, sharp: 100, texture: 50 }));
    return { duration: 4, frames };
  },
} as unknown as FaceTool;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "MV Song.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='(random(0)*2-1)*(0.4+0.3*sin(2*PI*0.37*t))':s=44100:d=12", "-ac", "2", song);
  writeFileSync(path.join(root, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  id = (await createSong(ws, { song, lyrics: path.join(root, "lyrics.txt") })).id;
  const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
  const paths = songPathsById(ws, id);
  await ensureAlignment(ws, { project: p, songFile: absPath(ws, p.audio_path!), songHash: p.audio_hash!, created: false }, { lyricsTxt: paths.lyricsTxt, durationMs: 12_000, align: fakeAlign });
  // Two runs of the same stretch (song 2-11 s), cut in the same places (5 s): A red / blue, B green / yellow.
  for (const [name, c1, c2] of [["A run.mp4", "red", "blue"], ["B run.mp4", "green", "yellow"]]) {
    const out = path.join(root, name);
    ffmpeg("-f", "lavfi", "-i", `color=c=${c1}:s=160x96:r=25:d=5`, "-f", "lavfi", "-i", `color=c=${c2}:s=160x96:r=25:d=4`, "-ss", "2", "-t", "9", "-i", paths.audio!, "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,noise=alls=6:allf=t[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", out);
    await addPictures(ws, id, [{ file: out, name }]);
  }
  pics = path.join(paths.root, "pictures");
  for (const name of ["A run.mp4", "B run.mp4"]) expect((await analyseMusicVideo(ws, id, name)).matched).toBe(true);
}, 180_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

const anchors = () => (JSON.parse(readFileSync(songPathsById(ws, id).recipe!, "utf8")) as { anchors?: { line: number; through?: number; clip: string; sync?: number }[] }).anchors ?? [];

describe("best shot for each line across music videos", () => {
  it("before anything is cut: both videos' shots are candidates, none checked yet", async () => {
    const v = (await bestShotsView(ws, id))!;
    expect(v.videos.map((x) => x.file)).toEqual(["A run.mp4", "B run.mp4"]);
    expect(v.unchecked).toBe(4);
    expect(v.rows.length).toBeGreaterThan(0);
    expect(v.rows.every((r) => r.pick && r.others.length >= 1)).toBe(true);
  });

  it("Use the best for every line: cut, checked, the bad face left out, placed in time, never overlapping", async () => {
    const r = await useBestShots(ws, id, face);
    expect(r.placed).toBeGreaterThan(0);
    const v = (await bestShotsView(ws, id))!;
    expect(v.unchecked).toBe(0);
    expect(v.toPlace).toBe(0);
    const second = v.rows.find((x) => x.pick && x.pick.shot === 1)!;
    expect(second.pick!.video).toBe("A run.mp4"); // B's second shot: the face goes wrong
    expect(second.others.find((o) => o.video === "B run.mp4")?.reasons[0]).toBe("the face goes wrong while she sings");
    const singing = anchors().filter((a) => a.sync !== undefined);
    expect(singing.length).toBe(v.rows.length);
    for (let k = 1; k < singing.length; k++) expect(singing[k].line).toBeGreaterThan(singing[k - 1].through ?? singing[k - 1].line);
    // In time: each anchor's song time is its take's.
    for (const row of v.rows) {
      const t = readPictures(pics).pictures[row.pick!.video].takes.find((x) => x.n === row.pick!.take)!;
      expect(singing.find((a) => a.line === row.first)?.sync).toBe(t.sync_ms! / 1000);
    }
  });

  it("a shot picked by hand is kept the next time; the app never replaces it", async () => {
    const v = (await bestShotsView(ws, id))!;
    const row = v.rows.find((x) => x.pick && x.pick.shot === 1)!;
    const other = row.others.find((o) => o.video === "B run.mp4")!;
    await useMusicVideoShot(ws, id, other.video, other.shot, { hand: true });
    const after = (await bestShotsView(ws, id))!;
    expect(after.rows.find((x) => x.first === row.first)).toMatchObject({ pick: null, locked: "hand" });
    await useBestShots(ws, id, face);
    const t = readPictures(pics).pictures["B run.mp4"].takes.find((x) => x.mvShot === 1 && x.handPicked)!;
    expect(anchors().find((a) => a.line === row.first)?.clip).toBe(t.sent);
  });
});
