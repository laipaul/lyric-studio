// One counts rule everywhere (11 Nov 2026): a platform's videos = the song's own count for it (song.json
// "variations"), else 1 in the studio (Make's chips and totals, One of each, Shape's video list) and the platform
// preset's number only for "pnpm make" without a count. The studio sends its counts with every run.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkRunRequest, findOrCreateSongProject, generateOptions, makeVideos, readRecipe, runRecipe, songPathsById, savedPlanCounts, storyboardChoices, studioCounts, STUDIO_PLATFORMS, videoCount, writeRecipe, type RenderOptions } from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

describe("the counts rule", () => {
  it("the song's count, else the fallback (1 in the studio, the preset for pnpm make)", () => {
    expect(videoCount({ reels: 3 }, "reels", 1)).toBe(3);
    expect(videoCount({ reels: 3 }, "youtube", 1)).toBe(1);
    expect(videoCount({ reels: 3 }, "tiktok", 3)).toBe(3); // pnpm make: the preset's number
    expect(videoCount({ "*": 2 }, "shorts", 1)).toBe(2);
    expect(videoCount(undefined, "reels", 1)).toBe(1);
  });
  it("the studio's platforms and counts: the song's own, else every platform once", () => {
    expect(studioCounts({ platforms: [], variations: {} })).toEqual(Object.fromEntries(STUDIO_PLATFORMS.map((p) => [p, 1])));
    expect(studioCounts({ platforms: ["reels", "youtube"], variations: { reels: 3 } })).toEqual({ reels: 3, youtube: 1 });
    expect(studioCounts({ platforms: ["reels", "canvas"], variations: { canvas: 2 } }, ["reels"])).toEqual({ reels: 1 });
  });
  it("a run's counts per platform become its variations; a comparison makes one of each", () => {
    expect(runRecipe({ variationsBy: { reels: 2, youtube: 1 } }).variations).toEqual({ reels: 2, youtube: 1 });
    expect(runRecipe({ variations: 3 }).variations).toEqual({ "*": 3 });
    expect(checkRunRequest({ platforms: ["reels"], counts: { reels: 0 } }, ["reels"])).toEqual(["Videos per platform must be 1-24."]);
    expect(checkRunRequest({ platforms: ["reels"], counts: { tiktok: 1 } }, ["reels"])).toEqual(["Videos per platform must be 1-24."]);
    expect(checkRunRequest({ platforms: ["reels"], compare: true, themes: ["Night Drive"] }, ["reels"])).toEqual([]); // one other theme is a comparison
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-counts-"));
const wsDir = path.join(root, "workspace");
const sample = path.join(root, "s.mp4");
const still = path.join(root, "s.jpg");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id: string;
beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", still);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  const song = path.join(root, "Count Test.wav");
  makeSong(song, 20);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, c] of ["blue", "yellow", "red"].entries()) makeClip(path.join(paths.clips!, `0${i + 1}_${c}.mp4`), 8, c);
  writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), section: "0:00-0:12" });
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

const run = async (extra: Record<string, unknown>) => {
  const made: string[] = [];
  const paths = songPathsById(ws, id);
  await makeVideos({
    workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, align: fakeAlign, frameCheck: false, platform: "win32",
    renderer: async (o: RenderOptions) => (made.push(`${path.basename(path.dirname(o.outFile))}/${path.basename(o.outFile, ".mp4")}`), copyFileSync(sample, o.outFile), o.outFile),
    thumbnailRenderer: async (o) => (copyFileSync(still, o.outFile), o.outFile),
    ...extra,
  });
  return made.sort();
};

describe("the same counts in Make, Shape's list and pnpm make", () => {
  it("nothing set: the studio makes and lists 1 per platform; pnpm make keeps the preset's number", async () => {
    // The studio: Make sends the chips' counts (studioCounts), Shape lists v1 only.
    const counts = studioCounts(readRecipe(songPathsById(ws, id).recipe!), ["reels"]);
    expect(counts).toEqual({ reels: 1 });
    const o = generateOptions(ws, id, { platforms: ["reels"], counts });
    expect(o.variationsBy).toEqual({ reels: 1 });
    expect(await run({ platforms: "reels", variationsBy: o.variationsBy })).toEqual(["reels/v1"]);
    expect(storyboardChoices(ws, id).platforms.find((p) => p.name === "reels")?.videos).toEqual(["v1"]);
    // pnpm make with no count anywhere: the Reels preset's 3.
    expect(await run({ platforms: "reels" })).toEqual(["reels/v1", "reels/v2", "reels/v3"]);
  }, 600_000);

  it("the song's counts: Make, Shape's list and pnpm make all follow them", async () => {
    const recipe = songPathsById(ws, id).recipe!;
    writeRecipe(recipe, { ...readRecipe(recipe), platforms: ["reels", "youtube"], variations: { reels: 2 } });
    const counts = studioCounts({ platforms: ["reels", "youtube"], variations: { reels: 2 } });
    expect(counts).toEqual({ reels: 2, youtube: 1 });
    const choices = storyboardChoices(ws, id).platforms.map((p) => [p.name, p.videos.length]);
    expect(choices).toEqual([["reels", 2], ["youtube", 1]]);
    expect(await run({ platforms: "reels", variationsBy: { reels: counts.reels } })).toEqual(["reels/v1", "reels/v2"]);
    expect(await run({ platforms: "reels" })).toEqual(["reels/v1", "reels/v2"]); // pnpm make: the song's count wins over the preset
  }, 600_000);

  it("Shape lists a platform switched off in Make while it has a saved shot plan (22 Nov 2026)", () => {
    const recipe = songPathsById(ws, id).recipe!;
    writeRecipe(recipe, { ...readRecipe(recipe), platforms: ["youtube"], variations: {} }); // Make: YouTube only
    const plans = path.join(songPathsById(ws, id).root, "storyboards");
    rmSync(plans, { recursive: true, force: true }); // the runs above saved their own plans: start from these files only
    mkdirSync(plans, { recursive: true });
    for (const f of ["reels-1.json", "reels-2.json", "reels-3.previous.json", "reels-1~theme-night-drive.json", "canvas-1.json", "tiktok-notes.txt"]) writeFileSync(path.join(plans, f), "{}");
    expect([...savedPlanCounts(songPathsById(ws, id).root)].sort()).toEqual([["canvas", 1], ["reels", 2]]);
    const choices = storyboardChoices(ws, id).platforms;
    expect(choices.map((p) => [p.name, p.videos, !!p.notInMake])).toEqual([["youtube", ["v1"], false], ["reels", ["v1", "v2"], true]]); // Make's first; never the Canvas
    writeRecipe(recipe, { ...readRecipe(recipe), platforms: ["reels", "youtube"] }); // Reels back on in Make: Make's count, no mark
    expect(storyboardChoices(ws, id).platforms.map((p) => [p.name, p.videos.length, !!p.notInMake])).toEqual([["reels", 1], ["youtube", 1]].map(([n, c]) => [n, c, false]));
  });
});
