// Draft takes and Make final (25 Nov 2026): a Draft is Seedance 2.5 Flash at 480p; Make final upscales that exact take
// with Video Upscaler Pro to 1080p and files it as its own take. A stand-in WaveSpeed (no network).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, resolveWorkspaceDir, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addPictures, estimate, readPictures, runTakes, startAnimate, waveSpeedTransport, type Transport } from "../src/node/animate";
import { finalUsd, runFinal, startFinal } from "../src/node/final";
import { findOrCreateSongProject, songPathsById } from "../src/node";
import { ffmpeg, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-final-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id = "";
let video: Buffer;
let dir = "";

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
  dir = path.join(songPathsById(ws, id).root, "pictures");
});
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

const KEY = { WAVESPEED_API_KEY: "k" } as NodeJS.ProcessEnv;

describe("draft takes", () => {
  it("Draft is Flash at 480p, priced at $0.108 a second; the transport asks for 480p", async () => {
    expect(estimate("wavespeed", "draft", 1, 5)).toMatchObject({ usdPerTake: 0.54, model: "Draft (cheap preview)" });
    const bodies: Record<string, unknown>[] = [];
    const f = (async (_u: string, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), new Response(JSON.stringify({ data: { id: "r" } })))) as typeof fetch;
    await waveSpeedTransport("k", "bytedance/seedance-2.5-flash/image-to-video", f, "480p").submit("https://cdn/p.png", "p", 5);
    await waveSpeedTransport("k", "x", f).submit("https://cdn/p.png", "p", 5);
    expect(bodies.map((b) => b.resolution)).toEqual(["480p", "720p"]);
  });
});

describe("make final", () => {
  it("only a finished Draft; upscales the draft's own file once; files the final; one final per draft", async () => {
    const { takes } = startAnimate(ws, id, "bride.png", { service: "wavespeed", quality: "draft", takes: 1, seconds: 5 }, KEY);
    const transport: Transport = { upload: async () => "https://cdn/p.png", submit: async () => ({ id: "d1" }), poll: async () => ({ status: "done", url: "x" }), download: async (_u, file) => writeFileSync(file, video) };
    await runTakes(() => openWorkspace(resolveWorkspaceDir()), id, "bride.png", [takes[0].n], { transport, sleep: async () => undefined });
    const draft = readPictures(dir).pictures["bride.png"].takes[0];
    expect(draft).toMatchObject({ quality: "draft", status: "done" });

    const calls: { url: string; body?: unknown }[] = [];
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const ok = (b: unknown) => new Response(JSON.stringify(b));
      if (url.endsWith("/media/uploads")) return ok({ data: { upload: { url: "https://up/put" }, download_url: "https://cdn/draft.mp4" } });
      if (url === "https://up/put") return new Response("");
      if (url.endsWith("/wavespeed-ai/video-upscaler-pro")) return ok({ data: { id: "u1" } });
      if (url.includes("/predictions/u1/result")) return ok({ data: { status: "completed", outputs: ["https://cdn/final.mp4"] } });
      if (url === "https://cdn/final.mp4") return new Response(new Uint8Array(video));
      return new Response("?", { status: 404 });
    }) as typeof fetch;

    const fin = startFinal(ws, id, "bride.png", draft.n, KEY);
    expect(fin).toMatchObject({ finalOf: draft.n, status: "running", model: "Video Upscaler Pro 1080p", cost_usd: 0.2, feel: "natural" });
    expect(() => startFinal(ws, id, "bride.png", draft.n, KEY)).toThrow(/being made/);
    await runFinal(() => openWorkspace(resolveWorkspaceDir()), id, "bride.png", fin.n, { env: KEY, f, sleep: async () => undefined, pollMs: 0 });
    const all = readPictures(dir).pictures["bride.png"].takes;
    const done = all.find((t) => t.n === fin.n)!;
    expect(done).toMatchObject({ status: "done", request_id: "u1", file: `takes/bride take ${draft.n} final.mp4` });
    expect(existsSync(path.join(dir, done.file!))).toBe(true);
    expect(all.find((t) => t.n === draft.n)?.final).toBe(fin.n);
    expect(calls.filter((c) => c.url.endsWith("video-upscaler-pro"))).toEqual([{ url: expect.any(String), body: { video: "https://cdn/draft.mp4", target_resolution: "1080p" } }]);
    expect(() => startFinal(ws, id, "bride.png", draft.n, KEY)).toThrow(/already has a final/);
    expect(() => startFinal(ws, id, "bride.png", fin.n, KEY)).toThrow(/Only a Draft/);
  });

  it("a refused upscale: the final is marked failed (nothing spent) and the draft can be made final again", async () => {
    const { takes } = startAnimate(ws, id, "bride.png", { service: "wavespeed", quality: "draft", takes: 1, seconds: 5 }, KEY);
    const transport: Transport = { upload: async () => "https://cdn/p.png", submit: async () => ({ id: "d2" }), poll: async () => ({ status: "done", url: "x" }), download: async (_u, file) => writeFileSync(file, video) };
    await runTakes(() => openWorkspace(resolveWorkspaceDir()), id, "bride.png", [takes[0].n], { transport, sleep: async () => undefined });
    const f = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/media/uploads")) return new Response(JSON.stringify({ data: { upload: { url: "https://up/put" }, download_url: "https://cdn/d.mp4" } }));
      if (url === "https://up/put") return new Response("");
      return new Response(JSON.stringify({ message: "balance too low" }), { status: 402 });
    }) as typeof fetch;
    const fin = startFinal(ws, id, "bride.png", takes[0].n, KEY);
    await runFinal(() => openWorkspace(resolveWorkspaceDir()), id, "bride.png", fin.n, { env: KEY, f });
    expect(readPictures(dir).pictures["bride.png"].takes.find((t) => t.n === fin.n)).toMatchObject({ status: "failed", error: expect.stringMatching(/top up.*Nothing was spent/) });
    expect(startFinal(ws, id, "bride.png", takes[0].n, KEY).finalOf).toBe(takes[0].n);
  });

  it("price: $0.04 a second, at least 3 s", () => {
    expect(finalUsd(5)).toBe(0.2);
    expect(finalUsd(2)).toBe(0.12);
    expect(finalUsd(5.2)).toBe(0.24);
  });
});
