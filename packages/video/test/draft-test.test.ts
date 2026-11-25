// The one-off Draft test (25 Nov 2026): one picture -> Draft (Flash 480p), the draft upscaled twice, Full quality.
// A stand-in WaveSpeed (no network): what is sent, in which order, and the four takes it leaves in Creation.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addPictures, readPictures } from "../src/node/animate";
import { checkDraftTestPicture, draftTestUsd, runDraftTest } from "../src/node/draft-test";
import { findOrCreateSongProject, songPathsById } from "../src/node";
import { realismRules } from "../src/node/realism";
import { ffmpeg, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-drafttest-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id = "";
let video: Buffer;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "Wedding Day.wav");
  makeSong(song, 4);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  ffmpeg("-f", "lavfi", "-i", "color=c=orange:s=96x160", "-frames:v", "1", path.join(root, "bride.png"));
  await addPictures(ws, id, [{ file: path.join(root, "bride.png"), name: "bride.png" }]);
  const clip = path.join(root, "clip.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=96x160:d=1", "-r", "30", "-pix_fmt", "yuv420p", clip);
  video = readFileSync(clip);
});
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

type Call = { method: string; url: string; body?: Record<string, unknown> };
function standIn(fail?: string) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, url, body });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith("/media/uploads")) return ok({ data: { upload: { url: "https://up/put", method: "PUT" }, download_url: "https://cdn/bride.png" } });
    if (url === "https://up/put") return new Response("", { status: 200 });
    const m = /api\/v3\/(.+)$/.exec(url);
    if (method === "POST" && m) {
      if (fail && m[1].includes(fail)) return new Response(JSON.stringify({ message: "refused" }), { status: 400 });
      return ok({ data: { id: m[1].replace(/\//g, "_") } });
    }
    const r = /predictions\/(.+)\/result$/.exec(url);
    if (r) return ok({ data: { status: "completed", outputs: [`https://cdn/${r[1]}.mp4`] } });
    if (url.startsWith("https://cdn/")) return new Response(new Uint8Array(video), { status: 200 });
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

describe("draft test", () => {
  it("costs about $2.40; an unknown picture is refused with the ones that exist", () => {
    expect(draftTestUsd()).toBeCloseTo(2.39, 2);
    expect(() => checkDraftTestPicture(ws, id, "nope.png")).toThrow(/No picture "nope.png".*bride\.png/);
  });

  it("sends the draft at 480p and the full take at 720p with the realism prompt; upscales the draft's own video", async () => {
    const { f, calls } = standIn();
    const out = await runDraftTest(ws, id, "bride.png", { key: "k", f, sleep: async () => undefined, pollMs: 0 });
    expect(out.map((r) => [r.label, !!r.file, r.error])).toEqual([
      ["Draft", true, undefined],
      ["Draft upscaled", true, undefined],
      ["Draft upscaled Pro", true, undefined],
      ["Full quality", true, undefined],
    ]);
    const posts = calls.filter((c) => c.method === "POST" && c.url.includes("/api/v3/") && !c.url.endsWith("/media/uploads"));
    expect(posts).toHaveLength(4); // each sent once
    const by = (p: string) => posts.find((c) => c.url.endsWith(p))!.body!;
    expect(by("seedance-2.5-flash/image-to-video")).toMatchObject({ image: "https://cdn/bride.png", resolution: "480p", duration: 5, generate_audio: false });
    expect(by("seedance-2.5/image-to-video")).toMatchObject({ resolution: "720p", duration: 5 });
    expect(String(by("seedance-2.5/image-to-video").prompt)).toContain(realismRules("natural"));
    const draftVideo = "https://cdn/bytedance_seedance-2.5-flash_image-to-video.mp4";
    expect(by("wavespeed-ai/video-upscaler")).toEqual({ video: draftVideo, target_resolution: "1080p" });
    expect(by("wavespeed-ai/video-upscaler-pro")).toEqual({ video: draftVideo, target_resolution: "1080p" });
    const dir = path.join(songPathsById(ws, id).root, "pictures");
    const takes = readPictures(dir).pictures["bride.png"].takes;
    expect(takes.map((t) => t.label)).toEqual(expect.arrayContaining(["Draft", "Draft upscaled", "Draft upscaled Pro", "Full quality"]));
    for (const t of takes) {
      expect(t).toMatchObject({ status: "done", playable: true, feel: "natural", seconds: 5 });
      expect(existsSync(path.join(dir, t.file!))).toBe(true);
    }
    expect(takes.find((t) => t.label === "Draft")?.file).toBe("takes/bride draft.mp4");
  });

  it("a refused draft: no upscale is sent, the full take is still made", async () => {
    const { f, calls } = standIn("seedance-2.5-flash");
    const out = await runDraftTest(ws, id, "bride.png", { key: "k", f, sleep: async () => undefined, pollMs: 0 });
    expect(out.map((r) => r.label)).toEqual(["Draft", "Full quality"]);
    expect(out[0].error).toMatch(/refused/);
    expect(calls.some((c) => c.url.includes("video-upscaler"))).toBe(false);
  });
});
