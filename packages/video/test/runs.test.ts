// Step 6.2b: the studio's run queue (Generate / Resume / Stop), the worker's execution with live
// progress, the Tasks list, and the shared "pnpm make" argument parsing.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, makeRun, openWorkspace, project, renderJob, variation, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkRunRequest,
  claimNextRun,
  commandArgs,
  createSong,
  enqueueRun,
  executeRun,
  generateOptions,
  listTasks,
  makeCommand,
  markInterruptedRuns,
  parseMakeArgs,
  requestStop,
  resumeOptions,
  runCurrent,
  runProgress,
  runSummary,
  type MakeOptions,
  type MakeResult,
  songPathsById,
} from "../src/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-runs-"));
let ws: Workspace;
let projectId: string;
const PLATFORMS = ["standard", "reels", "tiktok", "shorts", "youtube", "canvas"];

beforeAll(async () => {
  ws = openWorkspace(path.join(root, "workspace"));
  const inDir = path.join(root, "in");
  mkdirSync(inDir, { recursive: true });
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", path.join(inDir, "Hold On.wav")]);
  writeFileSync(path.join(inDir, "lyrics.txt"), "Verse\n* Hold on\n");
  projectId = (await createSong(ws, { song: path.join(inDir, "Hold On.wav"), lyrics: path.join(inDir, "lyrics.txt") })).id;
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("pnpm make arguments", () => {
  it("parses a command line (also a stored one with quoted paths) into the same options", () => {
    const args = commandArgs('pnpm make "D:\\videomaker\\workspace\\test\\song.wav" "D:\\videomaker\\workspace\\test\\lyrics.txt" --collection wedding --platforms reels,canvas --line-effect soft-blur:subtle');
    expect(args).toEqual(["D:\\videomaker\\workspace\\test\\song.wav", "D:\\videomaker\\workspace\\test\\lyrics.txt", "--collection", "wedding", "--platforms", "reels,canvas", "--line-effect", "soft-blur:subtle"]);
    const { options, noOpen } = parseMakeArgs(["song.wav", "my lyrics.txt", "--collection", "wedding", "--variations", "3", "--no-open"], "/work");
    expect(options).toMatchObject({ song: path.resolve("/work", "song.wav"), lyrics: path.resolve("/work", "my lyrics.txt"), collection: "wedding", variations: 3, leadMs: 250 });
    expect(options.rate).toBeUndefined(); // no --rate: automatic pacing
    expect(options.command).toBe('pnpm make song.wav "my lyrics.txt" --collection wedding --variations 3 --no-open');
    expect(noOpen).toBe(true);
    expect(makeCommand(["a b.wav", "x"])).toBe('pnpm make "a b.wav" x');
    expect(() => parseMakeArgs(["song.wav"], "/")).toThrow(/Usage: pnpm make/);
    expect(() => parseMakeArgs(["a", "b", "--rate", "3x"], "/")).toThrow(/--rate must be/);
  });
});

describe("Generate: request -> run options", () => {
  it("checks the request and names every problem", () => {
    expect(checkRunRequest({ platforms: [] }, PLATFORMS)).toEqual(["Choose at least one platform."]);
    expect(checkRunRequest({ platforms: ["reels", "myspace"], variations: 40, lineEffect: "wobble", section: "soon", layout: "grid" as never }, PLATFORMS)).toEqual([
      'Unknown platform "myspace".',
      "Videos per platform must be 1-24.",
      'Verse effect: unknown effect "wobble". Known: glide, cinematic-fade, soft-blur, dreamy-glow, word-reveal, karaoke-highlight, floating, typewriter, spread, typewriter-erase, typewriter-words, clarify, ascend, ink, word-pop, highlight-sweep, mask-reveal, tilt-3d, glitch, wave, echo-stack, slice, kinetic-stack (optionally with :subtle, :balanced or :expressive)',
      'Section must be "auto", "full" or like 0:11-1:10.',
      "YouTube layout must be cover, stills or clips.",
    ]);
    expect(checkRunRequest({ platforms: ["reels", "youtube"], section: "0:11-1:10", lineEffect: "glide:subtle" }, PLATFORMS)).toEqual([]);
  });

  it("uses the project's own song and lyrics; only the choices made are passed", () => {
    const o = generateOptions(ws, projectId, { platforms: ["reels", "canvas"], collection: "wedding", lineEffect: "floating:subtle", title: " Hold On ", section: "auto", layout: "cover" });
    expect(o.song).toBe(songPathsById(ws, projectId).audio);
    expect(o.lyrics).toBe(songPathsById(ws, projectId).lyricsTxt);
    expect(o).toMatchObject({ platforms: "reels,canvas", collection: "wedding", lineEffect: "floating:subtle", title: "Hold On", layout: "cover", command: "Lyric Studio: Generate" });
    expect(o.section).toBe("auto"); // sent only when changed from the recipe, then kept
    expect(o).not.toHaveProperty("collection_path");
  });
});

describe("the queue", () => {
  it("one run at a time, oldest first; a run whose worker is gone becomes interrupted", () => {
    const a = enqueueRun(ws, projectId, generateOptions(ws, projectId, { platforms: ["reels"] }));
    const b = enqueueRun(ws, projectId, generateOptions(ws, projectId, { platforms: ["tiktok", "shorts"] }));
    expect([a.label, b.label]).toEqual(["Reels", "TikTok, Shorts"]);
    const first = claimNextRun(ws, 111, (pid) => pid === 111)!;
    expect(first).toMatchObject({ id: a.id, status: "running", pid: 111 });
    expect(claimNextRun(ws, 222, (pid) => pid === 111)).toBeNull(); // a running one blocks the next
    // The worker (111) is gone: its run is interrupted, the next one starts.
    const second = claimNextRun(ws, 222, (pid) => pid === 222)!;
    expect(second.id).toBe(b.id);
    expect(ws.db.select().from(makeRun).where(eq(makeRun.id, a.id)).get()).toMatchObject({ status: "interrupted", message: expect.stringContaining("closed") });
    expect(markInterruptedRuns(ws, () => true)).toBe(0);
    ws.db.update(makeRun).set({ status: "done" }).where(eq(makeRun.id, b.id)).run();
  });

  it("Stop: a queued run is cancelled at once; a running one is asked to stop after its video", () => {
    const q = enqueueRun(ws, projectId, generateOptions(ws, projectId, { platforms: ["reels"] }));
    expect(requestStop(ws, q.id)).toMatchObject({ status: "stopped", message: "cancelled before it started" });
    const r = enqueueRun(ws, projectId, generateOptions(ws, projectId, { platforms: ["reels"] }));
    claimNextRun(ws, process.pid);
    expect(requestStop(ws, r.id)).toMatchObject({ status: "running", stop_requested: true });
    ws.db.update(makeRun).set({ status: "done" }).where(eq(makeRun.id, r.id)).run();
  });
});

describe("the worker makes a run", () => {
  const fakeResult = (over: Partial<MakeResult> = {}): MakeResult => ({
    projectTitle: "Hold On",
    exportDir: path.join(songPathsById(ws, projectId).exports, "2026-10-27_1000"),
    lrcFile: "x.lrc",
    section: { start_ms: 0, end_ms: 1, reason: "" },
    limit: {} as MakeResult["limit"],
    platforms: [{ name: "reels", error: null } as MakeResult["platforms"][number]],
    variations: [
      { name: "v1", platform: "reels", error: null, qaSummary: "PASS" },
      { name: "v2", platform: "reels", error: null, qaSummary: "WARN (clips repeated within 3 shots)" },
    ] as MakeResult["variations"],
    warnings: [],
    ...over,
  });

  it("writes live progress and the result; links its jobs to the run", async () => {
    const run = enqueueRun(ws, projectId, generateOptions(ws, projectId, { platforms: ["reels"] }));
    claimNextRun(ws, process.pid);
    const seen: { progress: number; current: string | null }[] = [];
    let given: MakeOptions | null = null;
    const done = await executeRun(ws, ws.db.select().from(makeRun).where(eq(makeRun.id, run.id)).get()!, async (o) => {
      given = o;
      o.onReady?.({ platform: { name: "reels", label: "Reels", index: 0, count: 1, folder: "" }, exportDir: path.join(songPathsById(ws, projectId).exports, "2026-10-27_1000", "reels") } as never);
      expect(ws.db.select().from(makeRun).where(eq(makeRun.id, run.id)).get()!.export_dir).toBe(`${songPathsById(ws, projectId).exportsRel}/2026-10-27_1000`);
      o.onRenderProgress?.([{ platform: "reels", name: "v1", status: "rendering", progress: 0.5 }, { platform: "reels", name: "v2", status: "queued", progress: 0 }]);
      const r = ws.db.select().from(makeRun).where(eq(makeRun.id, run.id)).get()!;
      seen.push({ progress: r.progress, current: r.current });
      return fakeResult();
    });
    expect(given!.runId).toBe(run.id);
    expect(seen[0].progress).toBeCloseTo(0.2375, 4);
    expect(seen[0].current).toBe("Reels v1: 50% (1 of 2)");
    expect(done).toMatchObject({ status: "done", progress: 1, message: "2 videos: 1 ready to post · 1 to improve", export_dir: `${songPathsById(ws, projectId).exportsRel}/2026-10-27_1000`, current: null });
  });

  it("the summary uses the Videos tab's verdicts (from each video's qa + manifest), not PASS/WARN", () => {
    const dir = path.join(root, "summary");
    mkdirSync(dir, { recursive: true });
    const video = (name: string, qa: string) => {
      writeFileSync(path.join(dir, `${name}.qa.txt`), qa);
      writeFileSync(path.join(dir, `${name}.manifest.json`), JSON.stringify({ props: { shots: [] }, settings: {} }));
      return { name, platform: "reels", error: null, qaSummary: qa.includes("[WARN]") ? "WARN (x)" : "PASS", qaFile: path.join(dir, `${name}.qa.txt`), manifestFile: path.join(dir, `${name}.manifest.json`) };
    };
    const ok = "[ok  ] Something\nSummary: PASS\n";
    const minor = '[WARN] Lines start with the vocals\n  line 3 "Hold on" starts 1.0 s early (1.0 s early)\nSummary: WARN - x\n';
    const major = "[WARN] Audio matches the song\n  differs\nSummary: WARN - x\n";
    const result = fakeResult({ variations: [video("v1", ok), video("v2", ok), video("v3", minor), video("v4", major)] as unknown as MakeResult["variations"] });
    expect(runSummary(result, false)).toBe("4 videos: 2 ready to post · 1 to improve · 1 not ready");
    expect(runSummary(fakeResult({ variations: [video("v1", ok)] as unknown as MakeResult["variations"] }), false)).toBe("1 video: 1 ready to post");
    expect(runSummary(fakeResult({ variations: [] }), true)).toBe("0 videos. stopped: Resume makes the rest");
  });

  it("Stop: makeVideos is told to stop; the run ends as stopped (Resume makes the rest)", async () => {
    const run = enqueueRun(ws, projectId, generateOptions(ws, projectId, { platforms: ["reels"] }));
    const claimed = claimNextRun(ws, process.pid)!;
    const done = await executeRun(ws, claimed, async (o) => {
      expect(o.shouldStop!()).toBe(false);
      requestStop(ws, run.id);
      expect(o.shouldStop!()).toBe(true);
      o.onRenderProgress?.([{ platform: "reels", name: "v1", status: "done", progress: 1 }, { platform: "reels", name: "v2", status: "stopped", progress: 0 }]);
      return fakeResult({ variations: [{ name: "v1", platform: "reels", error: null, qaSummary: "PASS" }] as MakeResult["variations"] });
    });
    expect(done).toMatchObject({ status: "stopped", message: "1 video: 1 ready to post. stopped: Resume makes the rest" });
  });

  it("an error ends the run as failed with the reason", async () => {
    enqueueRun(ws, projectId, generateOptions(ws, projectId, { platforms: ["reels"] }));
    const claimed = claimNextRun(ws, process.pid)!;
    const done = await executeRun(ws, claimed, async () => {
      throw new Error('--collection <name> is needed the first time for "Hold On"');
    });
    expect(done).toMatchObject({ status: "failed", message: '--collection <name> is needed the first time for "Hold On"' });
  });

  it("progress and the 'now' line", () => {
    expect(runProgress(["reels", "canvas"], [{ platform: "reels", name: "v1", status: "done", progress: 1 }])).toBe(0.5);
    expect(runCurrent([{ platform: "canvas", name: "v1", status: "checking", progress: 1 }])).toBe("Canvas v1: QA check (1 of 1)");
    expect(runCurrent([{ platform: "reels", name: "v2", status: "rendering", progress: 0.45 }])).toBe("Reels v2: 45% (1 of 1)"); // a Resume
    expect(runCurrent([{ platform: "reels", name: "v1", status: "done", progress: 1 }])).toBeNull();
  });
});

describe("Resume and the Tasks list", () => {
  it("a terminal run resumes with its own command; missing files are replaced by the project's copies", () => {
    const dir = path.join(songPathsById(ws, projectId).exports, "2026-10-26_0900", "reels");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "v1.manifest.json"), JSON.stringify({ command: 'pnpm make "D:\\gone\\song.wav" "D:\\gone\\lyrics.txt" --collection wedding --platforms reels --variations 3' }));
    const o = resumeOptions(ws, projectId, "2026-10-26_0900");
    expect(o).toMatchObject({ collection: "wedding", platforms: "reels", variations: 3, resume: true, resumeFolder: path.join(songPathsById(ws, projectId).exports, "2026-10-26_0900") });
    expect(o.song).toBe(songPathsById(ws, projectId).audio);
    expect(o.lyrics).toBe(songPathsById(ws, projectId).lyricsTxt);
    expect(o.command).toMatch(/--variations 3 \(resumed in Lyric Studio\)$/);
    expect(() => resumeOptions(ws, projectId, "2020-01-01_0000")).toThrow(/No run 2020-01-01_0000/);
  });

  it("a studio run resumes with the options it was made with", () => {
    mkdirSync(path.join(songPathsById(ws, projectId).exports, "2026-10-27_1000"), { recursive: true });
    const o = resumeOptions(ws, projectId, "2026-10-27_1000"); // made by the "writes live progress" run above
    expect(o).toMatchObject({ platforms: "reels", resume: true, command: "Lyric Studio: Generate (resumed in Lyric Studio)" });
    expect(enqueueRun(ws, projectId, o).label).toBe("Resume Reels");
  });

  it("a run stopped before its 2nd platform started resumes with both platforms; only a run nobody took over offers Resume", async () => {
    const exportsDir = songPathsById(ws, projectId).exports;
    const folder = "2026-10-30_0900";
    mkdirSync(path.join(exportsDir, folder, "reels"), { recursive: true });
    const queued = enqueueRun(ws, projectId, generateOptions(ws, projectId, { platforms: ["reels", "tiktok"] }));
    const running = ws.db.update(makeRun).set({ status: "running", pid: process.pid }).where(eq(makeRun.id, queued.id)).returning().get();
    const stoppedRun = await executeRun(ws, running, async (o) => {
      o.onReady?.({ platform: { name: "reels", label: "Reels", index: 0, count: 2, folder: "" }, exportDir: path.join(exportsDir, folder, "reels") } as never);
      requestStop(ws, queued.id);
      expect(o.shouldStop!()).toBe(true); // asked before the 2nd platform starts
      o.onRenderProgress?.([{ platform: "reels", name: "v1", status: "done", progress: 1 }]);
      return {
        projectTitle: "Hold On", exportDir: path.join(exportsDir, folder), lrcFile: "x.lrc", section: { start_ms: 0, end_ms: 1, reason: "" }, limit: {} as MakeResult["limit"], warnings: [],
        platforms: [{ name: "reels", error: null }, { name: "tiktok", error: "stopped before it started" }] as MakeResult["platforms"],
        variations: [{ name: "v1", platform: "reels", error: null, qaSummary: "PASS" }] as MakeResult["variations"],
      };
    });
    expect(stoppedRun.status).toBe("stopped");
    const options = resumeOptions(ws, projectId, folder);
    expect(options).toMatchObject({ platforms: "reels,tiktok", resume: true }); // the run's full options: tiktok never started and is made now
    const entry = () => listTasks(ws).runs.find((r) => r.id === queued.id)!;
    expect(entry().resumable).toBe(true);
    const again = enqueueRun(ws, projectId, options);
    expect(again.label).toBe("Resume Reels, TikTok");
    expect(entry().resumable).toBe(false); // the resumed run is waiting for its turn
    ws.db.update(makeRun).set({ status: "failed" }).where(eq(makeRun.id, again.id)).run();
    expect(entry().resumable).toBe(true); // it failed: the old entry offers Resume again
    ws.db.update(makeRun).set({ status: "done" }).where(eq(makeRun.id, again.id)).run();
    expect(entry().resumable).toBe(false);
  });

  it("lists studio runs (with the song) and terminal runs rendering right now", () => {
    const v = ws.db.insert(variation).values({ project_id: projectId, seed: 1, cut_rate: "1x", text_size: 64, colour: "#fff", cinematic_bars: false, overrides_json: { platform: "tiktok", run: `${songPathsById(ws, projectId).exportsRel}/2026-10-28_0800` } }).returning().get();
    ws.db.insert(renderJob).values({ variation_id: v.id, status: "rendering", progress: 0.4, pid: process.pid }).run();
    const tasks = listTasks(ws);
    expect(tasks.runs.length).toBeGreaterThan(0);
    expect(tasks.runs.every((r) => r.title === "Hold On")).toBe(true);
    expect(tasks.terminal).toEqual([{ projectId, title: "Hold On", run: "2026-10-28_0800", platforms: ["tiktok"], videos: [{ platform: "tiktok", status: "rendering", progress: 0.4 }] }]);
    ws.db.update(project).set({ title: "Hold On" }).run();
  });
});

describe("why the aligner failed", () => {
  it("keeps the aligner's last real messages (not progress bars) for the Tasks menu", async () => {
    const { alignFailure } = await import("../src/node");
    expect(alignFailure(["lyrics: aligning", "The AI packages for pnpm align are not installed (or are out of date).", "Install them once with:  pnpm audio:setup --ai", "45%|####  | 9/20 [00:01<00:02, 4.1it/s]"])).toBe(
      "lyrics: aligning\nThe AI packages for pnpm align are not installed (or are out of date).\nInstall them once with:  pnpm audio:setup --ai",
    );
    expect(alignFailure([])).toBe("no message");
  });
});
