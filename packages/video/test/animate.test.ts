// G2 Prepare → Pictures: the picture board, Animate (cost first, the cap, takes), the two services' requests as their
// docs describe them (21 Nov 2026), takes kept on the board (pictures\takes\), Send to Storyboard (the END of the clips),
// failures in plain words (nothing spent when nothing was sent), interrupted takes and Get result.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, resolveWorkspaceDir, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, readClipEdits, songPathsById } from "../src/node";
import { addFromLink, addPictures, readCreationDefaults, saveCreationDefaults, sourceLabel, sendToStoryboard, estimate, higgsfieldTransport, motionPrompt, picturesView, readPictures, runTakes, setMood, startAnimate, startResume, stubTransport, waveSpeedTransport } from "../src/node/animate";
import { ffmpeg, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-animate-"));
const wsDir = path.join(root, "workspace");
let ws: Workspace;
let id: string;
let pics: string;
const previousWorkspace = process.env.WORKSPACE_DIR;
const STUB = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;
const open = () => openWorkspace(resolveWorkspaceDir());
const now = async () => undefined;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "Animate Song.wav");
  makeSong(song, 4);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  mkdirSync(paths.clips!, { recursive: true });
  makeClip(path.join(paths.clips!, "01_mine.mp4"), 1, "red");
  pics = path.join(paths.root, "pictures");
  for (const [n, c] of [["bride by the sea.png", "white"], ["rain street.jpg", "blue"]] as const) ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=96x160`, "-frames:v", "1", path.join(root, n));
});
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("the picture board", () => {
  it("adds pictures under their own names; the same picture twice and non-pictures are skipped", async () => {
    writeFileSync(path.join(root, "notes.txt"), "x");
    const r = await addPictures(ws, id, [
      { file: path.join(root, "bride by the sea.png"), name: "bride by the sea.png" },
      { file: path.join(root, "rain street.jpg"), name: "rain street.jpg" },
      { file: path.join(root, "bride by the sea.png"), name: "copy.png" },
      { file: path.join(root, "notes.txt"), name: "notes.txt" },
    ]);
    expect(r.added).toEqual(["bride by the sea.png", "rain street.jpg"]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["already on the board as bride by the sea.png", "not a picture or video (.jpg, .png, .webp, .mp4, .mov, .webm)"]);
    const v = await picturesView(ws, id, {});
    expect(v.pictures.map((p) => [p.file, p.width, p.height])).toEqual([["bride by the sea.png", 96, 160], ["rain street.jpg", 96, 160]]);
    expect(v.services.map((s) => [s.id, s.ready])).toEqual([["wavespeed", false], ["higgsfield", false]]);
    expect(v.defaultTakes).toBe(3);
  });
  it("keeps a few words of mood per picture", () => {
    expect(setMood(ws, id, "bride by the sea.png", "  quiet,   longing ")).toBe("quiet, longing");
    expect(readPictures(pics).pictures["bride by the sea.png"].mood).toBe("quiet, longing");
  });
});

describe("the request", () => {
  it("the prompt: gentle motion that keeps the picture; the mood at the end; no camera jargon asked of the user", () => {
    expect(motionPrompt()).toMatch(/gentle, natural motion.*exactly as in the picture.*no text/);
    expect(motionPrompt("quiet, longing")).toMatch(/Mood: quiet, longing\.$/);
  });
  it("the cost: per take (5 s at 720p) and in total", () => {
    expect(estimate("wavespeed", "standard", 3)).toMatchObject({ seconds: 5, usdPerTake: 1.08, usd: 3.24, model: "Seedance 2.5 Flash" });
    expect(estimate("wavespeed", "best", 1)).toMatchObject({ usdPerTake: 1.62 });
    expect(estimate("higgsfield", "standard", 2).priceNote).toMatch(/estimate/);
  });
  it("WaveSpeed: upload ticket + PUT, then image-to-video without sound; polled until completed", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let polls = 0;
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/media/uploads")) return Response.json({ code: 200, data: { download_url: "https://cdn/p.png", upload: { method: "PUT", url: "https://put/here", headers: { "Content-Type": "image/png" } } } });
      if (url === "https://put/here") return new Response(null, { status: 200 });
      if (url.endsWith("/image-to-video")) return Response.json({ code: 200, data: { id: "pred-1" } });
      if (url.includes("/predictions/pred-1/result")) return Response.json({ data: ++polls < 2 ? { status: "processing" } : { status: "completed", outputs: ["https://cdn/v.mp4"] } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const t = waveSpeedTransport("KEY", "bytedance/seedance-2.5-flash/image-to-video", f);
    expect(await t.upload(path.join(pics, "bride by the sea.png"))).toBe("https://cdn/p.png");
    expect(calls[1].init?.headers).toEqual({ "Content-Type": "image/png" }); // no key on the PUT
    expect(await t.submit("https://cdn/p.png", "move")).toEqual({ id: "pred-1" });
    const sent = calls[2];
    expect(sent.url).toBe("https://api.wavespeed.ai/api/v3/bytedance/seedance-2.5-flash/image-to-video");
    expect((sent.init?.headers as Record<string, string>).Authorization).toBe("Bearer KEY");
    expect(JSON.parse(String(sent.init?.body))).toEqual({ image: "https://cdn/p.png", prompt: "move", duration: 5, resolution: "720p", generate_audio: false, output_format: "mp4" });
    expect(await t.poll("pred-1")).toEqual({ status: "running" });
    expect(await t.poll("pred-1")).toEqual({ status: "done", url: "https://cdn/v.mp4" });
  });
  it("Higgsfield: Key id:secret, image_url, no sound; status_url polled; nsfw in plain words; a bad key says where to look", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "https://api.higgsfield.ai/bytedance/seedance-2.5/image-to-video") return Response.json({ status: "queued", request_id: "r1", status_url: "https://api.higgsfield.ai/requests/r1/status" });
      if (url.endsWith("/r1/status")) return Response.json({ status: "nsfw" });
      if (url.endsWith("/r2/status")) return Response.json({ detail: "Invalid credentials" }, { status: 401 });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const t = higgsfieldTransport("id:secret", "bytedance/seedance-2.5/image-to-video", {}, f);
    expect(await t.submit("https://cdn/p.png", "move")).toEqual({ id: "r1", pollUrl: "https://api.higgsfield.ai/requests/r1/status" });
    const h = calls[0].init?.headers as Record<string, string>;
    expect(h.Authorization).toBe("Key id:secret");
    expect(h["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ image_url: "https://cdn/p.png", prompt: "move", duration: 5, resolution: "720p", generate_audio: false });
    expect(await t.poll("r1", "https://api.higgsfield.ai/requests/r1/status")).toEqual({ status: "failed", error: "Higgsfield's content check refused this picture or result" });
    await expect(t.poll("r2")).rejects.toThrow(/HTTP 401 Invalid credentials \(check the key in D:\\videomaker\\.env\)/);
    await expect(t.upload(path.join(pics, "rain street.jpg"))).rejects.toThrow(/needs the picture online first/);
  });
});

describe("animate", () => {
  it("refuses above the cap and without a key, before anything is sent", () => {
    expect(() => startAnimate(ws, id, "bride by the sea.png", { service: "wavespeed", takes: 3, capUsd: 2 }, STUB)).toThrow(/about \$3\.24, above your cap of \$2\.00.*Nothing was sent/);
    expect(() => startAnimate(ws, id, "bride by the sea.png", { service: "wavespeed", takes: 3 }, {})).toThrow(/No WAVESPEED_API_KEY in \.env/);
    expect(() => startAnimate(ws, id, "nope.png", { service: "wavespeed" }, STUB)).toThrow(/No picture nope\.png/);
    expect(readPictures(pics).pictures["bride by the sea.png"].takes).toEqual([]);
  });
  it("3 takes stay on the board (pictures\\takes\\); the Storyboard is not touched", async () => {
    const { takes, estimate: e } = startAnimate(ws, id, "bride by the sea.png", { service: "wavespeed", takes: 3 }, STUB);
    expect(takes.map((t) => [t.n, t.status, t.cost_usd])).toEqual([[1, "running", 1.08], [2, "running", 1.08], [3, "running", 1.08]]);
    expect(e.usd).toBe(3.24);
    const paths = songPathsById(ws, id);
    const before = readClipEdits(paths.root).order;
    await runTakes(open, id, "bride by the sea.png", [1, 2, 3], { env: STUB, sleep: now });
    const done = readPictures(pics).pictures["bride by the sea.png"].takes;
    expect(done.map((t) => [t.status, t.file, t.sent])).toEqual([1, 2, 3].map((n) => ["done", `takes/bride by the sea take ${n}.mp4`, undefined]));
    for (const t of done) expect(existsSync(path.join(pics, t.file!))).toBe(true);
    expect(readClipEdits(paths.root).order).toEqual(before);
    expect(existsSync(path.join(paths.clips!, "bride by the sea take 1.mp4"))).toBe(false);
    expect(existsSync(path.join(pics, "bride by the sea.png"))).toBe(true); // the picture stays as it was
    expect((await picturesView(ws, id, STUB)).spentUsd).toBe(3.24);
  });
  it("Send to Storyboard: the chosen takes and pictures join the END of the clips in the order sent, marked as sent", async () => {
    const paths = songPathsById(ws, id);
    expect(await sendToStoryboard(ws, id, "bride by the sea.png", 2)).toEqual({ clip: "bride by the sea take 2.mp4", already: false });
    expect(await sendToStoryboard(ws, id, "rain street.jpg")).toEqual({ clip: "rain street.jpg", already: false });
    expect(await sendToStoryboard(ws, id, "bride by the sea.png", 2)).toEqual({ clip: "bride by the sea take 2.mp4", already: true }); // once
    const order = readClipEdits(paths.root).order;
    expect(order.slice(-2)).toEqual(["bride by the sea take 2.mp4", "rain street.jpg"]);
    const v = await picturesView(ws, id, STUB);
    const bride = v.pictures.find((p) => p.file === "bride by the sea.png")!;
    expect(bride.takes.map((t) => t.sent ?? null)).toEqual([null, "bride by the sea take 2.mp4", null]);
    expect(v.pictures.find((p) => p.file === "rain street.jpg")!.sent).toBe("rain street.jpg");
    expect(existsSync(path.join(pics, "takes", "bride by the sea take 2.mp4"))).toBe(true); // the board keeps its copy
    await expect(sendToStoryboard(ws, id, "bride by the sea.png", 42)).rejects.toThrow(/No such take/);
  });
  it("Animate again: the next takes are numbered on (4, 5)", async () => {
    const { takes } = startAnimate(ws, id, "bride by the sea.png", { service: "wavespeed", takes: 2 }, STUB);
    expect(takes.map((t) => t.n)).toEqual([4, 5]);
    await runTakes(open, id, "bride by the sea.png", takes.map((t) => t.n), { env: STUB, sleep: now });
    expect(readPictures(pics).pictures["bride by the sea.png"].takes.map((t) => t.file)).toContain("takes/bride by the sea take 5.mp4");
  });
  it("a refused request fails in plain words; nothing was spent", async () => {
    const { takes } = startAnimate(ws, id, "rain street.jpg", { service: "higgsfield", takes: 1 }, { LYRIC_GENERATE_STUB: "fail" });
    await runTakes(open, id, "rain street.jpg", takes.map((t) => t.n), { env: { LYRIC_GENERATE_STUB: "fail" }, sleep: now });
    const t = readPictures(pics).pictures["rain street.jpg"].takes[0];
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/refused the request\. Nothing was spent\./);
    expect(t.request_id).toBeUndefined();
  });
  it("a take sent but not back (the studio stopped) is interrupted; Get result fetches it without sending again", async () => {
    const stub = stubTransport("1");
    let submits = 0;
    const counting = { ...stub, submit: async (u: string, p: string) => (submits++, stub.submit(u, p)) };
    const { takes } = startAnimate(ws, id, "rain street.jpg", { service: "wavespeed", takes: 1 }, STUB);
    // The studio "stops" after the request was sent: the take keeps its request id and an old process id.
    await runTakes(open, id, "rain street.jpg", [takes[0].n], { env: STUB, transport: { ...counting, poll: async () => ({ status: "running" }) }, sleep: now, timeoutMs: -1 });
    const sent = readPictures(pics).pictures["rain street.jpg"].takes.find((t) => t.n === takes[0].n)!;
    expect(sent.status).toBe("interrupted");
    expect(sent.request_id).toBeTruthy();
    expect(submits).toBe(1);
    startResume(ws, id, "rain street.jpg", sent.n);
    await runTakes(open, id, "rain street.jpg", [sent.n], { env: STUB, transport: counting, sleep: now });
    const back = readPictures(pics).pictures["rain street.jpg"].takes.find((t) => t.n === sent.n)!;
    expect(submits).toBe(1); // not sent again
    expect([back.status, back.file]).toEqual(["done", `takes/rain street take ${sent.n}.mp4`]);
    expect(() => startResume(ws, id, "rain street.jpg", sent.n)).toThrow(/already finished/);
  });
  it("a take left running by a studio that is gone shows as interrupted", async () => {
    const f = path.join(pics, "pictures.json");
    const all = JSON.parse(readFileSync(f, "utf8"));
    all.pictures["rain street.jpg"].takes.push({ n: 99, service: "wavespeed", quality: "standard", model: "x", status: "running", started_at: new Date().toISOString(), cost_usd: 1.08, pid: 999999 });
    writeFileSync(f, JSON.stringify(all));
    const v = await picturesView(ws, id, STUB, () => false);
    const t = v.pictures.find((p) => p.file === "rain street.jpg")!.takes.find((x) => x.n === 99)!;
    expect(t.status).toBe("interrupted");
    expect(t.error).toMatch(/before this take was sent: nothing was spent/);
  });
});

describe("Creation takes anything, from anywhere (Paul, 21 Nov 2026)", () => {
  const MJ = "paul_bride_walks_0b1c2d3e-1111-2222-3333-444455556666_0.mp4";
  it("labels where a file came from: Midjourney by its download name, else Added by you, or the link's site", () => {
    expect(sourceLabel(MJ)).toBe("Midjourney");
    expect(sourceLabel("midjourney sunset.png")).toBe("Midjourney");
    expect(sourceLabel("my sunset.png")).toBe("Added by you");
    expect(sourceLabel("x.png", "From higgsfield.ai")).toBe("From higgsfield.ai");
  });
  it("a Midjourney video added by hand keeps its name, cannot be animated, and can be sent to the Storyboard", async () => {
    makeClip(path.join(root, MJ), 1, "green");
    expect((await addPictures(ws, id, [{ file: path.join(root, MJ), name: MJ }])).added).toEqual([MJ]);
    const v = (await picturesView(ws, id, STUB)).pictures.find((p) => p.file === MJ)!;
    expect([v.kind, v.source]).toEqual(["video", "Midjourney"]);
    expect(() => startAnimate(ws, id, MJ, { service: "wavespeed" }, STUB)).toThrow(/already a video: only a picture can be animated/);
    const r = await sendToStoryboard(ws, id, MJ);
    expect(r.clip).toBe(MJ);
    expect(readClipEdits(songPathsById(ws, id).root).order?.at(-1)).toBe(MJ);
  });
  it("Add from a link: downloads a picture once, labelled with its site; a dead link says what to do", async () => {
    // a different picture than the ones on the board
    ffmpeg("-f", "lavfi", "-i", "color=c=orange:s=96x160", "-frames:v", "1", path.join(root, "orange.png"));
    const png = readFileSync(path.join(root, "orange.png"));
    const fake = (async () => new Response(png, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    const r = await addFromLink(ws, id, "https://www.example.com/files/get?id=42", fake);
    expect(r.added).toEqual(["get.png"]);
    expect((await picturesView(ws, id, STUB)).pictures.find((p) => p.file === "get.png")!.source).toBe("From example.com");
    const gone = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    await expect(addFromLink(ws, id, "https://cdn.example.com/a.png", gone)).rejects.toThrow(/answered 403.*drop it here/);
    await expect(addFromLink(ws, id, "not a link", gone)).rejects.toThrow(/full link/);
  });
  it("Paul's defaults (model, takes, cap) are saved for every song; bad values fall back to safe ones", () => {
    expect(readCreationDefaults(wsDir)).toEqual({ service: "wavespeed", quality: "standard", takes: 3, cap: 10 });
    expect(saveCreationDefaults(wsDir, { service: "higgsfield", quality: "standard", takes: 5, cap: 20 })).toEqual({ service: "higgsfield", quality: "best", takes: 5, cap: 20 });
    expect(readCreationDefaults(wsDir)).toEqual({ service: "higgsfield", quality: "best", takes: 5, cap: 20 });
    expect(saveCreationDefaults(wsDir, { service: "x", takes: 99, cap: -1 })).toEqual({ service: "wavespeed", quality: "standard", takes: 3, cap: 10 });
    expect(() => saveCreationDefaults(wsDir, null)).toThrow();
  });
});
