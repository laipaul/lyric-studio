// Releases: a group of songs (workspace\releases\<name>.json), the grid (songs x platforms in the Library's
// colours), and Make all (only what is missing, never what is waiting or approved; songs that cannot be
// made are skipped with the reason; an estimate from past renders).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, makeRun, openWorkspace, videoMark, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, readRecipe, songPathsById, writeRecipe } from "../src/node";
import {
  createRelease,
  DEFAULT_UNIT_S,
  getRelease,
  listReleases,
  makeAll,
  makeAllPlan,
  releaseCandidates,
  releaseView,
  removedReleases,
  removeRelease,
  renderSecondsPerUnit,
  restoreRelease,
  updateRelease,
} from "../src/node/releases";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-releases-"));
const inDir = path.join(root, "in");
let ws: Workspace;
const ids: Record<string, string> = {};
const video = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.mp4`), "x");
  writeFileSync(path.join(dir, `${name}.manifest.json`), JSON.stringify({ manifest_version: 1, created_at: "2026-10-29T09:00:00Z", command: "pnpm make", variation: { order: "story", seed: 1, style: "Simple", cinematic_bars: false }, props: {} }));
  writeFileSync(path.join(dir, `${name}.qa.txt`), "x\nSummary: PASS\n");
};

beforeAll(async () => {
  mkdirSync(inDir, { recursive: true });
  ws = openWorkspace(path.join(root, "workspace"));
  writeFileSync(path.join(inDir, "lyrics.txt"), "Hold on to me\n");
  for (const [title, hz] of [["Heart", 330], ["Love", 440], ["Roads", 550]] as const) {
    const f = path.join(inDir, `${title}.wav`);
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=3`, f]);
    ids[title] = (await createSong(ws, { song: f, lyrics: path.join(inDir, "lyrics.txt"), ep: title === "Roads" ? undefined : "In The Mood" })).id;
  }
  // Heart: Reels + YouTube only, clips from "wedding"; Reels approved, YouTube waiting for review.
  const heart = songPathsById(ws, ids.Heart);
  writeRecipe(heart.recipe!, { ...readRecipe(heart.recipe!), platforms: ["reels", "youtube"], collections: ["wedding"] });
  video(path.join(heart.exports, "2026-10-29_1000", "reels"), "v1");
  video(path.join(heart.exports, "2026-10-29_1000", "youtube"), "v1");
  ws.db.insert(videoMark).values({ project_id: ids.Heart, video: path.relative(ws.dir, path.join(heart.exports, "2026-10-29_1000", "reels", "v1.manifest.json")).split(path.sep).join("/"), status: "approved" }).run();
  // Love: every platform, clips from "wedding"; nothing made.  Roads: no clips at all (blocked).
  const love = songPathsById(ws, ids.Love);
  writeRecipe(love.recipe!, { ...readRecipe(love.recipe!), collections: ["wedding"] });
}, 60_000);
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("releases", () => {
  it("candidates carry their EP (pre-ticked together); a release is a small file of song ids", () => {
    const c = releaseCandidates(ws);
    expect(c.filter((s) => s.ep === "In The Mood").map((s) => s.title).sort()).toEqual(["Heart", "Love"]);
    const r = createRelease(ws, "In The Mood: EP", [ids.Heart, ids.Love, ids.Roads, "not-a-song"], new Date("2026-10-30T10:00:00Z"));
    expect(r).toEqual({ name: "In The Mood_ EP", songs: [ids.Heart, ids.Love, ids.Roads], createdAt: "2026-10-30T10:00:00.000Z" });
    expect(existsSync(path.join(ws.dir, "releases", "In The Mood_ EP.json"))).toBe(true);
    expect(() => createRelease(ws, "in the mood_ ep", [])).toThrow(/already exists/);
    expect(() => createRelease(ws, " ", [])).toThrow(/Give the release a name/);
  });

  it("the grid: songs x the platforms they use, in the Library's colours", () => {
    const v = releaseView(ws, "In The Mood_ EP");
    expect(v.platforms.map((p) => p.name)).toEqual(["reels", "tiktok", "shorts", "youtube", "canvas"]);
    const row = (t: string) => Object.fromEntries(v.rows.find((r) => r.title === t)!.cells.map((c) => [c.platform, c.state]));
    expect(row("Heart")).toEqual({ reels: "ready", tiktok: "unused", shorts: "unused", youtube: "review", canvas: "unused" });
    expect(row("Love")).toEqual({ reels: "none", tiktok: "none", shorts: "none", youtube: "none", canvas: "none" });
    expect([v.ready, v.total]).toEqual([1, 12]); // Heart 2 + Love 5 + Roads 5
  });

  it("Make all: only what is missing; a blocked song is skipped with the reason; an estimate", async () => {
    const plan = await makeAllPlan(ws, "In The Mood_ EP");
    expect(plan.songs.map((s) => [s.title, s.platforms.map((p) => p.name)])).toEqual([["Love", ["reels", "tiktok", "shorts", "youtube", "canvas"]]]); // Heart: approved + waiting -> nothing
    expect(plan.skipped.map((s) => s.title)).toEqual(["Roads"]);
    expect(plan.skipped[0].why).toMatch(/Add your clips/);
    expect(plan.videos).toBe(5);
    expect(plan).toMatchObject({ estimateS: 7 * DEFAULT_UNIT_S, estimateFrom: "default" }); // YouTube counts 3
    const { queued } = await makeAll(ws, "In The Mood_ EP");
    expect(queued.map((q) => q.title)).toEqual(["Love"]);
    const run = ws.db.select().from(makeRun).all().at(-1)!;
    expect(run.options_json).toMatchObject({ platforms: "reels,tiktok,shorts,youtube,canvas", variations: 1 });
  });

  it("the estimate learns from past renders on this PC", () => {
    const t0 = new Date("2026-10-29T10:00:00Z");
    const runRow = (minutes: number, states: { platform: string; name: string; status: string; progress: number }[]) =>
      ws.db.insert(makeRun).values({ project_id: ids.Heart, status: "done", options_json: {}, label: "x", started_at: t0, finished_at: new Date(t0.getTime() + minutes * 60_000), states_json: states }).run();
    runRow(10, [{ platform: "reels", name: "v1", status: "done", progress: 1 }, { platform: "youtube", name: "v1", status: "done", progress: 1 }]); // 4 units in 10 min
    runRow(5, [{ platform: "reels", name: "v1", status: "done", progress: 1 }, { platform: "shorts", name: "v1", status: "done", progress: 1 }]); // 2 units in 5 min
    expect(renderSecondsPerUnit(ws)).toEqual({ seconds: 150, from: "history" }); // 900 s / 6 units
  });

  it("rename, change the songs, delete (moved aside) and restore; the songs are never touched", () => {
    expect(updateRelease(ws, "In The Mood_ EP", { name: "In The Mood", songs: [ids.Love, ids.Heart] })).toMatchObject({ name: "In The Mood", songs: [ids.Love, ids.Heart] });
    expect(listReleases(ws).map((r) => r.name)).toEqual(["In The Mood"]);
    expect(readdirSync(path.join(ws.dir, "releases", "_removed")).some((f) => f.startsWith("In The Mood_ EP (renamed "))).toBe(true);
    expect(updateRelease(ws, "In The Mood", { name: "in the mood" }).name).toBe("in the mood"); // case only
    expect(removeRelease(ws, "in the mood")).toMatch(/^releases\/_removed\/in the mood \(removed .+\)\.json$/);
    expect(listReleases(ws)).toEqual([]);
    expect(() => getRelease(ws, "in the mood")).toThrow(/No release/);
    const [removed] = removedReleases(ws);
    expect(restoreRelease(ws, removed.file)).toBe("in the mood");
    expect(getRelease(ws, "in the mood").songs).toEqual([ids.Love, ids.Heart]);
    expect(existsSync(songPathsById(ws, ids.Heart).recipe!)).toBe(true);
  });
});
