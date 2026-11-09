// Theme v2 step 2d on a real song folder: when Shape plans a video, its storyboard file is written
// (storyboards\reels-1.json) with exactly the plan's frames; the moved cuts and slips of clips.json become locks,
// one that no shot matches is named in Shape's notes and in the file (never dropped); shot ids stay when the
// plan is made again.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { storyboardTiming } from "../src";
import { findOrCreateSongProject, makeVideos, readClipEdits, readStoryboard, songPathsById, storyboardFile, storyboardPlan, storyboardsReport, writeAllStoryboards, writeClipEdits, writeRecipe, type RenderOptions } from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-storyboard-save-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "Save Test.wav");
const sample = path.join(root, "s.mp4");
const previousWorkspace = process.env.WORKSPACE_DIR;
const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
const CLIPS = ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4"];
let ws: Workspace;
let id: string;
let songRoot: string;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  makeSong(song, 20);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, name] of CLIPS.entries()) makeClip(path.join(paths.clips!, name), 8, ["blue", "yellow", "red", "green"][i]);
  writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 }, shotLength: "rate" });
  await makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32" });
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("storyboard file of a planned video", () => {
  it("Shape's plan is saved with exactly its frames", async () => {
    const view = await storyboardPlan(ws, id, "reels", "v1");
    const file = storyboardFile(songRoot, "reels-1");
    expect(existsSync(file)).toBe(true);
    const sb = readStoryboard(file)!;
    expect(sb).toMatchObject({ schemaVersion: 1, id: "reels-1", song: { title: "Save Test" }, output: { platform: "reels", format: "9:16", fps: 30 } });
    expect(sb.inputs.song?.file).toBe(path.basename(songPathsById(ws, id).audio!));
    expect(sb.inputs.alignment).toMatch(/\.lrc$/);
    expect(sb.shots.map((s) => s.clip)).toEqual(view.shots.map((s) => s.clip));
    const t = storyboardTiming(sb);
    expect(t.durationInFrames).toBe(view.props.durationInFrames);
    expect(t.shots.map((s) => [s.start, s.duration])).toEqual(view.props.shots.map((s) => [s.start, s.duration]));
    expect(t.lyrics.map((l) => [l.startFrame, l.endFrame])).toEqual(view.props.lyrics.map((l) => [l.startFrame, l.endFrame]));
    expect(sb.text.filter((x) => x.kind === "lyric").map((x) => x.id)).toEqual(view.lines.map((l) => `line-${l.number}`));
    expect(sb.edits.unmatched).toEqual([]);
  }, 300_000);

  it("moved cuts and slips become locks; one that no shot matches is named, never dropped", async () => {
    const before = await storyboardPlan(ws, id, "reels", "v1");
    const second = before.shots[1];
    // Halfway between the cuts into shots 3 and 4: no cut of the plan is there (and none near where it came from).
    const mid = Math.round((before.shots[2].songMs + before.shots[3].songMs) / 2);
    expect(before.shots[3].songMs - before.shots[2].songMs).toBeGreaterThan(1000);
    const edits = readClipEdits(songRoot);
    writeClipEdits(songRoot, {
      ...edits,
      cuts: [{ from: second.songMs / 1000 - 0.4, to: second.songMs / 1000 }, { from: mid / 1000 - 0.05, to: mid / 1000 }],
      slips: [{ at: second.songMs / 1000, clip: second.clip, in: second.inS }],
    });
    const after = await storyboardPlan(ws, id, "reels", "v1");
    const sb = readStoryboard(storyboardFile(songRoot, "reels-1"))!;
    const s2 = sb.shots.find((s) => Math.abs(s.startMs - second.songMs) <= 200)!;
    expect(s2.locked).toEqual(expect.arrayContaining(["startMs", "trim"]));
    expect(sb.shots[0].locked).toContain("endMs");
    expect(sb.edits.unmatched.map((u) => [u.kind, u.atMs])).toEqual([["cut", mid]]);
    expect(after.notes.filter((n) => n.startsWith("Moved cut not used:"))).toHaveLength(1);
    writeClipEdits(songRoot, edits);
  }, 300_000);

  it("shot ids stay when the plan is made again", async () => {
    const file = storyboardFile(songRoot, "reels-1");
    await storyboardPlan(ws, id, "reels", "v1");
    const first = readStoryboard(file)!;
    await storyboardPlan(ws, id, "reels", "v1");
    const again = readStoryboard(file)!;
    expect(again.shots.map((s) => s.id)).toEqual(first.shots.map((s) => s.id));
    expect(again.history.generatedAt >= first.history.generatedAt).toBe(true);
  }, 300_000);

  it("pnpm storyboards: every song's videos, and the moved cuts no video uses, by song and shot", async () => {
    const edits = readClipEdits(songRoot);
    writeClipEdits(songRoot, { ...edits, cuts: [{ from: 59.5, to: 60 }] }); // after the 0:16 section ends: no video has it
    const songs = await writeAllStoryboards(ws);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ title: "Save Test", written: ["reels-1"], skipped: null, failed: [] });
    expect(songs[0].unused).toEqual([expect.stringMatching(/^moved cut 0:59\.5 -> 1:00\.0: outside every planned video's part of the song \(reels 1 0:0\d\.\d-0:1\d\.\d\); kept in clips\.json$/)]);
    const report = storyboardsReport(songs);
    expect(report).toContain("Save Test (");
    expect(report).toContain("1 moved cut(s) / slip(s) not used by any video: listed above.");
    writeClipEdits(songRoot, edits);
  }, 300_000);
});
