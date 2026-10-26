// Step 6.2a: the song's videos from its export folders (also command-line runs), QA reasons,
// interrupted jobs, marks, captions per artist and platform, poster frames.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, openWorkspace, project, renderJob, variation, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captionTemplate,
  fillCaption,
  firstHookLine,
  makeOwnCaptionTemplate,
  markInterruptedJobs,
  parseQaReport,
  platformState,
  postingPack,
  resumeCommandFor,
  setVideoMark,
  songCard,
  songRuns,
  videoPoster,
} from "../src/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-exports-"));
let ws: Workspace;
let projectId: string;
const QA_WARN = `long-song - TikTok v2: Bold, shuffle (seed 2)
QA: WARN

[ok  ] Lyric timing confidence
[WARN] Clips repeated within 3 shots
       shot 4 repeats 02_b.mp4 (also shot 2)
       shot 7 repeats 01_a.mp4 (also shot 5)
[ok  ] Black or frozen frames

Summary: WARN - Clips repeated within 3 shots
`;
const QA_PASS = "x\nQA: PASS\n\n[ok  ] Lyric timing confidence\n\nSummary: PASS\n";

function video(dir: string, n: number, qa: string, extra: Record<string, unknown> = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `v${n}.mp4`), "mp4");
  writeFileSync(path.join(dir, `v${n}.qa.txt`), qa);
  writeFileSync(path.join(dir, `v${n}.srt`), "1\n");
  writeFileSync(
    path.join(dir, `v${n}.manifest.json`),
    JSON.stringify({
      manifest_version: 1,
      created_at: "2026-10-25T10:00:00.000Z",
      command: 'pnpm make "D:\\videomaker\\workspace\\test\\song.wav" lyrics.txt --collection wedding --platforms reels,tiktok',
      variation: { index: n, name: `v${n}`, order: n === 1 ? "story" : "shuffle", seed: n, style: n % 2 ? "Simple" : "Bold", cinematic_bars: n % 2 === 0 },
      settings: { line_effect: "glide", hook_effect: "karaoke-highlight" },
      output: { file: `v${n}.mp4`, duration_s: 31.6, qa: `v${n}.qa.txt` },
      props: { layout: "vertical" },
      ...extra,
    }),
  );
}

beforeAll(() => {
  ws = openWorkspace(path.join(root, "workspace"));
  projectId = ws.db.insert(project).values({ title: "Hold On", artist: "Pômé" }).returning().get().id;
  const ex = path.join(ws.dir, "projects", projectId, "exports");
  // A complete run (reels PASS, tiktok with a WARN) ...
  video(path.join(ex, "2026-10-25_1000", "reels"), 1, QA_PASS);
  video(path.join(ex, "2026-10-25_1000", "tiktok"), 1, QA_PASS);
  video(path.join(ex, "2026-10-25_1000", "tiktok"), 2, QA_WARN);
  // ... and an interrupted one: v2 never finished; its job's process is gone.
  video(path.join(ex, "2026-10-26_0900", "reels"), 1, QA_PASS);
  writeFileSync(path.join(ex, "2026-10-26_0900", "reels", "v2.mp4"), "partial");
  writeFileSync(path.join(ex, "2026-10-26_0900", "song.lrc"), "[00:01.00]x\n");
  for (const [status, pid, seed] of [["done", 4242, 1], ["rendering", 4242, 2]] as const) {
    const v = ws.db.insert(variation).values({ project_id: projectId, seed, cut_rate: "1x", text_size: 64, colour: "#fff", cinematic_bars: false, overrides_json: { platform: "reels", run: `projects/${projectId}/exports/2026-10-26_0900` } }).returning().get();
    ws.db.insert(renderJob).values({ variation_id: v.id, status, pid }).run();
  }
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("QA reports", () => {
  it("reads every warning with its details, and the summary", () => {
    expect(parseQaReport(QA_WARN)).toEqual({
      status: "WARN",
      problems: [{ check: "Clips repeated within 3 shots", details: ["shot 4 repeats 02_b.mp4 (also shot 2)", "shot 7 repeats 01_a.mp4 (also shot 5)"] }],
    });
    expect(parseQaReport(QA_PASS)).toEqual({ status: "PASS", problems: [] });
  });
});

describe("interrupted jobs", () => {
  it("queued / rendering jobs whose process is gone (or unknown, from before) become interrupted; living ones stay", () => {
    const v = ws.db.insert(variation).values({ project_id: projectId, seed: 9, cut_rate: "1x", text_size: 64, colour: "#fff", cinematic_bars: false, overrides_json: { platform: "shorts" } }).returning().get();
    const alive = ws.db.insert(renderJob).values({ variation_id: v.id, status: "rendering", pid: process.pid }).returning().get();
    const old = ws.db.insert(renderJob).values({ variation_id: v.id, status: "queued" }).returning().get(); // no pid: before 6.2a
    expect(markInterruptedJobs(ws, (pid) => pid === process.pid)).toBe(2); // the reels job (4242) + the old one
    const status = (id: string) => ws.db.select().from(renderJob).where(eq(renderJob.id, id)).get()!;
    expect(status(alive.id).status).toBe("rendering");
    expect(status(old.id)).toMatchObject({ status: "interrupted", error: expect.stringContaining("interrupted") });
    expect(markInterruptedJobs(ws, () => true)).toBe(0); // nothing left to mark
    ws.db.delete(renderJob).where(eq(renderJob.id, alive.id)).run();
  });

  it("the resume command is the run's own command plus --resume", () => {
    expect(resumeCommandFor("pnpm make a.wav b.txt --platforms reels")).toBe("pnpm make a.wav b.txt --platforms reels --resume");
    expect(resumeCommandFor("pnpm make a.wav b.txt --resume")).toBe("pnpm make a.wav b.txt --resume");
    expect(resumeCommandFor(null)).toBeNull();
  });
});

describe("song runs (also from the command line)", () => {
  it("every run with its platforms and videos: files, settings, QA, marks; interrupted platforms", () => {
    const runs = songRuns(ws, projectId);
    expect(runs.map((r) => r.folder)).toEqual(["2026-10-25_1000", "2026-10-26_0900"]);
    const [first, second] = runs;
    expect(first.platforms.map((p) => [p.name, p.videos.length])).toEqual([["reels", 1], ["tiktok", 2]]);
    const v2 = first.platforms[1].videos[1];
    expect(v2).toMatchObject({
      id: `projects/${projectId}/exports/2026-10-25_1000/tiktok/v2.manifest.json`,
      mp4: `projects/${projectId}/exports/2026-10-25_1000/tiktok/v2.mp4`,
      srt: `projects/${projectId}/exports/2026-10-25_1000/tiktok/v2.srt`,
      label: "TikTok",
      style: "Bold",
      order: "shuffle",
      seed: 2,
      bars: true,
      effects: { verse: "glide", hook: "karaoke-highlight" },
      durationS: 31.6,
      mark: { favourite: false, status: "generated" },
    });
    expect(v2.qa.problems[0].check).toBe("Clips repeated within 3 shots");
    expect(second.platforms).toHaveLength(1);
    expect(second.platforms[0]).toMatchObject({ name: "reels", missing: ["v2"], interrupted: true });
    expect(second.resumeCommand).toMatch(/--collection wedding --platforms reels,tiktok --resume$/);
  });

  it("platform state: interrupted > FAILED > WARN > PASS, with the reasons per video", () => {
    const runs = songRuns(ws, projectId);
    expect(platformState(runs[0].platforms[1])).toEqual({
      status: "WARN",
      details: ["v2: Clips repeated within 3 shots (shot 4 repeats 02_b.mp4 (also shot 2); shot 7 repeats 01_a.mp4 (also shot 5))"],
    });
    expect(platformState(runs[1].platforms[0])).toEqual({ status: "interrupted", details: ["v2 not finished: the run was stopped"] });
    expect(platformState({ ...runs[1].platforms[0], interrupted: false })).toEqual({ status: "FAILED", details: ["v2 not finished"] });
    const card = songCard(ws, ws.db.select().from(project).where(eq(project.id, projectId)).get()!);
    const by = Object.fromEntries(card.platforms.map((p) => [p.name, p]));
    expect(by.reels).toMatchObject({ status: "interrupted", videos: 1, resumeCommand: expect.stringContaining("--resume") });
    expect(by.tiktok).toMatchObject({ status: "WARN", videos: 2, details: [expect.stringContaining("v2: Clips repeated")] });
  });

  it("marks: favourite, approved, discarded (hidden, counted out), back to generated; only this song's videos", () => {
    const id = `projects/${projectId}/exports/2026-10-25_1000/tiktok/v1.manifest.json`;
    expect(setVideoMark(ws, projectId, id, { favourite: true })).toEqual({ favourite: true, status: "generated" });
    expect(setVideoMark(ws, projectId, id, { status: "approved" })).toEqual({ favourite: true, status: "approved" });
    expect(songRuns(ws, projectId)[0].platforms[1].videos[0].mark).toEqual({ favourite: true, status: "approved" });
    setVideoMark(ws, projectId, id, { status: "discarded" });
    expect(existsSync(path.join(ws.dir, ...id.replace(".manifest.json", ".mp4").split("/")))).toBe(true); // never deleted
    const card = songCard(ws, ws.db.select().from(project).where(eq(project.id, projectId)).get()!);
    expect(card.platforms.find((p) => p.name === "tiktok")!.videos).toBe(1);
    setVideoMark(ws, projectId, id, { status: "generated" });
    expect(() => setVideoMark(ws, projectId, "studio.db", { favourite: true })).toThrow(/Not a video of this song/);
    expect(() => setVideoMark(ws, "other", id, { favourite: true })).toThrow(/Not a video of this song/);
  });
});

describe("captions per artist and platform", () => {
  it("default templates in brand\\ (English), the artist's own in brand\\<artist>\\ wins", () => {
    const t = captionTemplate(ws.dir, "Pômé", "reels");
    expect(t).toMatchObject({ file: path.join(ws.dir, "brand", "publish-reels.txt"), own: false, created: true });
    const own = makeOwnCaptionTemplate(ws.dir, "Pômé", "reels");
    expect(own).toBe(path.join(ws.dir, "brand", "Pômé", "publish-reels.txt"));
    writeFileSync(own, "== Caption ==\n{{hook}}\n{{song}} par {{artist}}\nExtrait de l'EP « {{ep}} »\n\n== Hashtags ==\n#{{artistTag}} #{{songTag}} #paroles\n");
    expect(captionTemplate(ws.dir, "Pômé", "reels")).toMatchObject({ file: own, own: true });
    expect(captionTemplate(ws.dir, "Life Lyrics", "reels").file).toBe(path.join(ws.dir, "brand", "publish-reels.txt"));
  });

  it("fills the placeholders; lines of missing values disappear; notes are left out, hashtags kept", () => {
    const tpl = readFileSync(path.join(ws.dir, "brand", "publish-tiktok.txt").replace("tiktok", "reels"), "utf8");
    expect(fillCaption(tpl, { song: "Hold On", artist: "Life Lyrics", ep: "In The Mood for Life", hook: "Hold on to me", year: 2026 })).toEqual({
      Caption: 'Hold on to me\nHold On by Life Lyrics\nFrom the EP "In The Mood for Life"\nFull song on Spotify (link in bio).',
      Hashtags: "#LifeLyrics #HoldOn #lyrics #lyricvideo #reels #newmusic",
    });
    expect(fillCaption(tpl, { song: "Hold On", artist: "Life Lyrics", year: 2026 }).Caption).toBe("Hold On by Life Lyrics\nFull song on Spotify (link in bio).");
    expect(firstHookLine("Verse\n* Hold on to me\n* Again\n")).toBe("Hold on to me");
  });

  it("posting pack: the artist's caption (French for Pômé), YouTube's publish.txt sections, nothing for Canvas", () => {
    const fr = postingPack(ws, { platform: "reels", artist: "Pômé", song: "Tiens-moi", ep: "Nuits", hook: "Tiens-moi fort" });
    expect(fr).toMatchObject({ kind: "caption", template: { own: true, relative: "brand/Pômé/publish-reels.txt" } });
    expect(fr.sections).toEqual({ Caption: "Tiens-moi fort\nTiens-moi par Pômé\nExtrait de l'EP « Nuits »", Hashtags: "#Pômé #Tiensmoi #paroles" });
    const publish = path.join(root, "publish.txt");
    writeFileSync(publish, "== Title ==\nHold On (Lyrics) - Life Lyrics\n\n== Description ==\nLine 1\nLine 2\n\n== Tags ==\nhold on, lyrics\n");
    expect(postingPack(ws, { platform: "youtube", artist: "Life Lyrics", song: "Hold On", publishFile: publish }).sections).toEqual({
      Title: "Hold On (Lyrics) - Life Lyrics",
      Description: "Line 1\nLine 2",
      Tags: "hold on, lyrics",
    });
    expect(postingPack(ws, { platform: "canvas", artist: "Pômé", song: "x" })).toMatchObject({ kind: "none", sections: {} });
  });
});

describe("poster frames", () => {
  it("one JPEG per video, made once and cached", async () => {
    const dir = path.join(ws.dir, "projects", projectId, "exports", "2026-10-25_1000", "reels");
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=3", "-pix_fmt", "yuv420p", path.join(dir, "v1.mp4")]);
    const rel = `projects/${projectId}/exports/2026-10-25_1000/reels/v1.mp4`;
    const a = await videoPoster(ws, rel);
    expect(readFileSync(a).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG
    expect(await videoPoster(ws, rel)).toBe(a);
  });
});

describe("the studio serves only export files and covers", async () => {
  const { allowedFile, TEMPLATE_FILE, VIDEO_FILE } = await import("../../../apps/studio/src/lib/files");
  const id = "0b5c6c1e-1b7e-4a4e-9a3e-2f1a6c3d7e90";
  it("videos, captions, thumbnails, publish texts, LRC and covers; never the database or other files", () => {
    for (const ok of [
      `projects/${id}/exports/2026-10-25_1751/reels/v1.mp4`,
      `projects/${id}/exports/2026-10-25_1751/v2.srt`,
      `projects/${id}/exports/2026-10-25_1751-2/youtube/thumbnail.jpg`,
      `projects/${id}/exports/2026-10-25_1751/youtube/publish.txt`,
      `projects/${id}/exports/2026-10-25_1751/Hold On.lrc`,
      `projects/${id}/audio/cover.png`,
    ])
      expect(allowedFile(ok), ok).toBe(true);
    for (const bad of ["studio.db", `projects/${id}/audio/song.wav`, `projects/${id}/exports/2026-10-25_1751/../../../studio.db`, `projects/${id}/settings.json`, "brand/brand.json", `projects/${id}/exports/effects-2026/x.mp4`])
      expect(allowedFile(bad), bad).toBe(false);
    expect(VIDEO_FILE.test(`projects/${id}/exports/2026-10-25_1751/reels/v1.srt`)).toBe(false);
    expect(TEMPLATE_FILE.test("brand/Pômé/publish-reels.txt")).toBe(true);
    expect(TEMPLATE_FILE.test("brand/brand.json")).toBe(false);
  });
});

describe("a resumed run is no longer interrupted", () => {
  it("interrupted / failed jobs count only until a later job makes the same video (same seed)", async () => {
    const { unresolvedJobs } = await import("../src/node");
    const jobs = [
      { status: "done", seed: 1 },
      { status: "interrupted", seed: 2 },
      { status: "failed", seed: 3 },
    ];
    expect(unresolvedJobs(jobs).map((j) => j.seed)).toEqual([2, 3]);
    expect(unresolvedJobs([...jobs, { status: "done", seed: 2 }]).map((j) => j.seed)).toEqual([3]); // Resume made v2
  });
});
