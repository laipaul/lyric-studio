// "pnpm make" and "pnpm rerender": collection import by content hash, project by song hash, stored
// (immutable) alignments, and a full short run with real renders, manifests, QA and a rerender.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { clip, ffmpegBin, lyricLine, openWorkspace, renderJob, seedStylePresets, variation, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensureAlignment,
  exportFolder,
  findOrCreateSongProject,
  makeVideos,
  planVariations,
  readManifest,
  renderLimit,
  rerender,
  sha256File,
  syncCollection,
  type AlignRunner,
  type MakeResult,
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
    expect(calls.at(-1)?.hint).toBe(path.join(root, "taps.lrc"));
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

  it("2 renders at a time on a 24-thread / 32 GB PC, 1 on a small one, and memory stays under half", () => {
    expect(renderLimit(24, 32)).toMatchObject({ parallel: 2, concurrency: 8 });
    expect(renderLimit(22, 32)).toMatchObject({ parallel: 2, concurrency: 8 });
    expect(renderLimit(4, 8)).toMatchObject({ parallel: 1 });
    const tight = renderLimit(32, 12, 2);
    expect(tight.parallel * (tight.concurrency * 0.5 + 1)).toBeLessThanOrEqual(6);
    expect(renderLimit(24, 32, 4).explanation).toContain("--parallel 4 is above the recommended 2");
  });

  it("export folders are named by date and time and never reused", () => {
    const now = new Date(2026, 9, 24, 9, 5);
    const a = exportFolder(ws, "p-test", now);
    const b = exportFolder(ws, "p-test", now);
    expect(path.basename(a)).toBe("2026-10-24_0905");
    expect(path.basename(b)).toBe("2026-10-24_0905-2");
  });
});

describe("pnpm make + pnpm rerender (real renders)", () => {
  let result: MakeResult;
  let lrcHash: string;
  let lrcFile: string;

  beforeAll(async () => {
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

  it("writes v1.mp4/v2.mp4 with a manifest and a QA report each, and records the jobs", () => {
    expect(readdirSync(result.exportDir).sort()).toEqual(["v1.manifest.json", "v1.mp4", "v1.qa.txt", "v2.manifest.json", "v2.mp4", "v2.qa.txt"]);
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

  it("QA reports the low-confidence line", () => {
    const qa = readFileSync(result.variations[0].qaFile, "utf8");
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

  it("rerender fails clearly when a clip has changed", async () => {
    const m = readManifest(result.variations[0].manifestFile);
    const used = path.join(wsDir, ...m.clips[0].file.split("/"));
    makeClip(used, 3, "black");
    await expect(rerender(result.variations[0].manifestFile, { workspaceDir: wsDir })).rejects.toThrow(
      new RegExp(`clip ${m.clips[0].name.replace(".", "\\.")} has changed since the render`),
    );
  });
});
