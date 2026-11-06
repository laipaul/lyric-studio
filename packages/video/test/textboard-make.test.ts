// The textboard in pnpm make: per-card overrides reach the rendered props (place, size, hold, effect,
// font, title cards on a vertical platform), the storyboard's dry run plans exactly what is rendered,
// the manifest records the textboard and template; picture versions keep the text and turn an anchor
// whose clip is missing into a slot.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultCards, setCardOverrides, type Textboard } from "../src";
import { findOrCreateSongProject, lyricsLines, makeVideos, readManifest, songPathsById, writeRecipe, writeTextboard, type RenderOptions } from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-textboard-make-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "Text Test.wav");
const sample = path.join(root, "s.mp4");
const previousWorkspace = process.env.WORKSPACE_DIR;
const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
let ws: Workspace;
let id: string;
let paths: ReturnType<typeof songPathsById>;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  makeSong(song, 20);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  paths = songPathsById(ws, id);
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, name] of ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4"].entries()) makeClip(path.join(paths.clips!, name), 8, ["blue", "yellow", "red", "green"][i]);
  mkdirSync(path.join(wsDir, "collections", "city"), { recursive: true });
  for (const [i, name] of ["01_street.mp4", "02_lights.mp4", "03_bridge.mp4", "04_park.mp4"].entries()) makeClip(path.join(wsDir, "collections", "city", name), 8, ["white", "purple", "orange", "gray"][i]);
  writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 }, anchors: [{ line: 4, clip: "02_b.mp4" }] });
  let board: Textboard = { template: "Cinematic", roles: { hook: { size: 1.2 } }, cards: defaultCards({ title: "Text Test", artist: "Life Lyrics", lines: lyricsLines(LYRICS.join("\n")) }) };
  board = setCardOverrides(board, "line-3", { position: "upper", size: 1.4, hold: 1, effect: "soft-blur:subtle", font: "Playfair Display", weight: 700 });
  board = setCardOverrides(board, "title", { show: true, position: "centre", hold: 3, effect: "cinematic-fade" });
  writeTextboard(paths.root, board);
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

const make = (extra: Record<string, unknown> = {}) =>
  makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32", ...extra });

describe("the textboard in the planner", () => {
  it("per-card overrides are in the rendered props; the dry run plans exactly that; the manifest records it", async () => {
    const r = await make();
    const m = readManifest(r.platforms[0].variations[0].manifestFile);
    const line3 = m.props.lyrics.find((l) => l.text === "Through the night")!;
    expect(line3.card).toMatchObject({ id: "line-3", scale: 1.4, position: "upper", effect: { name: "soft-blur", intensity: "subtle" }, font: { family: "Playfair Display", weight: 700 } });
    expect(line3.card!.centerY).toBeLessThan(m.props.lyricArea!.centerY);
    expect(m.props.lyrics.filter((l) => l.text === "Hold on to me").every((l) => l.card?.scale === 1.2)).toBe(true); // the hook rule
    expect(m.props.lyrics.find((l) => l.text === "Verse two here")!.card).toEqual({ id: "line-4" }); // nothing changed on it
    expect(m.props.fonts.some((f) => f.family === "Playfair Display" && f.weight === 700)).toBe(true);
    // A title card on Reels (shown, centred, 3 s, cinematic fade) in the brand title font.
    expect(m.props.textCards?.filter((c) => !c.off)).toEqual([expect.objectContaining({ id: "title", text: "Text Test", font: "Cinzel", startFrame: 0, endFrame: 90, effect: { name: "cinematic-fade", intensity: "balanced" } })]);
    expect(m.props.fonts.some((f) => f.family === "Cinzel")).toBe(true);
    expect(m.textboard).toEqual({ file: "textboard.json", hash: expect.stringMatching(/^[0-9a-f]{12}$/), template: "Cinematic", changes: 3, cards: 9 });

    const dry = await make({ dryRun: true, align: async () => { throw new Error("a dry run never aligns"); } });
    expect(dry.platforms[0].plan!.videos[0].props).toEqual(m.props);
  }, 300_000);

  it("--engine hyperframes: a Reel with lyric effects and title cards has nothing HyperFrames cannot draw (step 2b); the manifest says what was asked", async () => {
    const logs: string[] = [];
    // (This test's renderer is a quick stand-in, so the video itself is made by it; the plan is what is checked.)
    const r = await make({ engine: "hyperframes", log: (m: string) => logs.push(m) });
    const m = readManifest(r.platforms[0].variations[0].manifestFile);
    expect(m.renderer).toMatchObject({ asked: "hyperframes", gaps: [] });
    expect(logs.some((l) => /HyperFrames cannot draw/.test(l))).toBe(false);
    expect(readManifest(r.platforms[0].variations[0].manifestFile).props.lyrics.length).toBeGreaterThan(0);
  }, 300_000);

  it("picture versions: the same text over other clips; an anchor whose clip is not there becomes a slot", async () => {
    const r = await make({ pictures: "song,city" });
    const vids = r.platforms[0].variations;
    expect(vids.map((v) => [v.name, v.picture?.label])).toEqual([["v1", "the song's clips"], ["v2", "city"]]);
    const [a, b] = vids.map((v) => readManifest(v.manifestFile));
    expect(b.props.lyrics).toEqual(a.props.lyrics); // the text layer is the same
    expect(b.props.textCards).toEqual(a.props.textCards);
    expect(new Set(b.props.shots.map((s) => s.src))).not.toEqual(new Set(a.props.shots.map((s) => s.src)));
    expect(b.clips.every((c) => c.file.includes("city"))).toBe(true);
    expect(a.anchors?.used.some((u) => u.line === 4 && u.used)).toBe(true);
    expect(b.anchors?.missing).toEqual([expect.stringMatching(/^slot: line 4 "Verse two here" needs a clip \(02_b\.mp4 is not among this video's clips/)]);
    expect(b.picture).toEqual({ index: 2, label: "city", songClips: false, collections: ["city"] });
    expect(r.platforms[0].plan).toBeUndefined();
    expect(readManifest(vids[1].manifestFile).textboard?.hash).toBe(a.textboard?.hash);
  }, 300_000);
});
