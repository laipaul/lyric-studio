// Step 6.2c-2b: a run's settings next to the recipe (Videos tab) and "Use these settings" (Generate
// pre-fill: an auto section as the exact times that run used, with its target length), the Post tab's
// approved list, Tasks "Clear finished" (never running / queued, stopped-resumable only when asked,
// files untouched, 24-hour window) and pnpm brand:set (brand.json perPlatform, identical song overrides
// tidied).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, makeRun, openWorkspace, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approvedVideos,
  clearFinished,
  compareRunToRecipe,
  createSong,
  generatePresetFromRun,
  listTasks,
  readRecipe,
  runSettings,
  setBrandPerPlatform,
  songPathsById,
  writeRecipe,
  type RunInfo,
  type VideoInfo,
} from "../src/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-run-settings-"));
let ws: Workspace;
let projectId: string;

// A manifest as pnpm make writes it (only what the Videos tab reads).
const manifest = (platform: string, extra: { settings?: Record<string, unknown>; section?: { mode: string; start_ms: number; end_ms: number }; props?: Record<string, unknown> } = {}) => ({
  platform: { name: platform, preset: { label: platform } },
  section: extra.section ?? { mode: "auto", start_ms: 34_213, end_ms: 66_000 },
  settings: { cut_rate: "1x", line_effect: "glide", hook_effect: "karaoke-highlight", collection: { name: "song clips + wedding" }, ...extra.settings },
  props: { style: { font: "Cormorant Garamond" }, hookFont: { font: "Kaushan Script" }, lyricEffects: { accent: "#E8A3B5" }, ...extra.props },
});
const writeRun = (folder: string, files: Record<string, unknown>) => {
  const dir = path.join(songPathsById(ws, projectId).exports, folder);
  for (const [file, json] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), JSON.stringify(json));
  }
};

beforeAll(async () => {
  ws = openWorkspace(path.join(root, "workspace"));
  const inDir = path.join(root, "in");
  mkdirSync(inDir, { recursive: true });
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", path.join(inDir, "Hold On.wav")]);
  writeFileSync(path.join(inDir, "lyrics.txt"), "Verse\n* Hold on\n");
  projectId = (await createSong(ws, { song: path.join(inDir, "Hold On.wav"), lyrics: path.join(inDir, "lyrics.txt") })).id;
  mkdirSync(path.join(ws.dir, "collections", "wedding"), { recursive: true });
  // A new run (collections and target length recorded) and an older one (neither recorded).
  writeRun("2026-10-20_1430", {
    "reels/v1.manifest.json": manifest("reels", { settings: { collections: ["wedding"], target_length: 32 } }),
    "reels/v2.manifest.json": manifest("reels", { settings: { collections: ["wedding"], target_length: 32 } }),
    "youtube/v1.manifest.json": manifest("youtube", { settings: { collections: ["wedding"], line_effect: "cinematic-fade" }, section: { mode: "full", start_ms: 0, end_ms: 180_000 }, props: { layout: "cover" } }),
  });
  writeRun("2026-09-01_0900", {
    "v1.manifest.json": manifest("standard", { section: { mode: "fixed", start_ms: 11_000, end_ms: 70_000 }, settings: { line_effect: "soft-blur:subtle" } }),
  });
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("a run's settings (Videos tab)", () => {
  it("reads every platform of a run from its manifests, also older runs", () => {
    const run = runSettings(ws, projectId, "2026-10-20_1430");
    expect(run.map((r) => [r.platform, r.videos])).toEqual([
      ["reels", 2],
      ["youtube", 1],
    ]);
    expect(run[0]).toMatchObject({ verseEffect: "glide", collections: ["wedding"], targetLength: 32, section: { mode: "auto", startMs: 34_213, endMs: 66_000 } });
    expect(run[1]).toMatchObject({ verseEffect: "cinematic-fade", youtubeLayout: "cover" });
    // Older manifests: the collections come from the collection name; no target length.
    const old = runSettings(ws, projectId, "2026-09-01_0900");
    expect(old[0]).toMatchObject({ platform: "standard", collections: ["wedding"], targetLength: null, verseEffect: "soft-blur:subtle" });
    expect(() => runSettings(ws, projectId, "../../etc")).toThrow(/No run/);
  });

  it("shows each value next to the recipe now and marks what differs", () => {
    const file = songPathsById(ws, projectId).recipe!;
    writeRecipe(file, { ...readRecipe(file), verseEffect: "floating" });
    const [reels, youtube] = compareRunToRecipe(ws, projectId, "2026-10-20_1430");
    const row = (rows: typeof reels.rows, key: string) => rows.find((r) => r.key === key)!;
    expect(row(reels.rows, "verseEffect")).toMatchObject({ then: "glide", now: "floating", differs: true });
    expect(row(reels.rows, "hookEffect").differs).toBe(false);
    expect(row(reels.rows, "section")).toMatchObject({ then: "auto 0:34–1:06 (32 s)", differs: false });
    expect(youtube.rows.some((r) => r.key === "section")).toBe(false); // YouTube is always the whole song
    expect(row(youtube.rows, "youtubeLayout").then).toBe("cover");
    writeRecipe(file, { ...readRecipe(file), verseEffect: undefined });
  });
});

describe("Use these settings (Generate pre-fill)", () => {
  it("an auto run comes back as the exact times it used, with its target length for the switch to auto", () => {
    const p = generatePresetFromRun(ws, projectId, "2026-10-20_1430");
    expect(p).toMatchObject({
      platforms: ["reels", "youtube"],
      variations: { reels: 2, youtube: 1 },
      section: "0:34.213-1:06.000",
      sectionLabel: "0:34–1:06 (from that run)",
      sectionWasAuto: true,
      targetLength: 32,
      collections: ["wedding"],
      layout: "cover",
      hookEffect: "karaoke-highlight",
    });
    expect(p.lineEffect).toBeNull(); // glide on Reels, cinematic-fade on YouTube: left to the recipe per platform
  });

  it("a fixed section comes back exactly", () => {
    const p = generatePresetFromRun(ws, projectId, "2026-09-01_0900");
    expect(p).toMatchObject({ section: "0:11.000-1:10.000", sectionWasAuto: false, lineEffect: "soft-blur:subtle", targetLength: null });
  });
});

describe("Post tab", () => {
  it("lists the approved videos only, per platform, newest run first", () => {
    const video = (run: string, platform: string, name: string, status: VideoInfo["mark"]["status"]) => ({ id: `${run}/${platform}/${name}`, run, platform, label: platform, name, mark: { favourite: false, status } }) as VideoInfo;
    const run = (folder: string, videos: VideoInfo[]): RunInfo =>
      ({ folder, time: null, command: null, resumeCommand: null, platforms: [...new Set(videos.map((v) => v.platform))].map((p) => ({ name: p, label: p, videos: videos.filter((v) => v.platform === p), strongest: null, missing: [], interrupted: false, failed: [] })) }) as RunInfo;
    const runs = [
      run("old", [video("old", "reels", "v1", "approved"), video("old", "reels", "v2", "discarded")]),
      run("new", [video("new", "reels", "v1", "generated"), video("new", "reels", "v2", "approved"), video("new", "youtube", "v1", "approved")]),
    ];
    expect(approvedVideos(runs).map((g) => [g.platform, g.videos.map((v) => v.id)])).toEqual([
      ["reels", ["new/reels/v2", "old/reels/v1"]],
      ["youtube", ["new/youtube/v1"]],
    ]);
    expect(approvedVideos([run("x", [video("x", "reels", "v1", "discarded")])])).toEqual([]);
  });
});

describe("Tasks: Clear finished", () => {
  it("clears done, failed and never-started runs; stopped ones that can resume only when asked; never active ones", () => {
    const exportDir = path.join(songPathsById(ws, projectId).exports, "2026-10-20_1430");
    const add = (status: "queued" | "running" | "done" | "failed" | "stopped" | "interrupted", extra: Partial<typeof makeRun.$inferInsert> = {}) =>
      ws.db
        .insert(makeRun)
        .values({ project_id: projectId, status, label: status, options_json: {}, pid: status === "running" ? process.pid : null, ...extra })
        .returning()
        .get().id;
    const ids = {
      queued: add("queued"),
      running: add("running"),
      done: add("done", { export_dir: exportDir }),
      failed: add("failed"),
      cancelled: add("stopped", { message: "cancelled before it started" }),
      stopped: add("stopped", { export_dir: exportDir }),
    };
    const shown = () => listTasks(ws).runs.map((r) => r.id);
    expect(shown()).toEqual(expect.arrayContaining(Object.values(ids)));

    expect(clearFinished(ws)).toEqual({ cleared: 3, resumable: 1 });
    expect(shown().sort()).toEqual([ids.queued, ids.running, ids.stopped].sort());
    expect(existsSync(path.join(exportDir, "reels", "v1.manifest.json"))).toBe(true); // only the list entry goes

    expect(clearFinished(ws, { includeStopped: true })).toEqual({ cleared: 1, resumable: 0 });
    expect(shown().sort()).toEqual([ids.queued, ids.running].sort());
    expect(ws.db.select().from(makeRun).where(eq(makeRun.id, ids.stopped)).get()?.status).toBe("stopped"); // still resumable from its folder

    // Older than 24 hours: hidden by itself, and not asked about.
    const old = add("interrupted", { export_dir: exportDir, created_at: new Date(Date.now() - 25 * 3600_000) });
    expect(shown()).not.toContain(old);
    expect(clearFinished(ws).resumable).toBe(0);
    ws.db.delete(makeRun).run();
  });
});

describe("pnpm brand:set", () => {
  it("sets a per-platform brand value and removes the songs' identical overrides", () => {
    const file = songPathsById(ws, projectId).recipe!;
    writeRecipe(file, { ...readRecipe(file), perPlatform: { youtube: { verseEffect: "cinematic-fade" }, reels: { verseEffect: "floating" } } });
    const result = setBrandPerPlatform(ws, { artist: "Life Lyrics", platform: "youtube", field: "verseEffect", value: "cinematic-fade" });
    expect(result.tidied).toEqual(["Hold On"]);
    expect(JSON.parse(readFileSync(result.file, "utf8")).perPlatform.youtube).toEqual({ verseEffect: "cinematic-fade" });
    expect(readRecipe(file).perPlatform).toEqual({ reels: { verseEffect: "floating" } }); // the song's other values stay

    // A different song value stays (and is listed); a bad value is refused and brand.json is put back.
    expect(setBrandPerPlatform(ws, { artist: "Life Lyrics", platform: "reels", field: "verseEffect", value: "glide" }).kept).toEqual(["Hold On"]);
    const before = readFileSync(result.file, "utf8");
    expect(() => setBrandPerPlatform(ws, { artist: "Life Lyrics", platform: "youtube", field: "verseEffect", value: "wobble" })).toThrow();
    expect(readFileSync(result.file, "utf8")).toBe(before);
    expect(() => setBrandPerPlatform(ws, { artist: "Life Lyrics", platform: "myspace", field: "verseEffect", value: "glide" })).toThrow(/Unknown platform/);
    expect(() => setBrandPerPlatform(ws, { artist: "Life Lyrics", platform: "youtube", field: "collections", value: "x" })).toThrow(/cannot differ per platform/);
    // "-" (null) removes the brand value again.
    setBrandPerPlatform(ws, { artist: "Life Lyrics", platform: "reels", field: "verseEffect", value: null });
    expect(JSON.parse(readFileSync(result.file, "utf8")).perPlatform.reels).toBeUndefined();
  });
});
