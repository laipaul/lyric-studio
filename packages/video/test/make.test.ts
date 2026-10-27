// "pnpm make" and "pnpm rerender": collection import by content hash, project by song hash, stored
// (immutable) alignments, and a full short run with real renders, manifests, QA and a rerender.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT, clip, ffmpegBin, lyricLine, project, openWorkspace, renderJob, seedStylePresets, variation, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EFFECTS, lyricArea, sectionWindow, toSrt, type EffectsPreviewProps } from "../src";

import {
  effectsPreview,
  ensureAlignment,
  exportFolder,
  failureSummary,
  findOrCreateSongProject,
  makeVideos,
  planVariations,
  readManifest,
  readMoves,
  readRecipe,
  writeRecipe,
  resolveMoved,
  movesSince,
  songPathsById,
  latestExportFolder,
  qaSummaryFromFile,
  publishText,
  resolveCover,
  renderLimit,
  rerender,
  retryLimit,
  watchProgress,
  sha256File,
  syncCollection,
  loadPresets,
  type AlignRunner,
  type MakeOptions,
  type MakePlan,
  type MakeResult,
  type RenderOptions,
} from "../src/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-make-"));
const wsDir = path.join(root, "workspace");
const inDir = path.join(root, "in");
const ffmpeg = (...args: string[]) => execFileSync(ffmpegBin(), ["-y", "-v", "error", ...args]);
const previousWorkspace = process.env.WORKSPACE_DIR;

// A 12 s click track at 120 BPM: a high click on every beat and a low kick on every downbeat.
function makeSong(file: string, seconds = 12) {
  ffmpeg(
    "-f", "lavfi",
    "-i", `aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)+0.9*sin(2*PI*55*t)*exp(-12*mod(t-0.25,2))*gte(t,0.25)':s=44100:d=${seconds}`,
    "-ac", "2", file,
  );
}

function makeClip(file: string, seconds: number, colour: string) {
  ffmpeg("-f", "lavfi", "-i", `testsrc2=s=216x384:r=30:d=${seconds}`, "-vf", `drawbox=c=${colour}@0.6:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file);
}

const LYRICS = ["Verse one here", "* Hold on to me", "Through the night", "Verse two here", "Hold on to me", "Into the light"];

// Stands in for "pnpm align" (the AI models are tested in the "AI alignment" workflow): a line every
// 1.5 s from 1 s, words 0.3 s apart, line 3 with low confidence.
const calls: { hint?: string; fresh: boolean }[] = [];
const fakeAlign: AlignRunner = async (a) => {
  calls.push({ hint: a.hint, fresh: a.fresh });
  const texts = readFileSync(a.lyrics, "utf8").split(/\r?\n/).filter(Boolean);
  const stamp = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(2).padStart(5, "0")}`;
  const lines = texts.map((raw, i) => {
    const hook = raw.startsWith("* ");
    const text = raw.replace(/^\*\s+/, "");
    const start = 1000 + i * 1500;
    const words = text.split(" ").map((w, k) => `<${stamp(start + k * 300)}>${w}`).join(" ");
    return { line: `[${stamp(start)}]${hook ? "* " : ""}${words}`, report: { number: i + 1, text, is_hook: hook, start_ms: start, end_ms: start + 1100, confidence: i === 2 ? 0.31 : 0.88 } };
  });
  writeFileSync(a.out, `${lines.map((l) => l.line).join("\n")}\n[${stamp(1000 + texts.length * 1500)}]\n`);
  writeFileSync(a.report, JSON.stringify({ model: "fake", lang: a.lang, low_confidence: 0.5, lines: lines.map((l) => l.report) }));
};

let ws: Workspace;
beforeAll(() => {
  process.env.WORKSPACE_DIR = wsDir; // the audio analysis (a child process) uses the same workspace
  mkdirSync(path.join(wsDir, "clips", "beach"), { recursive: true });
  mkdirSync(inDir, { recursive: true });
  makeSong(path.join(inDir, "song.wav"));
  writeFileSync(path.join(inDir, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  makeClip(path.join(wsDir, "clips", "beach", "01_sea.mp4"), 3, "blue");
  makeClip(path.join(wsDir, "clips", "beach", "02_sand.mp4"), 4, "yellow");
  makeClip(path.join(wsDir, "clips", "beach", "10_sun.mp4"), 2, "red");
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
});
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("collection import", () => {
  const extra = path.join(root, "elsewhere");

  it("imports new clips once, in natural file-name order, without copying them", async () => {
    const first = await syncCollection(ws, { name: "beach" });
    expect(first.added).toEqual(["01_sea.mp4", "02_sand.mp4", "10_sun.mp4"]);
    expect(first.clips.map((c) => c.clip.path)).toEqual(["clips/beach/01_sea.mp4", "clips/beach/02_sand.mp4", "clips/beach/10_sun.mp4"]);
    expect(first.clips.every((c) => c.clip.content_hash === c.hash && c.hash.length === 64)).toBe(true);
    expect(readdirSync(path.join(wsDir, "clips", "beach"))).toHaveLength(3); // nothing copied

    const second = await syncCollection(ws, { name: "beach" });
    expect([second.added, second.changed, second.removed]).toEqual([[], [], []]);
    expect(second.unchanged).toHaveLength(3);
    expect(second.clips.map((c) => c.clip.id)).toEqual(first.clips.map((c) => c.clip.id));
  });

  it("re-imports a changed clip (new hash, new prepared copy) and drops deleted ones", async () => {
    const before = await syncCollection(ws, { name: "beach" });
    const sun = path.join(wsDir, "clips", "beach", "10_sun.mp4");
    makeClip(sun, 3, "green"); // same name, different content
    const extraClip = path.join(wsDir, "clips", "beach", "03_wave.mp4");
    makeClip(extraClip, 2, "white");
    const after = await syncCollection(ws, { name: "beach" });
    expect(after.changed).toEqual(["10_sun.mp4"]);
    expect(after.added).toEqual(["03_wave.mp4"]);
    const old = before.clips.find((c) => c.name === "10_sun.mp4")!;
    const now = after.clips.find((c) => c.name === "10_sun.mp4")!;
    expect(now.clip.id).toBe(old.clip.id);
    expect(now.hash).not.toBe(old.hash);
    expect(now.path).not.toBe(old.path); // a new 1080x1920 copy for the new content
    expect(now.clip.duration_ms).toBeGreaterThan(old.clip.duration_ms);

    rmSync(extraClip);
    const removed = await syncCollection(ws, { name: "beach" });
    expect(removed.removed).toEqual(["03_wave.mp4"]);
    expect(ws.db.select().from(clip).all().filter((c) => c.path.endsWith("03_wave.mp4"))).toHaveLength(0);
  });

  it("--collection-path: clips stay in their folder outside the workspace", async () => {
    mkdirSync(extra, { recursive: true });
    makeClip(path.join(extra, "a.mp4"), 2, "purple");
    const sync = await syncCollection(ws, { name: "outside", folder: extra });
    expect(sync.clips[0].clip.path).toBe(path.join(extra, "a.mp4"));
    expect(existsSync(path.join(wsDir, "clips", "outside", "a.mp4"))).toBe(false);
    await expect(syncCollection(ws, { name: "missing" })).rejects.toThrow(/Collection folder not found/);
  });
});

describe("song project and stored lyric alignment", () => {
  it("finds the project again by the song's content, even under another file name", async () => {
    const a = await findOrCreateSongProject(ws, path.join(inDir, "song.wav"));
    copyFileSync(path.join(inDir, "song.wav"), path.join(root, "renamed.wav"));
    const b = await findOrCreateSongProject(ws, path.join(root, "renamed.wav"));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.project.id).toBe(a.project.id);
    expect(a.project.audio_hash).toBe(sha256File(path.join(inDir, "song.wav")));
  });

  it("aligns once, reuses the stored LRC, and --realign adds a new file without touching the old one", async () => {
    const sp = await findOrCreateSongProject(ws, path.join(inDir, "song.wav"));
    calls.length = 0;
    const lyricsTxt = path.join(inDir, "lyrics.txt");
    const first = await ensureAlignment(ws, sp, { lyricsTxt, durationMs: 12_000, align: fakeAlign });
    const firstHash = sha256File(first.lrcFile);
    expect(first.source).toBe("aligned");
    expect(first.report?.lines[2].confidence).toBe(0.31);
    expect(first.lines.filter((l) => l.isHook).map((l) => l.text)).toEqual(["Hold on to me", "Hold on to me"]);

    const again = await ensureAlignment(ws, sp, { lyricsTxt, durationMs: 12_000, align: fakeAlign });
    expect(again.source).toBe("stored");
    expect(again.lrcFile).toBe(first.lrcFile);
    expect(calls).toHaveLength(1);

    const re = await ensureAlignment(ws, sp, { lyricsTxt, durationMs: 12_000, align: fakeAlign, realign: true, now: new Date(Date.now() + 5000) });
    expect(re.source).toBe("aligned");
    expect(re.lrcFile).not.toBe(first.lrcFile);
    expect(calls.at(-1)?.fresh).toBe(true);
    expect(sha256File(first.lrcFile)).toBe(firstHash); // the earlier alignment is never rewritten

    writeFileSync(path.join(root, "taps.lrc"), "[00:01.00]Verse one here\n");
    const hinted = await ensureAlignment(ws, sp, { lyricsTxt, durationMs: 12_000, align: fakeAlign, hint: path.join(root, "taps.lrc") });
    expect(hinted.key).not.toBe(first.key); // a hint is a different input
    expect(hinted.hint?.source).toBe(path.join(root, "taps.lrc"));
    expect(calls.at(-1)?.hint).toBe(hinted.hint?.file); // the project's stored copy of the taps
  });

  it("--lrc: the given file is stored as-is; hooks come from lyrics.txt", async () => {
    const sp = await findOrCreateSongProject(ws, path.join(inDir, "song.wav"));
    const given = path.join(root, "given.lrc");
    writeFileSync(given, "[00:01.00]Verse one here\n[00:02.00]Hold on to me\n[00:03.00]\n");
    const a = await ensureAlignment(ws, sp, { lyricsTxt: path.join(inDir, "lyrics.txt"), lrc: given, durationMs: 12_000 });
    expect(a.source).toBe("given");
    expect(readFileSync(a.lrcFile, "utf8")).toBe(readFileSync(given, "utf8"));
    expect(a.lines.map((l) => l.isHook)).toEqual([false, true]);
    expect(a.report).toBeNull();
  });
});

describe("variations and render limit", () => {
  it("v1 story, then shuffle with different seeds; Simple/Bold alternate; bars on every other one", () => {
    expect(planVariations(4)).toEqual([
      { index: 1, name: "v1", order: "story", seed: 1, style: "simple", bars: false },
      { index: 2, name: "v2", order: "shuffle", seed: 2, style: "bold", bars: true },
      { index: 3, name: "v3", order: "shuffle", seed: 3, style: "simple", bars: false },
      { index: 4, name: "v4", order: "shuffle", seed: 4, style: "bold", bars: true },
    ]);
  });

  it("Windows: one video at a time; the clip cache is capped and memory stays under 40%", () => {
    const win = renderLimit({ cpus: 24, memoryGB: 32, platform: "win32" });
    expect(win).toMatchObject({ parallel: 1, concurrency: 8, videoCacheBytes: 2 * 2 ** 30 });
    expect(win.estimateGB).toBeLessThanOrEqual(32 * 0.4);
    expect(win.explanation).toContain("one at a time on Windows");
    // --parallel 2 on the same PC: fewer frames in parallel and a smaller cache so it still fits.
    const two = renderLimit({ cpus: 24, memoryGB: 32, platform: "win32", requested: 2 });
    expect(two.parallel).toBe(2);
    expect(two.concurrency).toBeLessThan(8);
    expect(two.estimateGB).toBeLessThanOrEqual(32 * 0.4);
    expect(two.explanation).toContain("--parallel 2 is above the recommended 1");
  });

  it("elsewhere: 2 renders at a time on a big PC, 1 on a small one; never more than 40% of memory", () => {
    expect(renderLimit({ cpus: 24, memoryGB: 32, platform: "linux" }).parallel).toBe(2);
    expect(renderLimit({ cpus: 4, memoryGB: 8, platform: "linux" }).parallel).toBe(1);
    for (const memoryGB of [8, 16, 32, 64]) {
      for (const requested of [undefined, 1, 2]) {
        const l = renderLimit({ cpus: 24, memoryGB, platform: "linux", requested });
        if (l.concurrency > 1) expect(l.estimateGB).toBeLessThanOrEqual(memoryGB * 0.4);
        expect(l.videoCacheBytes).toBeGreaterThan(0);
      }
    }
  });

  it("a retry uses half the frames in parallel and half the clip cache", () => {
    const l = renderLimit({ cpus: 24, memoryGB: 32, platform: "win32" });
    expect(retryLimit(l)).toEqual({ concurrency: 4, videoCacheBytes: 2 ** 30 });
    expect(retryLimit({ ...l, concurrency: 1 }).concurrency).toBe(1);
  });

  it("the stall watchdog fires once when progress stops, and not while it continues", async () => {
    let stalls = 0;
    const w = watchProgress(200, () => (stalls += 1));
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 60));
      w.tick();
    }
    expect(stalls).toBe(0);
    await new Promise((r) => setTimeout(r, 450));
    expect(stalls).toBe(1);
    w.stop();
  });

  it("export folders are named by date and time and never reused", async () => {
    const now = new Date(2026, 9, 24, 9, 5);
    const id = (await findOrCreateSongProject(ws, path.join(inDir, "song.wav"))).project.id;
    const a = exportFolder(ws, id, now);
    const b = exportFolder(ws, id, now);
    expect(path.dirname(a)).toBe(songPathsById(ws, id).exports); // in the song folder's exports\
    expect(path.basename(a)).toBe("2026-10-24_0905");
    expect(path.basename(b)).toBe("2026-10-24_0905-2");
  });
});

describe("pnpm make + pnpm rerender (real renders)", () => {
  let result: MakeResult;
  let lrcHash: string;
  let lrcFile: string;

  let songBefore: { hash: string; mtimeMs: number };

  beforeAll(async () => {
    const input = path.join(inDir, "song.wav");
    songBefore = { hash: sha256File(input), mtimeMs: statSync(input).mtimeMs };
    result = await makeVideos({
      workspaceDir: wsDir,
      song: path.join(inDir, "song.wav"),
      lyrics: path.join(inDir, "lyrics.txt"),
      collection: "beach",
      variations: 2,
      section: "0:02-0:09", // 7 s: short enough for a quick rerender check
      align: fakeAlign,
      command: "pnpm make test",
    });
    const manifest = readManifest(result.variations[0].manifestFile);
    lrcFile = path.join(wsDir, ...manifest.lyrics.lrc.split("/"));
    lrcHash = sha256File(lrcFile);
  }, 600_000);

  it("never alters the music: the song file is untouched, the video's audio is the song itself", () => {
    const input = path.join(inDir, "song.wav");
    expect({ hash: sha256File(input), mtimeMs: statSync(input).mtimeMs }).toEqual(songBefore);
    const p = ws.db.select().from(project).all().find((x) => x.audio_hash === songBefore.hash)!;
    expect(sha256File(path.join(wsDir, ...p.audio_path!.split("/")))).toBe(songBefore.hash); // the song folder's copy is byte for byte the same
    for (const v of result.variations) {
      expect(v.qa!.checks.find((c) => c.name === "Audio matches the song")).toEqual({ name: "Audio matches the song", ok: true, details: [] });
      const m = readManifest(v.manifestFile);
      expect(m.settings.audio).toEqual({ fade_in_s: 0.3, fade_out_s: 0.5, sample_rate: 44_100, resampled: false, bitrate: "320k", processing: "none (no volume, loudness normalisation, EQ, compression or limiting)" });
      expect(m.settings.video).toBe("H.264, AAC 320 kbps 44.1 kHz, yuv420p, faststart");
    }
  });

  it("writes v1.mp4/v2.mp4 with a manifest and a QA report each, and records the jobs", () => {
    expect(readdirSync(result.exportDir).sort()).toEqual(["song.lrc", "v1.manifest.json", "v1.mp4", "v1.qa.txt", "v1.srt", "v2.manifest.json", "v2.mp4", "v2.qa.txt", "v2.srt"]);
    // Clean synced lyrics for lyric services: no word tags, no hook markers.
    const lrc = readFileSync(result.lrcFile, "utf8");
    expect(lrc).toContain("[ti:song]");
    expect(lrc).toContain("[00:02.50]Hold on to me");
    expect(lrc).not.toMatch(/<\d|\* /);
    expect(result.variations.map((v) => [v.name, v.error])).toEqual([["v1", null], ["v2", null]]);
    const jobs = ws.db.select().from(renderJob).all().filter((j) => j.output_path?.includes(path.basename(result.exportDir)));
    expect(jobs.map((j) => [j.status, j.progress])).toEqual([["done", 1], ["done", 1]]);
    expect(ws.db.select().from(variation).all().length).toBeGreaterThanOrEqual(2);
    expect(ws.db.select().from(lyricLine).all()).toHaveLength(LYRICS.length);
  });

  it("the manifest holds clips with hashes, cuts, lyric timings with lead and offset, fonts and settings", () => {
    const m = readManifest(result.variations[1].manifestFile);
    expect(m.variation).toMatchObject({ name: "v2", order: "shuffle", seed: 2, style: "Bold", cinematic_bars: true });
    expect(m.section).toMatchObject({ mode: "0:02-0:09" });
    expect(m.cuts.frames).toEqual(m.props.cutFrames);
    expect(m.shots.map((s) => s.start_frame)).toEqual(m.props.shots.map((s) => s.start));
    for (const c of m.clips) expect(c.sha256).toBe(sha256File(path.join(wsDir, ...c.file.split("/"))));
    expect(m.lyrics).toMatchObject({ lead_ms: 250, lyrics_offset_ms: 0 });
    const line = m.lyric_timings.find((l) => l.text === "Through the night")!;
    expect(line).toMatchObject({ number: 3, stamp_ms: 4000, shown_from_ms: 3750, confidence: 0.31 });
    expect(line.start_frame).toBe(Math.round((3750 * 30) / 1000) - Math.round((m.section.start_ms * 30) / 1000));
    expect(m.fonts.every((f) => f.sha256.length === 64)).toBe(true);
    expect(m.tool.name).toBe("lyric-studio");
    expect(m.command).toBe("pnpm make test");
  });

  it("QA reports the low-confidence line and checks the finished video's length", () => {
    const qa = readFileSync(result.variations[0].qaFile, "utf8");
    expect(qa).toContain("[ok  ] Video length");
    expect(qa).toContain('line 3 "Through the night": confidence 0.31');
    expect(qa).toMatch(/Summary: WARN - .*Lyric timing confidence/);
    expect(result.variations[0].qa?.status).toBe("WARN");
  });

  it("every variation of one run has the same section, audio and cuts", () => {
    const [a, b] = result.variations.map((v) => readManifest(v.manifestFile));
    expect(b.section).toEqual(a.section);
    expect(b.props.audio).toEqual(a.props.audio);
    expect(b.props.durationInFrames).toBe(a.props.durationInFrames);
    expect(b.props.cutFrames).toEqual(a.props.cutFrames);
    expect(b.lyric_timings.map((l) => [l.text, l.start_frame, l.end_frame])).toEqual(a.lyric_timings.map((l) => [l.text, l.start_frame, l.end_frame]));
    expect(a.props.shots[0].start).toBe(0); // both start at the section start, not partway in
  });

  it("rerender reproduces the video exactly (same props, identical sampled frames) and never touches the LRC", async () => {
    const manifestFile = result.variations[0].manifestFile;
    const again = await rerender(manifestFile, { workspaceDir: wsDir });
    expect(path.basename(again.out)).toBe("v1.rerender.mp4");
    expect(again.manifest.props).toEqual(readManifest(manifestFile).props);
    // MD5 of 7 frames spread over the video (every 35th frame of 210), decoded from each file.
    const sampled = (file: string) =>
      execFileSync(ffmpegBin(), ["-v", "error", "-i", file, "-map", "0:v", "-vf", "select=not(mod(n\\,35))", "-fps_mode", "passthrough", "-f", "framemd5", "-"], { encoding: "utf8" })
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(",").pop()!.trim());
    const original = sampled(result.variations[0].file);
    expect(original).toHaveLength(Math.ceil(again.manifest.props.durationInFrames / 35));
    expect(new Set(original).size).toBeGreaterThan(1); // really different moments of the video
    expect(sampled(again.out)).toEqual(original);
    expect(sha256File(lrcFile)).toBe(lrcHash);
  }, 300_000);

  it("a second make reuses the project, the stored alignment and the clips; the LRC is never modified", async () => {
    const before = calls.length;
    let notes: string[] = [];
    const second = await makeVideos({
      workspaceDir: wsDir,
      song: path.join(inDir, "song.wav"),
      lyrics: path.join(inDir, "lyrics.txt"),
      collection: "beach",
      variations: 1,
      section: "0:04-0:06",
      align: fakeAlign,
      frameCheck: false,
      onReady: (p) => (notes = p.notes),
    });
    expect(calls.length).toBe(before); // not aligned again
    const m = readManifest(second.variations[0].manifestFile);
    expect(m.lyrics.source).toBe("stored");
    // The section starts at the bar at ~4.25 s (as detected). Line 3 (4.0-5.1 s) is still being sung
    // there, so it is shown from the first frame; nothing is hidden.
    expect(Math.abs(m.section.start_ms - 4250)).toBeLessThan(30);
    expect(notes).toEqual([]);
    expect(m.lyric_timings.map((l) => [l.text, l.start_frame])).toEqual([["Through the night", 0], ["Verse two here", m.lyric_timings[1].start_frame]]);
    expect(sha256File(lrcFile)).toBe(lrcHash);
  }, 300_000);

  it("story anchors from song.json: the clip lands on its line in every video, gaps in story order; recorded and checked", async () => {
    const id = (await findOrCreateSongProject(ws, path.join(inDir, "song.wav"))).project.id;
    const recipeFile = songPathsById(ws, id).recipe!;
    const before = readRecipe(recipeFile);
    writeRecipe(recipeFile, { ...before, anchors: [{ line: 4, clip: "10_sun.mp4", transition: "dissolve" }, { line: 1, clip: "01_sea.mp4" }] });
    const logs: string[] = [];
    try {
      const made = await makeVideos({
        workspaceDir: wsDir, song: path.join(inDir, "song.wav"), lyrics: path.join(inDir, "lyrics.txt"), collection: "beach",
        variations: 2, section: "0:02-0:09", align: fakeAlign, frameCheck: false, log: (m) => logs.push(m),
      });
      const [m1, m2] = made.variations.map((v) => readManifest(v.manifestFile));
      // Line 4 "Verse two here" (stamp 5.5 s, on screen 5.25 s): cut in on the bar at ~4.25 s.
      for (const m of [m1, m2]) {
        expect(m.settings.order).toBe("story");
        expect(m.settings.gap_order).toBe("story");
        const use = m.anchors!.used.find((u) => u.line === 4)!;
        expect([use.used, use.clip]).toEqual([true, "10_sun.mp4"]);
        expect(Math.abs(use.at_ms! - 4_250)).toBeLessThan(120);
        expect(m.shots[use.shot!].clip).toBe("10_sun.mp4");
        expect(m.anchors!.used.find((u) => u.line === 1)).toMatchObject({ used: false, why: "outside this section" });
      }
      // The variations differ by style and cut / dissolve: v1 the anchor's own (dissolve), v2 all dissolve.
      expect([m1.settings.transitions, m2.settings.transitions]).toEqual(["as-set", "dissolve"]);
      expect(m1.props.shots.some((s) => s.dissolve)).toBe(true);
      expect(logs.some((l) => /anchor line 4 "Verse two here" -> 10_sun\.mp4: at 0:04\.\d \(dissolve\)/.test(l))).toBe(true);
      expect(logs).toContain("standard: gap order story (the song has anchors): every video in file-name order; they differ by style, cut rate and cut / dissolve");
      const qa = readFileSync(made.variations[0].qaFile, "utf8");
      expect(qa).toMatch(/Story anchors/);
      expect(qa).toContain("not in this section: line 1 (01_sea.mp4)");
    } finally {
      writeRecipe(recipeFile, before);
    }
  }, 300_000);

  it("compare font pairings: one video per pairing, the same section, clips and order; the fonts recorded", async () => {
    const logs: string[] = [];
    const made = await makeVideos({
      workspaceDir: wsDir, song: path.join(inDir, "song.wav"), lyrics: path.join(inDir, "lyrics.txt"), collection: "beach",
      pairings: "elegant,dramatic", section: "0:02-0:09", align: fakeAlign, frameCheck: false, log: (m) => logs.push(m),
    });
    expect(made.variations.map((v) => v.name)).toEqual(["v1", "v2"]);
    const [a, b] = made.variations.map((v) => readManifest(v.manifestFile));
    expect(a.settings.fonts).toEqual({ verse: { family: "Cormorant Garamond", weight: 400, italic: false }, hook: { family: "Cormorant Garamond", weight: 600, italic: true }, pairing: "elegant" });
    expect(b.settings.fonts).toEqual({ verse: { family: "Cormorant Garamond", weight: 400, italic: false }, hook: { family: "Playfair Display", weight: 400, italic: true }, pairing: "dramatic" });
    // Only the fonts differ: the same section, cuts, clips and in-points.
    expect(b.section).toEqual(a.section);
    expect(b.shots).toEqual(a.shots);
    expect([a.settings.order, b.settings.order, a.props.style.name, b.props.style.name]).toEqual(["story", "story", "Simple", "Simple"]);
    expect(b.props.fonts.map((f) => f.src)).toContain("_fonts/playfair-display-latin-400-italic.woff2");
    expect(logs.some((l) => l.startsWith("standard: comparing font pairings: v1 Elegant (Cormorant Garamond 400 + Cormorant Garamond 600 italic), v2 Dramatic"))).toBe(true);
    expect(readFileSync(made.variations[1].qaFile, "utf8")).toContain("fonts: Dramatic");
  }, 300_000);

  it("rerender fails clearly when a clip has changed", async () => {
    const m = readManifest(result.variations[0].manifestFile);
    const used = path.join(wsDir, ...m.clips[0].file.split("/"));
    makeClip(used, 3, "black");
    await expect(rerender(result.variations[0].manifestFile, { workspaceDir: wsDir })).rejects.toThrow(
      new RegExp(`clip ${m.clips[0].name.replace(".", "\\.")} has changed since the render`),
    );
  });
});

describe("failures, retry and --resume (stand-in renderer)", () => {
  const sample = path.join(root, "sample.mp4");
  const rendered: { name: string; concurrency?: number; cacheBytes?: number }[] = [];
  let failures: Record<string, number> = {};
  // Copies a small video to the output, or fails while `failures[name]` is above 0.
  const renderer = async (o: RenderOptions) => {
    const name = path.basename(o.outFile, ".mp4");
    rendered.push({ name, concurrency: o.concurrency, cacheBytes: o.videoCacheBytes });
    o.onProgress?.(0.5);
    if ((failures[name] ?? 0) > 0) {
      failures[name] -= 1;
      throw new Error("Compositor quit: memory allocation of 2088960 bytes failed");
    }
    copyFileSync(sample, o.outFile);
    o.onProgress?.(1);
    return o.outFile;
  };
  const run = (extra: Partial<MakeOptions> = {}) =>
    makeVideos({
      workspaceDir: wsDir,
      song: path.join(inDir, "song.wav"),
      lyrics: path.join(inDir, "lyrics.txt"),
      collection: "beach",
      variations: 4,
      section: "0:02-0:05",
      align: fakeAlign,
      frameCheck: false,
      renderer,
      platform: "win32",
      ...extra,
    });

  beforeAll(() => {
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=3", "-pix_fmt", "yuv420p", sample);
  });

  let first: MakeResult;
  it("retries a failed variation once with less memory, continues after a second failure and reports it", async () => {
    rendered.length = 0;
    failures = { v2: 1, v3: 5 }; // v2 fails once, v3 every time
    const retries: string[] = [];
    first = await run({ onRetry: (name) => retries.push(name) });
    expect(first.limit.parallel).toBe(1);
    const byName = Object.fromEntries(first.variations.map((v) => [v.name, v]));
    expect([byName.v1.error, byName.v2.error, byName.v4.error]).toEqual([null, null, null]);
    expect(byName.v2.retried).toBe(true);
    expect(byName.v3.error).toMatch(/memory allocation .* \(also after a retry with \d+ frames? in parallel\)/);
    expect(retries).toEqual(["v2", "v3"]);
    const v2 = rendered.filter((r) => r.name === "v2");
    expect(v2).toHaveLength(2);
    expect(v2[1].concurrency).toBe(Math.max(1, Math.floor(v2[0].concurrency! / 2)));
    expect(v2[1].cacheBytes).toBeLessThan(v2[0].cacheBytes!);
    expect(rendered.map((r) => r.name)).toEqual(["v1", "v2", "v2", "v3", "v3", "v4"]); // v4 still rendered
    expect(existsSync(path.join(first.exportDir, "v3.mp4"))).toBe(false);
    expect(existsSync(path.join(first.exportDir, "v4.manifest.json"))).toBe(true);
    const jobs = ws.db.select().from(renderJob).all().filter((j) => j.error?.includes("also after a retry"));
    expect(jobs.length).toBeGreaterThanOrEqual(1);
  });

  it("--resume renders only the missing or failed variations, into the same folder", async () => {
    rendered.length = 0;
    failures = {};
    rmSync(path.join(first.exportDir, "v4.qa.txt")); // an interrupted variation: video without its QA report
    const resumed = await run({ resume: true });
    expect(resumed.exportDir).toBe(first.exportDir);
    expect(latestExportFolder(ws, readManifest(path.join(first.exportDir, "v1.manifest.json")).project.id)).toBe(first.exportDir);
    expect(rendered.map((r) => r.name)).toEqual(["v3", "v4"]);
    expect(resumed.variations.map((v) => [v.name, v.kept, v.error])).toEqual([
      ["v1", true, null],
      ["v2", true, null],
      ["v3", false, null],
      ["v4", false, null],
    ]);
    expect(resumed.variations[0].qaSummary).toBe(qaSummaryFromFile(path.join(first.exportDir, "v1.qa.txt")));

    rendered.length = 0;
    const again = await run({ resume: true });
    expect(rendered).toEqual([]); // all done: nothing rendered
    expect(again.variations.every((v) => v.kept)).toBe(true);
  });

  it("Stop (the studio): after the current video the rest is not started, their jobs are interrupted; Resume into that folder finishes it", async () => {
    rendered.length = 0;
    failures = {};
    let started = 0;
    const states: string[] = [];
    const stopped = await run({
      renderer: async (o) => {
        started++;
        return renderer(o);
      },
      shouldStop: () => started >= 2, // stop requested while v2 renders
      onRenderProgress: (list) => states.splice(0, states.length, ...list.map((x) => `${x.platform}:${x.name}:${x.status}`)),
      runId: "run-123",
    });
    expect(rendered.map((r) => r.name)).toEqual(["v1", "v2"]);
    expect(states).toEqual(["standard:v1:done", "standard:v2:done", "standard:v3:stopped", "standard:v4:stopped"]);
    const jobs = ws.db.select({ status: renderJob.status, error: renderJob.error, overrides: variation.overrides_json }).from(renderJob).innerJoin(variation, eq(renderJob.variation_id, variation.id)).all().filter((j) => j.overrides?.make_run === "run-123");
    expect(jobs.map((j) => j.status).sort()).toEqual(["done", "done", "interrupted", "interrupted"]);

    // A newer run exists; Resume of the stopped one (by its folder) renders only v3 and v4 there.
    const newer = await run({ variations: 1 });
    expect(newer.exportDir).not.toBe(stopped.exportDir);
    rendered.length = 0;
    const resumed = await run({ resume: true, resumeFolder: stopped.exportDir });
    expect(resumed.exportDir).toBe(stopped.exportDir);
    expect(rendered.map((r) => r.name)).toEqual(["v3", "v4"]);
    await expect(run({ resume: true, resumeFolder: path.join(root, "elsewhere") })).rejects.toThrow(/is not a run folder of/);
  });

  it("--resume refuses when the inputs changed since that run", async () => {
    rmSync(path.join(first.exportDir, "v4.mp4"));
    await expect(run({ resume: true, section: "0:02-0:06" })).rejects.toThrow(/--resume: the section changed .* run without --resume/);
    await expect(run({ resume: true, lyricsOffsetMs: 100 })).rejects.toThrow(/the lyric lead or offset changed/);
  });
});

describe("platform presets (stand-in renderer)", () => {
  const song = path.join(root, "long-song.wav");
  const lyricsFile = path.join(root, "long-lyrics.txt");
  const sample = path.join(root, "sample2.mp4");
  const chorus = ["* Hold on to me", "Through the night", "We will rise", "Into the light"];
  const verse = (n: number) => [`Verse ${n} line one`, `Verse ${n} line two`, `Verse ${n} line three`, `Verse ${n} line four`];
  const texts = [...verse(1), ...chorus, ...verse(2), ...chorus, ...verse(3), ...chorus, ...verse(4), ...chorus];
  // Lines every 2 s from 0.9 s, each sung for 1 s: every bar start (0.25 + 2k s) is free of singing.
  const align2s: AlignRunner = async (a) => {
    const raw = readFileSync(a.lyrics, "utf8").split(/\r?\n/).filter(Boolean);
    const stamp = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(2).padStart(5, "0")}`;
    const rows = raw.map((r, i) => ({ r, start: 900 + i * 2000 }));
    writeFileSync(a.out, rows.map(({ r, start }) => `[${stamp(start)}]${r}`).join("\n") + `\n[${stamp(900 + raw.length * 2000)}]\n`);
    const lines = rows.map(({ r, start }, i) => ({ number: i + 1, text: r.replace(/^\*\s+/, ""), is_hook: r.startsWith("* "), start_ms: start, end_ms: start + 1000, confidence: 0.9 }));
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines }));
  };
  const rendered: string[] = [];
  const renderer = async (o: RenderOptions) => {
    rendered.push(path.relative(root, o.outFile));
    copyFileSync(sample, o.outFile);
    return o.outFile;
  };
  const run = (extra: Partial<MakeOptions> = {}) =>
    makeVideos({
      workspaceDir: wsDir, song, lyrics: lyricsFile, collection: "mixed", align: align2s, frameCheck: false, renderer, platform: "win32", ...extra,
    });

  beforeAll(() => {
    makeSong(song, 75);
    writeFileSync(lyricsFile, `${texts.join("\n")}\n`);
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
    const dir = path.join(wsDir, "clips", "mixed");
    mkdirSync(dir, { recursive: true });
    makeClip(path.join(dir, "01_a.mp4"), 6, "blue"); // 6 s: long enough to continue into the first shot
    makeClip(path.join(dir, "02_b.mp4"), 6, "yellow");
    makeClip(path.join(dir, "03_c.mp4"), 6, "red");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=384x216:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "04_wide.mp4"));
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=600x1000", "-frames:v", "1", path.join(dir, "05_portrait.jpg"));
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1000x600", "-frames:v", "1", path.join(dir, "06_landscape.jpg"));
    mkdirSync(path.join(wsDir, "brand"), { recursive: true });
    ffmpeg("-f", "lavfi", "-i", "color=c=0xE8A3B5:s=300x120", "-frames:v", "1", path.join(wsDir, "brand", "logo.png"));
  });

  it('"checked by ear" (Lyrics tab) reaches pnpm make: logged and kept in the manifest while the line is unchanged', async () => {
    const first = await run({ platforms: "reels", variations: 1 });
    const m = readManifest(first.platforms[0].variations[0].manifestFile);
    const t = m.lyric_timings[0];
    const dir = path.dirname(path.join(wsDir, ...m.lyrics.lrc.split("/")));
    const earFile = path.join(dir, "checked-by-ear.json");
    writeFileSync(earFile, JSON.stringify([{ number: t.number, text: t.text, lrc: m.lyrics.lrc_sha256, start_ms: t.stamp_ms, at: "2026-10-27T10:00:00.000Z" }]));
    const log: string[] = [];
    const second = await run({ platforms: "reels", variations: 1, log: (x) => log.push(x) });
    const timings = readManifest(second.platforms[0].variations[0].manifestFile).lyric_timings;
    expect(timings.filter((x) => x.checked_by_ear).map((x) => x.number)).toEqual([t.number]);
    expect(log).toContain(`lyrics: line ${t.number} checked by ear (Lyrics tab): its timing warnings are cleared`);
    // Another start for that line: the mark no longer holds.
    writeFileSync(earFile, JSON.stringify([{ number: t.number, text: t.text, lrc: m.lyrics.lrc_sha256, start_ms: t.stamp_ms + 500, at: "2026-10-27T10:00:00.000Z" }]));
    const third = await run({ platforms: "reels", variations: 1 });
    expect(readManifest(third.platforms[0].variations[0].manifestFile).lyric_timings.some((x) => x.checked_by_ear)).toBe(false);
    rmSync(earFile);
  });

  let all: MakeResult;
  let allWhen = ""; // when that run started (the song folder is renamed by later tests)
  it("--platforms reels,tiktok,shorts: one folder each, with the preset's size, length, variations, safe zones and fade", async () => {
    const plans: MakePlan[] = [];
    allWhen = new Date().toISOString();
    all = await run({ platforms: "reels,tiktok,shorts", onReady: (p) => plans.push(p) });
    expect(all.platforms.map((p) => [p.name, p.error, p.variations.length])).toEqual([["reels", null, 3], ["tiktok", null, 3], ["shorts", null, 2]]);
    const presets = loadPresets();
    for (const p of all.platforms) {
      expect(p.exportDir).toBe(path.join(all.exportDir, p.name));
      const preset = presets[p.name];
      const w = sectionWindow(preset)!;
      for (const v of p.variations) {
        const m = readManifest(v.manifestFile);
        expect(m.platform?.name).toBe(p.name);
        expect(m.props.format).toEqual({ width: 1080, height: 1920 });
        expect(m.props.safeZone).toEqual(preset.safeZone);
        expect(m.props.lyricArea).toEqual(lyricArea(preset, preset.safeZone, preset.lyricsAt, m.props.cinematicBars));
        expect(m.props.audio?.fadeOutFrames).toBe(Math.round(preset.fadeOutSeconds * 30));
        const length = m.section.end_ms - m.section.start_ms;
        expect(length).toBeGreaterThanOrEqual(w.minMs);
        expect(length).toBeLessThanOrEqual(w.maxMs);
        expect(readFileSync(v.qaFile, "utf8")).toContain(preset.label);
        // No logo on 9:16 by default (brand.json logo.platforms = ["youtube"]).
        expect(m.props.logo ?? null).toBeNull();
        expect(readFileSync(v.qaFile, "utf8")).not.toContain("Logo");
      }
    }
    expect(plans.map((p) => p.platform.name)).toEqual(["reels", "tiktok", "shorts"]);
    // 3 vertical clips + 1 vertical photo are usable; the wide clip and the landscape photo are not.
    expect(plans[0].sources).toMatchObject({ usable: 4, needed: 4, kind: "vertical", skipped: ["04_wide.mp4", "06_landscape.jpg"] });
    expect(readdirSync(all.exportDir).filter((f) => f.endsWith(".lrc"))).toEqual(["long-song.lrc"]);
  });

  it("reels: the last shot continues into the first (seamless loop) and photos move", () => {
    const reels = all.platforms.find((p) => p.name === "reels")!;
    for (const v of reels.variations) {
      const shots = readManifest(v.manifestFile).props.shots;
      const first = shots[0];
      const last = shots[shots.length - 1];
      expect(last.src).toBe(first.src);
      if (first.kind !== "photo") expect(last.clipStartFrame + last.duration).toBe(first.clipStartFrame);
      else expect([last.motion?.toZoom, last.motion?.toX]).toEqual([first.motion?.fromZoom, first.motion?.fromX]);
    }
    const photos = all.variations.flatMap((v) => readManifest(v.manifestFile).props.shots.filter((s) => s.kind === "photo"));
    expect(photos.length).toBeGreaterThan(0);
    for (const s of photos) expect(s.motion && s.motion.fromZoom !== s.motion.toZoom).toBe(true);
    const tiktokLast = readManifest(all.platforms[1].variations[1].manifestFile).props.shots;
    expect(tiktokLast.at(-1)?.src === tiktokLast[0].src && tiktokLast.at(-1)!.clipStartFrame + tiktokLast.at(-1)!.duration === tiktokLast[0].clipStartFrame).toBe(false);
  });

  it("--allow-fill uses the other orientation too, shown whole over a blurred copy", async () => {
    const r = await run({ platforms: "tiktok", variations: 2, allowFill: true });
    const m = readManifest(r.variations[1].manifestFile);
    expect(m.settings.collection).toMatchObject({ clips: 6, usable: 6 });
    const filled = [...r.variations].flatMap((v) => readManifest(v.manifestFile).props.shots).filter((s) => s.fit === "fill");
    expect(filled.length).toBeGreaterThan(0);
  });

  it("too few or no suitable sources: QA WARN with the count needed, or a clear error", async () => {
    const dir = path.join(wsDir, "clips", "wide-only");
    mkdirSync(dir, { recursive: true });
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=384x216:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "w1.mp4"));
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=384x216:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "w2.mp4"));
    makeClip(path.join(dir, "v1.mp4"), 3, "blue");
    const few = await run({ platforms: "tiktok", variations: 1, collection: "wide-only" });
    expect(readFileSync(few.variations[0].qaFile, "utf8")).toContain("only 1 vertical source(s) for TikTok; at least 3 needed");
    rmSync(path.join(dir, "v1.mp4"));
    await expect(run({ platforms: "tiktok", variations: 1, collection: "wide-only" })).rejects.toThrow(/none of the 2 source\(s\) in "wide-only" is vertical .*--allow-fill/);
  });

  it("an edited presets file is respected: size, variations and safe zones", async () => {
    const json = JSON.parse(readFileSync(path.join(REPO_ROOT, "presets", "platforms.json"), "utf8"));
    json.platforms.reels = { ...json.platforms.reels, width: 540, height: 960, variations: 2, safeZone: { top: 0.2, bottom: 0.4, left: 0, right: 0.1 } };
    const file = path.join(root, "my-presets.json");
    writeFileSync(file, JSON.stringify(json));
    const r = await run({ platforms: "reels", presetsFile: file });
    expect(r.variations).toHaveLength(2);
    const m = readManifest(r.variations[0].manifestFile);
    expect(m.props.format).toEqual({ width: 540, height: 960 });
    expect(m.props.lyricArea?.bottom).toBe(Math.round(960 * 0.6));
    expect(m.clips.every((c) => c.normalised.includes("cover540x960") || c.normalised.endsWith(".jpg"))).toBe(true);
  });

  it("every video gets a .srt with the lines exactly as it shows them", () => {
    for (const v of all.variations) {
      const srt = readFileSync(v.srtFile, "utf8");
      const lyrics = readManifest(v.manifestFile).props.lyrics.filter((l) => l.endFrame > l.startFrame);
      expect(srt.match(/ --> /g)?.length).toBe(lyrics.length);
      expect(srt.startsWith(`1\n${toSrt(lyrics, 30).split("\n")[1]}`)).toBe(true);
    }
  });

  it("youtube: --cover and --title give the cover layout, a full-song video, .srt, thumbnail and publish.txt", async () => {
    const cover = path.join(root, "my-cover.jpg");
    ffmpeg("-f", "lavfi", "-i", "color=c=0x7a2e4d:s=800x800", "-frames:v", "1", cover);
    const thumbs: string[] = [];
    const r = await run({
      platforms: "youtube", cover, title: "Long Song", ep: "In The Mood for Life",
      thumbnailRenderer: async (o) => {
        thumbs.push(o.props.background);
        writeFileSync(o.outFile, "jpg");
        return o.outFile;
      },
    });
    const yt = r.platforms[0];
    expect(yt.exportDir).toBe(path.join(r.exportDir, "youtube"));
    expect(readdirSync(yt.exportDir).sort()).toEqual(["publish.txt", "thumbnail.jpg", "v1.manifest.json", "v1.mp4", "v1.qa.txt", "v1.srt"]);
    const m = readManifest(yt.variations[0].manifestFile);
    expect(m.props.layout).toBe("cover");
    expect(m.props.format).toEqual({ width: 1920, height: 1080 });
    expect([m.section.start_ms, m.section.end_ms]).toEqual([0, 75_000]); // the whole song from 0:00
    expect(existsSync(path.join(wsDir, ...m.props.cover!.src.split("/")))).toBe(true); // stored with the project
    expect(existsSync(path.join(wsDir, ...m.props.cover!.backgroundSrc!.split("/")))).toBe(true); // blurred once
    expect(m.props.titleOverlay).toMatchObject({ title: "Long Song", artist: "Life Lyrics", font: "Cinzel", colour: "#E8A3B5" });
    expect(m.props.endScreen?.fromFrame).toBe(m.props.durationInFrames - 600);
    expect(m.props.nextLine).toBe(true);
    // 5g.2b: bigger lyrics, title centred over the lyrics column, drift + parallax, mood, logo.
    expect(m.props.textSize).toBe(Math.round(64 * 1.18));
    expect([m.props.titleOverlay?.left, m.props.titleOverlay?.right]).toEqual([m.props.lyricArea!.left, m.props.lyricArea!.right]);
    expect(m.props.cover?.parallax).toBe(0.3);
    expect(m.props.cover?.zoomTo).toBe(1.08);
    expect(m.props.cover?.drift).toBeDefined();
    expect(m.props.mood?.some((x) => x.kind === "hook")).toBe(true);
    expect(m.props.logo!.left).toBeGreaterThan(960); // bottom right
    expect(m.props.logo!.goneAt).toBe(m.props.endScreen!.fromFrame); // gone before the end screen
    expect(m.props.logo!.left + m.props.logo!.width).toBe(1920 - 58); // in the frame corner, 3% margin
    expect(m.props.logo!.top + m.props.logo!.height).toBe(1080 - 58);
    expect(readFileSync(yt.variations[0].qaFile, "utf8")).toContain("[ok  ] Logo in a frame corner");
    expect(m.props.fonts.some((f) => f.family === "Cinzel")).toBe(true);
    expect(thumbs).toEqual([m.props.cover!.src]);
    const publish = readFileSync(path.join(yt.exportDir, "publish.txt"), "utf8");
    expect(publish).toContain("== Title ==\nLong Song (Lyrics) - Life Lyrics");
    expect(publish).toContain("Hold on to me\nThrough the night"); // the full lyrics, without "* "
    expect(publish).not.toContain("* Hold");
    expect(publish).toContain("#LifeLyrics #LongSong");
    expect(publish).toContain('Long Song by Life Lyrics - the official lyric video.\nFrom the EP "In The Mood for Life"\n\nVerse 1 line one');
    expect(publish).toContain("== Tags ==");
    expect(existsSync(path.join(wsDir, "brand", "publish-template.txt"))).toBe(true);
    expect(readFileSync(path.join(yt.exportDir, "v1.qa.txt"), "utf8")).toContain("End-screen area clear");

    // The next run finds the stored cover and EP without --cover / --ep (both stored with the project).
    const again = await run({ platforms: "youtube", thumbnailRenderer: async (o) => (writeFileSync(o.outFile, "jpg"), o.outFile) });
    expect(readManifest(again.variations[0].manifestFile).props.layout).toBe("cover");
    expect(readFileSync(again.variations[0].publishFile!, "utf8")).toContain('the official lyric video.\nFrom the EP "In The Mood for Life"\n\nVerse 1 line one');
  });

  it("canvas: a seamless loop of whole bars, no lyrics, no text, no logo, no audio, no .srt", async () => {
    const dir = path.join(wsDir, "clips", "canvas");
    mkdirSync(dir, { recursive: true });
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "01_long.mp4"));
    makeClip(path.join(dir, "02_short.mp4"), 4, "red"); // too short for an 8 s loop
    const r = await run({ platforms: "canvas", collection: "canvas", variations: 2 });
    const c = r.platforms[0];
    expect([c.name, c.error]).toEqual(["canvas", null]);
    expect(c.exportDir).toBe(path.join(r.exportDir, "canvas"));
    expect(readdirSync(c.exportDir).sort()).toEqual(["v1.manifest.json", "v1.mp4", "v1.qa.txt"]); // one usable clip: one loop, no .srt
    const m = readManifest(c.variations[0].manifestFile);
    expect(m.props.format).toEqual({ width: 1080, height: 1920 });
    expect(m.props.durationInFrames).toBe(240); // 4 bars at 120 BPM = 8.00 s
    expect([m.section.start_ms, m.section.end_ms]).toEqual([0, 8000]);
    expect(m.props.audio).toBeNull();
    expect(m.props.lyrics).toEqual([]);
    expect(m.props.titleOverlay).toBeUndefined();
    expect(m.props.logo).toBeUndefined();
    expect(m.props.cutFrames).toEqual([]);
    expect(m.props.shots).toHaveLength(1);
    const loop = m.props.shots[0];
    expect(m.clips.map((x) => x.file)).toEqual([expect.stringContaining("01_long.mp4")]);
    expect(loop.duration).toBe(240);
    expect(loop.loopBlend).toEqual({ frames: 15, fromClipFrame: loop.clipStartFrame - 15 }); // the 0.5 s before the start
    expect(loop.clipStartFrame + 240).toBeLessThanOrEqual(loop.clipDurationFrames);
    expect(m.section.reason).toMatch(/a seamless loop of 4 bars \(8\.00 s\) at 120 BPM; strongest moment: 01_long\.mp4 from/);
    expect(r.warnings.join("\n")).toContain("canvas: only 1 clip(s) give a loop, so 1 variation(s) instead of 2");
    expect(r.warnings.join("\n")).not.toContain("canvas: canvas:");

    // Fallback 1: the 6 s clips of "mixed" cannot make 4 or 3 bars, but 2 bars at normal speed.
    const fewer = await run({ platforms: "canvas", variations: 1 });
    const fm = readManifest(fewer.variations[0].manifestFile);
    expect(fm.props.durationInFrames).toBe(120);
    expect(fm.props.shots[0]).toMatchObject({ playbackRate: 1, duration: 120 });
    expect(fewer.warnings.join("\n")).toContain(
      "canvas: fallback 1 (fewer bars): 2 bars (4.00 s) instead of 4 bars (8.00 s), because no vertical clip is long enough for 4 bars (8.00 s) (it needs 8.5 s, the longest is 6.0 s)",
    );
    expect(fm.section.reason).toContain("; fallback 1 (fewer bars)");

    // Fallback 2: a 3 s clip slowed to 0.66x fills 2 bars; the blend frames are taken at that speed too.
    const folder = (name: string) => {
      const d = path.join(wsDir, "clips", name);
      mkdirSync(d, { recursive: true });
      return d;
    };
    makeClip(path.join(folder("canvas-short"), "a.mp4"), 3, "blue");
    const slow = await run({ platforms: "canvas", collection: "canvas-short" });
    const sl = readManifest(slow.variations[0].manifestFile).props.shots[0];
    expect(sl.playbackRate).toBe(0.66);
    expect(sl.loopBlend).toEqual({ frames: 15, fromClipFrame: sl.clipStartFrame - 10 }); // 15 frames at 0.66x
    expect(sl.loopBlend!.fromClipFrame + (120 + 15) * 0.66).toBeLessThanOrEqual(sl.clipDurationFrames); // stays inside the clip
    expect(slow.warnings.join("\n")).toContain("canvas: fallback 2 (slowed down): 2 bars (4.00 s) with the clip slowed to 0.66x");

    // Fallback 3: clips too short even at 0.6x, but a vertical photo.
    makeClip(path.join(folder("canvas-photo"), "b.mp4"), 2, "red");
    copyFileSync(path.join(wsDir, "clips", "mixed", "05_portrait.jpg"), path.join(folder("canvas-photo"), "c.jpg"));
    const photo = await run({ platforms: "canvas", collection: "canvas-photo" });
    expect(readManifest(photo.variations[0].manifestFile).props.shots[0]).toMatchObject({ kind: "photo", motionLoop: true, duration: 240 });
    expect(photo.warnings.join("\n")).toContain("canvas: fallback 3 (photo): a vertical photo moving out and back");

    // Nothing usable: a clear error saying what would work.
    makeClip(path.join(folder("canvas-none"), "d.mp4"), 2, "red");
    await expect(run({ platforms: "canvas", collection: "canvas-none" })).rejects.toThrow(
      /What would work: a vertical clip of at least 2\.7 s \(or 8\.5 s for 4 bars \(8\.00 s\) at normal speed\), or a vertical photo/,
    );
    // With other platforms the run goes on, and the summary names the platform that was not made.
    const mixed = await run({ platforms: "tiktok,canvas", collection: "canvas-none", variations: 1 });
    expect(mixed.platforms.map((p) => [p.name, p.error === null])).toEqual([["tiktok", true], ["canvas", false]]);
    const summary = failureSummary(mixed)!;
    expect(summary[0]).toMatch(/^canvas was not made: canvas: no vertical clip is long enough/);
    expect(summary).toContain("Fix the cause above, then run the same command with --platforms canvas.");
    expect(summary.at(-1)).toBe("The other 1 video(s) are finished.");
  });

  it("lyric effects: brand.json (platforms.json never sets them), then --line-effect / --hook-effect; next line per platform", async () => {
    const brandFile = path.join(wsDir, "brand", "brand.json");
    const plans: MakePlan[] = [];
    const first = await run({ platforms: "reels", variations: 1, onReady: (p) => plans.push(p) });
    const brandBefore = readFileSync(brandFile, "utf8"); // created with the defaults by the first run
    const m = readManifest(first.variations[0].manifestFile);
    expect(m.props.lyricEffects).toEqual({ verse: { name: "glide", intensity: "balanced" }, hook: { name: "karaoke-highlight", intensity: "balanced" }, accent: "#E8A3B5", gap: { hideMs: 3000, leadInMs: 1000 } });
    expect(m.props.nextLine).toBe(true);
    expect(plans[0].effects).toEqual({ verse: "glide", hook: "karaoke-highlight", from: { verse: "brand.json", hook: "brand.json" }, showNextLine: true });
    expect(m.settings).toMatchObject({ line_effect: "glide", hook_effect: "karaoke-highlight", show_next_line: true });
    // Every shown line knows when it is sung and when its singing ends (from the alignment report).
    for (const l of m.props.lyrics.filter((x) => x.startFrame > 0)) {
      expect(l.stampFrame! - l.startFrame).toBeGreaterThanOrEqual(7); // the 0.25 s lead (7.5 frames, rounded)
      expect(l.stampFrame! - l.startFrame).toBeLessThanOrEqual(8);
      expect(l.sungEndFrame! - l.stampFrame!).toBe(30); // sung for 1 s
    }
    expect(readFileSync(first.variations[0].qaFile, "utf8")).toContain("[ok  ] Lyrics inside the safe zone"); // incl. the waiting next line

    // brand.json motion; a platform's old "motion" in platforms.json is ignored (format only); then the command line.
    const brand = JSON.parse(brandBefore);
    writeFileSync(brandFile, JSON.stringify({ ...brand, motion: { verseEffect: "floating:subtle", hookEffect: "word-reveal" } }));
    try {
      const fromBrand = readManifest((await run({ platforms: "reels", variations: 1 })).variations[0].manifestFile);
      expect([fromBrand.props.lyricEffects!.verse, fromBrand.props.lyricEffects!.hook]).toEqual([{ name: "floating", intensity: "subtle" }, { name: "word-reveal", intensity: "balanced" }]);
      const json = JSON.parse(readFileSync(path.join(REPO_ROOT, "presets", "platforms.json"), "utf8"));
      json.platforms.tiktok = { ...json.platforms.tiktok, motion: { verseEffect: "cinematic-fade" }, showNextLine: false };
      const file = path.join(root, "motion-presets.json");
      writeFileSync(file, JSON.stringify(json));
      const fromPlatform = await run({ platforms: "tiktok", variations: 1, presetsFile: file });
      const pm = readManifest(fromPlatform.variations[0].manifestFile);
      expect(pm.props.lyricEffects!.verse).toEqual({ name: "floating", intensity: "subtle" }); // the brand's, not the preset's cinematic-fade
      expect(pm.props.lyricEffects!.hook).toEqual({ name: "word-reveal", intensity: "balanced" });
      expect(pm.props.nextLine).toBe(false);
      const cli = readManifest((await run({ platforms: "tiktok", variations: 1, presetsFile: file, lineEffect: "soft-blur:expressive", hookEffect: "typewriter" })).variations[0].manifestFile);
      expect([cli.props.lyricEffects!.verse, cli.props.lyricEffects!.hook]).toEqual([{ name: "soft-blur", intensity: "expressive" }, { name: "typewriter", intensity: "balanced" }]);
      writeFileSync(brandFile, JSON.stringify({ ...brand, motion: { verseEffect: "spin" } }));
      await expect(run({ platforms: "reels", variations: 1 })).rejects.toThrow(/motion.verseEffect: unknown effect "spin"/);
    } finally {
      writeFileSync(brandFile, brandBefore);
    }
    await expect(run({ platforms: "reels", lineEffect: "wobble" })).rejects.toThrow(/--line-effect: unknown effect "wobble"/);
  });

  it("pnpm effects:preview: all effects side by side on 2-3 real lines, or one effect full-size in 9:16 and 16:9", async () => {
    const seen: RenderOptions[] = [];
    const renderer = async (o: RenderOptions) => {
      seen.push(o);
      writeFileSync(o.outFile, "mp4");
      return o.outFile;
    };
    // The project by title (ignoring case; an earlier test may have renamed it with --title) or by song file.
    const ws2 = openWorkspace(wsDir);
    const title = ws2.db.select().from(project).all().find((x) => /long/i.test(x.title))!.title;
    ws2.close();
    const grid = await effectsPreview({ project: title.toUpperCase(), workspaceDir: wsDir, renderer });
    expect(seen).toHaveLength(1);
    expect(seen[0].compositionId).toBe("EffectsPreview");
    expect(path.basename(grid.files[0])).toBe("effects-preview.mp4");
    expect(path.basename(grid.folder)).toMatch(/^effects-\d{4}-\d{2}-\d{2}_\d{6}$/);
    expect(grid.lines).toEqual(["Verse 1 line four", "* Hold on to me", "Through the night"]); // around the first hook
    const p = seen[0].props as unknown as EffectsPreviewProps;
    expect(p.format).toEqual({ width: 1920, height: 1080 });
    expect(p.panels.map((x) => x.label)).toEqual(EFFECTS.map((e) => e.label));
    expect(p.panels[0].note).toBe("verses · your verses");
    expect(p.panels.find((x) => x.label === "Karaoke highlight")!.note).toBe("hooks · your hooks");
    expect(p.durationInFrames).toBeLessThanOrEqual(12 * 30);
    for (const [i, panel] of p.panels.entries()) {
      expect(panel.props.lyricEffects!.verse).toEqual({ name: EFFECTS[i].name, intensity: "balanced" });
      expect(panel.props.lyricEffects!.hook).toEqual({ name: EFFECTS[i].name, intensity: "balanced" });
      expect(panel.props.lyrics.map((l) => l.text)).toEqual(["Verse 1 line four", "Hold on to me", "Through the night"]);
      expect(panel.props.shots.at(-1)!.start + panel.props.shots.at(-1)!.duration).toBe(p.durationInFrames); // clips fill the sample
    }
    expect(p.audio!.startFrame).toBe(Math.round(((900 + 3 * 2000 - 1500) * 30) / 1000)); // 1.5 s before the first line

    seen.length = 0;
    const one = await effectsPreview({ project: song, effect: "soft-blur:subtle", workspaceDir: wsDir, renderer });
    expect(one.files.map((f) => path.basename(f))).toEqual(["soft-blur-subtle-9x16.mp4", "soft-blur-subtle-16x9.mp4"]);
    expect(seen.map((o) => o.props.format)).toEqual([{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]);
    for (const o of seen) expect(o.props.lyricEffects!.verse).toEqual({ name: "soft-blur", intensity: "subtle" });

    await expect(effectsPreview({ project: "nope", workspaceDir: wsDir, renderer })).rejects.toThrow(new RegExp(`No project "nope". Projects: .*"${title}"`));
    await expect(effectsPreview({ project: title, effect: "spin", workspaceDir: wsDir, renderer })).rejects.toThrow(/--effect: unknown effect "spin"/);
  });

  it("logo: YouTube only by default; a 9:16 platform shows it only when brand.json logo.platforms lists it, in the frame corner", async () => {
    const brandFile = path.join(wsDir, "brand", "brand.json");
    const before = readFileSync(brandFile, "utf8");
    const brand = JSON.parse(before);
    expect(brand.logo.platforms).toEqual(["youtube"]); // written with the defaults
    writeFileSync(brandFile, JSON.stringify({ ...brand, logo: { ...brand.logo, platforms: ["youtube", "reels"] } }));
    try {
      const r = await run({ platforms: "reels", variations: 1 });
      const lg = readManifest(r.variations[0].manifestFile).props.logo!;
      expect([lg.left + lg.width, lg.top + lg.height]).toEqual([1080 - 32, 1920 - 32]); // bottom-right frame corner
      expect(readFileSync(r.variations[0].qaFile, "utf8")).toContain("[ok  ] Logo in a frame corner");
      writeFileSync(brandFile, JSON.stringify({ ...brand, logo: { ...brand.logo, platforms: "reels" } }));
      await expect(run({ platforms: "reels", variations: 1 })).rejects.toThrow(/logo.platforms must be a list of platform names/);
    } finally {
      writeFileSync(brandFile, before);
    }
  });

  it("--collection is remembered per project: later runs may leave it out", async () => {
    await run({ platforms: "tiktok", variations: 1, collection: "mixed" });
    const messages: string[] = [];
    const plans: MakePlan[] = [];
    const again = await run({ platforms: "tiktok", variations: 1, collection: undefined, log: (m) => messages.push(m), onReady: (p) => plans.push(p) });
    expect(messages).toContain("using collection mixed (remembered)");
    expect(plans[0].collection).toMatchObject({ name: "mixed", remembered: true });
    expect(readManifest(again.variations[0].manifestFile).settings.collection).toMatchObject({ name: "mixed" });
    // Its jobs record this process (for interrupted-run detection) and their run folder (for the studio).
    const jobs = ws.db.select({ pid: renderJob.pid, status: renderJob.status, overrides: variation.overrides_json }).from(renderJob).innerJoin(variation, eq(renderJob.variation_id, variation.id)).all();
    const mine = jobs.filter((j) => j.overrides?.run === path.relative(wsDir, again.exportDir).split(path.sep).join("/"));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((j) => j.pid === process.pid && j.status === "done")).toBe(true);
    // A project that never had one: a clear message.
    const fresh = path.join(root, "fresh-song.wav");
    makeSong(fresh, 14);
    await expect(run({ song: fresh, platforms: "tiktok", variations: 1, collection: undefined })).rejects.toThrow(/--collection <name> is needed the first time for "fresh-song"/);
  });

  it("--artist is stored with the project and picks that artist's brand folder; --ep is remembered", async () => {
    const own = path.join(wsDir, "brand", "Pômé");
    mkdirSync(own, { recursive: true });
    writeFileSync(path.join(own, "brand.json"), JSON.stringify({ accentColour: "#88AACC" }));
    try {
      const r = await run({ platforms: "reels", variations: 1, artist: "Pômé", ep: "Night Songs" });
      const m = readManifest(r.variations[0].manifestFile);
      expect(m.props.lyricEffects!.accent).toBe("#88AACC"); // brand\Pômé\brand.json
      const p = ws.db.select().from(project).where(eq(project.title, r.projectTitle)).get()!;
      expect(p.artist).toBe("Pômé");
      expect(readRecipe(songPathsById(ws, p.id).recipe).ep).toBe("Night Songs"); // song.json
    } finally {
      await run({ platforms: "reels", variations: 1, artist: "Life Lyrics" }); // back to the default for the other tests
      rmSync(own, { recursive: true, force: true });
    }
  });

  it("--resume per platform renders only what is missing in each platform folder", async () => {
    // The song folder was renamed by an earlier test (--title): its run folders moved with it.
    const now = (dir: string) => path.join(wsDir, ...resolveMoved(movesSince(readMoves(wsDir), allWhen), path.relative(wsDir, dir).split(path.sep).join("/")).split("/"));
    const allDir = now(all.exportDir);
    const tiktokDir = now(all.platforms.find((p) => p.name === "tiktok")!.exportDir);
    rmSync(path.join(tiktokDir, "v2.qa.txt"));
    // The newest run folder must be the one from the first test: remove the later ones.
    const exportsDir = path.dirname(allDir);
    for (const d of readdirSync(exportsDir)) if (path.join(exportsDir, d) !== allDir) rmSync(path.join(exportsDir, d), { recursive: true });
    rendered.length = 0;
    const resumed = await run({ platforms: "reels,tiktok,shorts", resume: true });
    expect(resumed.exportDir).toBe(allDir);
    expect(rendered).toEqual([path.relative(root, path.join(tiktokDir, "v2.mp4"))]);
  });
});

describe("stored hints and hook-only lyric changes", () => {
  const song = path.join(root, "hint-song.wav");
  const txt = path.join(root, "hint-lyrics.txt");
  const taps = path.join(root, "my-taps.lrc");
  const seen: { hint?: string; lyrics: string }[] = [];
  const recording: AlignRunner = async (a) => {
    seen.push({ hint: a.hint, lyrics: readFileSync(a.lyrics, "utf8") });
    await fakeAlign(a);
  };
  const align = (extra: Partial<Parameters<typeof ensureAlignment>[2]> = {}) =>
    findOrCreateSongProject(ws, song).then((sp) => ensureAlignment(ws, sp, { lyricsTxt: txt, durationMs: 13_000, align: recording, ...extra }));

  beforeAll(() => {
    makeSong(song, 13); // different content: its own project
    writeFileSync(txt, "First line\n* Hold on\nThird line\n");
    writeFileSync(taps, "[00:01.00]First line\n[00:02.50]Hold on\n");
  });

  it("the first --hint is stored with the project and reused automatically, also after lyrics.txt changes", async () => {
    const first = await align({ hint: taps });
    expect(first.hint).toMatchObject({ source: taps, stored: false });
    expect(seen.at(-1)?.hint).toBe(first.hint!.file);
    expect(path.dirname(first.hint!.file)).toBe(path.dirname(first.lrcFile)); // a copy in the project's lyrics folder
    const record = JSON.parse(readFileSync(path.join(path.dirname(first.lrcFile), "hint.json"), "utf8"));
    expect(record).toMatchObject({ source: taps, copy: path.basename(first.hint!.file) });

    rmSync(taps); // the original can go: the project has its own copy
    writeFileSync(txt, "First line\n* Hold on\nThird line\nA new fourth line\n");
    const logs: string[] = [];
    const again = await align({ log: (m) => logs.push(m) });
    expect(again.source).toBe("aligned"); // the words changed: aligned again ...
    expect(again.hint).toMatchObject({ source: taps, stored: true }); // ... with the stored hints
    expect(seen.at(-1)?.hint).toBe(first.hint!.file);
    expect(logs.some((l) => l.startsWith(`using stored hints from ${taps}`))).toBe(true);
    expect(again.warnings).toEqual([]);
  });

  it("--no-hint, or a lost stored copy, aligns without hints and warns clearly", async () => {
    writeFileSync(txt, "First line\n* Hold on\nThird line\nAnother fourth line\n");
    const without = await align({ noHint: true });
    expect(without.hint).toBeNull();
    expect(seen.at(-1)?.hint).toBeUndefined();
    expect(without.warnings[0]).toMatch(/normally aligns with the hints from .*my-taps\.lrc; aligning WITHOUT them \(--no-hint\)/);

    const record = JSON.parse(readFileSync(path.join(path.dirname(without.lrcFile), "hint.json"), "utf8"));
    rmSync(path.join(path.dirname(without.lrcFile), record.copy));
    writeFileSync(txt, "First line\n* Hold on\nThird line\nYet another line\n");
    const lost = await align();
    expect(lost.hint).toBeNull();
    expect(lost.warnings[0]).toMatch(/stored hints for this project \(from .*my-taps\.lrc\) are missing or changed; aligning WITHOUT hints/);
  });

  it("a change of hook markers only does not re-align; hooks follow the current lyrics.txt", async () => {
    writeFileSync(taps, "[00:01.00]First line\n");
    const base = await align({ hint: taps }); // hints stored again
    const before = seen.length;
    const lrcHash = sha256File(base.lrcFile);
    writeFileSync(txt, readFileSync(txt, "utf8").replace("* Hold on", "Hold on").replace("Third line", "* Third line"));
    const hooks = await align();
    expect(seen.length).toBe(before); // not aligned again
    expect(hooks.source).toBe("stored");
    expect(hooks.lrcFile).toBe(base.lrcFile);
    expect(hooks.lines.filter((l) => l.isHook).map((l) => l.text)).toEqual(["Third line"]); // "Hold on" is no longer a hook
    expect(sha256File(base.lrcFile)).toBe(lrcHash); // the stored LRC is untouched
  });
});

describe("YouTube cover lookup and layout fallback", () => {
  it("--cover, then the project's cover, then cover.jpg/.png next to the song; none -> null", async () => {
    const songDir = path.join(root, "cover-song");
    mkdirSync(songDir, { recursive: true });
    const song = path.join(songDir, "tune.wav");
    makeSong(song, 14);
    const sp = await findOrCreateSongProject(ws, song);
    expect(resolveCover(ws, sp.project, { songFile: song })).toBeNull();
    ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=400x400", "-frames:v", "1", path.join(songDir, "cover.png"));
    const next = resolveCover(ws, sp.project, { songFile: song })!;
    expect(next.from).toBe(path.join(songDir, "cover.png"));
    expect(next.stored).toBe(`${sp.project.folder}/cover.png`); // in the song folder
    const stored = ws.db.select().from(project).all().find((p) => p.id === sp.project.id)!;
    expect(resolveCover(ws, stored, { songFile: song })).toEqual({ stored: next.stored, from: "the project's stored cover" });
  });

  it("no cover: stills when there are horizontal photos, else clips, with a clear message", async () => {
    const song = path.join(root, "nocover.wav");
    makeSong(song, 16);
    writeFileSync(path.join(root, "nocover.txt"), "First line\n* Hold on\nThird line\n");
    const base = {
      workspaceDir: wsDir, song, lyrics: path.join(root, "nocover.txt"), align: fakeAlign, frameCheck: false, platform: "win32" as const, platforms: "youtube",
      renderer: async (o: RenderOptions) => (copyFileSync(path.join(root, "sample.mp4"), o.outFile), o.outFile),
      thumbnailRenderer: async (o: { outFile: string }) => (writeFileSync(o.outFile, "jpg"), o.outFile),
    };
    const warnings: string[] = [];
    const stills = await makeVideos({ ...base, collection: "mixed", onReady: (p) => warnings.push(...p.warnings) });
    const sm = readManifest(stills.variations[0].manifestFile);
    expect(sm.props.layout).toBe("stills");
    expect(sm.props.stills!.every((x) => x.src.endsWith(".jpg"))).toBe(true);
    expect(sm.props.grain).toBe(true);
    expect(sm.props.glow?.colour).toBe("#E8A3B5");
    expect(warnings.some((w) => w.includes("cover layout: no cover") && w.includes("using the stills layout instead"))).toBe(true);

    const clips = await makeVideos({ ...base, collection: "wide-only" });
    expect(readManifest(clips.variations[0].manifestFile).props.layout).toBe("clips");
    expect(readManifest(clips.variations[0].manifestFile).props.shots.length).toBeGreaterThan(0);
  });
});

describe("publish.txt EP line with an older template", () => {
  it("adds the EP line after the first description line when the template has no {{epLine}}", () => {
    const dir = path.join(root, "old-template-ws");
    mkdirSync(path.join(dir, "brand"), { recursive: true });
    writeFileSync(path.join(dir, "brand", "publish-template.txt"), "== Title ==\n{{song}}\n\n== Description ==\nIntro for {{song}}.\n\n{{lyrics}}\n");
    const withEp = publishText(dir, { song: "Hold On", artist: "Life Lyrics", lyricsTxt: "One\n* Two\n", year: 2026, ep: "In The Mood for Life" });
    expect(withEp.text).toBe('== Title ==\nHold On\n\n== Description ==\nIntro for Hold On.\nFrom the EP "In The Mood for Life"\n\nOne\nTwo\n');
    const without = publishText(dir, { song: "Hold On", artist: "Life Lyrics", lyricsTxt: "One\n", year: 2026 });
    expect(without.text).toBe("== Title ==\nHold On\n\n== Description ==\nIntro for Hold On.\n\nOne\n");
  });
});
