// "Make another": every take varies something (which part of each clip plays, the cut rate, cut / dissolve, style),
// deterministically from its number; a take that would make the picture of one the song already has is refused.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, makeVideos, planTake, planVariations, setVideoMark, songPathsById, songRuns, type RenderOptions } from "../src/node";
import { duplicateProblem, existingTakes, takeProblem } from "../src/node/take-check";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-take-"));
const wsDir = path.join(root, "workspace");
const sample = path.join(root, "s.mp4");
const still = path.join(root, "s.jpg");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;

// A song with its clips (durations in seconds), made once (v1 of the platform) with a stand-in renderer.
async function song(name: string, clips: number[], platform: string): Promise<string> {
  const file = path.join(root, `${name}.wav`);
  makeSong(file, 18 + clips.length + (platform === "youtube" ? 5 : 0));
  const id = (await findOrCreateSongProject(ws, file)).project.id;
  const paths = songPathsById(ws, id);
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  if (platform === "youtube") ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1920x1080", "-frames:v", "1", path.join(paths.root, "cover.jpg"));
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, s] of clips.entries()) makeClip(path.join(paths.clips!, `0${i + 1}_clip.mp4`), s, ["blue", "yellow", "red", "green"][i % 4], platform === "youtube" ? "384x216" : "216x384");
  await makeVideos({
    workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: platform, align: fakeAlign, frameCheck: false, platform: "win32",
    renderer: async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile),
    thumbnailRenderer: async (o) => (copyFileSync(still, o.outFile), o.outFile),
  });
  return id;
}
const dry = async (id: string, platform: string, takes: number[]) => {
  const paths = songPathsById(ws, id);
  const r = await makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: platform, takes, dryRun: true, frameCheck: false, log: () => {} });
  expect(r.platforms[0].error).toBeNull();
  return r.platforms[0].plan!.videos;
};

let rich: string; // four 8 s clips: room to play other parts
let cover: string; // YouTube, cover layout: no clips on screen
let plain: string; // one 2 s clip: nothing can vary but the style
beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", still);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  rich = await song("Rich", [8, 8, 8, 8], "reels");
  plain = await song("Plain", [1.5], "reels");
  cover = await song("Cover", [4], "youtube");
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("take plans", () => {
  it("take 1 is exactly v1; later takes play other parts of the clips (moment = take - 1)", () => {
    expect(planTake(1)).toEqual(planVariations(1));
    expect(planTake(1, { rate: "1x" })).toEqual(planVariations(1, { rate: "1x" }));
    expect(planTake(3)[0]).toMatchObject({ name: "v3", seed: 3, moment: 2 });
    expect(planVariations(3)[2].moment).toBeUndefined(); // a run of 3 videos is as before
  });
});

describe("takes of a song with room to vary", () => {
  it("takes 2 and 3 differ from take 1 and from each other, and the same take always gives the same picture", async () => {
    const [v1, v2, v3] = await dry(rich, "reels", [1, 2, 3]);
    const picture = (v: typeof v1) => JSON.stringify(v.props);
    expect(new Set([picture(v1), picture(v2), picture(v3)]).size).toBe(3);
    // The cuts are the song's (take 1 and 2: same cut rate); what moves is which part of each clip plays.
    expect(v2.props.shots.map((s) => s.start)).toEqual(v1.props.shots.map((s) => s.start));
    expect(v2.props.shots.map((s) => s.clipStartFrame)).not.toEqual(v1.props.shots.map((s) => s.clipStartFrame));
    expect(v2.props.durationInFrames).toBe(v1.props.durationInFrames); // the musical ending stays
    expect(v2.props.audio).toEqual(v1.props.audio);
    expect(v2.props.lyrics).toEqual(v1.props.lyrics); // lyric timing untouched
    const again = await dry(rich, "reels", [2]);
    expect(picture(again[0])).toBe(picture(v2));
    for (const s of v3.props.shots) expect(s.clipStartFrame).toBeGreaterThanOrEqual(0);
  }, 300_000);

  it("is not refused", async () => {
    await expect(takeProblem(ws, rich, "reels", 4)).resolves.toBeNull();
    expect(existingTakes(ws, rich, "reels")).toEqual([1, 2, 3]) // the first run made three;
  }, 300_000);
});

describe("a take that would be identical", () => {
  it("is refused, naming the take it repeats and a creative change", async () => {
    const [v1, v3] = await dry(plain, "reels", [1, 3]);
    expect(JSON.stringify(v3.props)).toBe(JSON.stringify(v1.props)); // one short clip: nothing to vary in take 3
    const problem = await takeProblem(ws, plain, "reels", 3);
    // Named by the song-wide version names shown on screen: the take would be the next video (v4), the repeat is v1.
    expect(problem).toMatch(/^Reels v4 would be identical to Reels v1 \(made \d{1,2} \w{3} \d\d:\d\d\): change a setting in Shape first \(e\.g\. .*another clip/);
  }, 300_000);

  it("a take that was made already (same variation, same settings) is a repeat of that video, not a new picture", async () => {
    await expect(takeProblem(ws, plain, "reels", 2)).resolves.toMatch(/^Reels v4 would be identical to Reels v2 /);
  }, 300_000);
});

describe("YouTube cover layout (no clips on screen)", () => {
  it("takes 2-6 differ from take 1: style and the cover's camera move (in / out / hold) change", async () => {
    const plans = await dry(cover, "youtube", [1, 2, 3, 4, 5, 6]);
    expect(plans.every((v) => v.props.layout === "cover")).toBe(true);
    const look = (v: (typeof plans)[number]) => JSON.stringify({ ...v.props, cover: { ...v.props.cover, drift: undefined } });
    expect(new Set(plans.map(look)).size).toBe(6);
    expect(plans[1].props.cover!.zoomFrom).toBeGreaterThan(plans[1].props.cover!.zoomTo); // take 2 pulls out
    for (const n of [2, 3, 4]) await expect(takeProblem(ws, cover, "youtube", n)).resolves.toBeNull();
  }, 300_000);

  it("a take that repeats an earlier one is refused", async () => {
    expect(existingTakes(ws, cover, "youtube")).toEqual([1]);
    await expect(takeProblem(ws, cover, "youtube", 7)).resolves.toMatch(
      /^YouTube v2 would be identical to YouTube v1 \(made \d{1,2} \w{3} \d\d:\d\d\): change a setting in Shape first \(e\.g\. choose another look \(Shape → Look bar → Change\) or another cover picture\)\.$/,
    );
  }, 300_000);
});

describe("a normal Make run for a platform that already has videos", () => {
  it("is held back when its video would be identical to one the song has (v1 again with the same settings)", async () => {
    const problem = await duplicateProblem(ws, plain, { platforms: ["reels"], counts: { reels: 1 } });
    expect(problem).toMatch(/^Reels v4 would be identical to Reels v1 \(made \d{1,2} \w{3} \d\d:\d\d\): change a setting in Shape first, or press Make anyway\.$/);
  }, 300_000);

  it("Make anyway (force), a take, a Compare looks run and a platform with no videos are not checked", async () => {
    await expect(duplicateProblem(ws, plain, { platforms: ["reels"], counts: { reels: 1 }, force: true })).resolves.toBeNull();
    await expect(duplicateProblem(ws, plain, { platforms: ["reels"], take: 4 })).resolves.toBeNull();
    await expect(duplicateProblem(ws, plain, { platforms: ["reels"], compare: true, themes: ["Night Drive"] })).resolves.toBeNull();
    await expect(duplicateProblem(ws, plain, { platforms: ["tiktok"], counts: { tiktok: 1 } })).resolves.toBeNull();
  }, 300_000);

  it("a change that makes another picture lets it through; a discarded video is not a duplicate", async () => {
    // The song's v1..v3 were made with the default effects: another verse effect is another video.
    await expect(duplicateProblem(ws, plain, { platforms: ["reels"], counts: { reels: 1 }, lineEffect: "typewriter" })).resolves.toBeNull();
    for (const v of songRuns(ws, plain).flatMap((r) => r.platforms.flatMap((p) => p.videos))) setVideoMark(ws, plain, v.id, { status: "discarded" });
    await expect(duplicateProblem(ws, plain, { platforms: ["reels"], counts: { reels: 1 } })).resolves.toBeNull();
  }, 300_000);
});
