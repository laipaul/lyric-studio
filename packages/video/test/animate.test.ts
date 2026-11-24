// G2 Prepare → Pictures: the picture board, Animate (cost first, the cap, takes), the two services' requests as their
// docs describe them (21 Nov 2026), takes kept on the board (pictures\takes\), Send to Storyboard (the END of the clips),
// failures in plain words (nothing spent when nothing was sent), interrupted takes and Get result.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, resolveWorkspaceDir, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, readClipEdits, songPathsById } from "../src/node";
import { nextTakeN, removeTakes, restoreTake } from "../src/node/animate";
import { addFromLink, addPictures, phraseSeconds, readCreationDefaults, saveCreationDefaults, sourceLabel, sendToStoryboard, estimate, higgsfieldTransport, motionPrompt, picturesView, readPictures, runTakes, setMood, startAnimate, startResume, stubTransport, waveSpeedTransport } from "../src/node/animate";
import { clearFinishedGenerateTasks, listGenerateTasks, RECENT_MS } from "../src/node/generate-tasks";
import { takeFacts } from "../src/take-facts";
import { singingParts, PART_MAX_MS, PART_MIN_MS } from "../src/node/singer";
import { chooseSingingTake, infiniteTalkTransport, LIPSYNC_USD_PER_SECOND_AT, runSinging, seenSingingTake, singingPrompt, SINGING_CUE, singingPiece, singingRuns, stubSingTransport, type SingTransport } from "../src/node/singer";
import { makePlayable, update } from "../src/node/animate";
import { execFileSync } from "node:child_process";
import { probeMedia } from "@lyric/db";
import { ffmpeg, makeClip, makeSong } from "./media-helpers";
const now0 = async () => undefined;

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
    // A take as long as one phrase of the song (4 bars, rounded up to whole seconds; 4 to 30 s).
    expect(estimate("wavespeed", "standard", 2, 9)).toMatchObject({ seconds: 9, usdPerTake: 1.94, usd: 3.88 });
    const bars = (ms: number) => Array.from({ length: 20 }, (_, i) => i * ms);
    expect(phraseSeconds(bars(2072))).toBe(9); // 115.8 BPM: 4 bars = 8.3 s
    expect(phraseSeconds(bars(2000))).toBe(8); // 120 BPM: exactly 8 s
    expect(phraseSeconds(bars(500))).toBe(4); // never under the services' 4 s
    expect(phraseSeconds(bars(9000))).toBe(30); // never over 30 s
    expect(phraseSeconds([1000])).toBeNull(); // no beats yet: 5 s
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
  it("WaveSpeed with references (24 Nov 2026): Seedance 2.5 reference-to-video, the pictures in @Image order, the shape, no sound", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/reference-to-video")) return Response.json({ code: 200, data: { id: "pred-r" } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const t = waveSpeedTransport("KEY", "bytedance/seedance-2.5/image-to-video", f);
    expect(await t.submitRefs!(["https://cdn/a.png", "https://cdn/b.png"], "@Image 1 is Jennifer.", 6, "16:9")).toEqual({ id: "pred-r" });
    expect(calls[0].url).toBe("https://api.wavespeed.ai/api/v3/bytedance/seedance-2.5/reference-to-video");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ prompt: "@Image 1 is Jennifer.", reference_images: ["https://cdn/a.png", "https://cdn/b.png"], aspect_ratio: "16:9", resolution: "720p", duration: 6, generate_audio: false });
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
    expect(readCreationDefaults(wsDir)).toEqual({ service: "wavespeed", quality: "standard", takes: 3, cap: 10, length: "song" });
    expect(saveCreationDefaults(wsDir, { service: "higgsfield", quality: "standard", takes: 5, cap: 20, length: "short" })).toEqual({ service: "higgsfield", quality: "best", takes: 5, cap: 20, length: "short" });
    expect(readCreationDefaults(wsDir)).toEqual({ service: "higgsfield", quality: "best", takes: 5, cap: 20, length: "short" });
    expect(saveCreationDefaults(wsDir, { service: "x", takes: 99, cap: -1 })).toEqual({ service: "wavespeed", quality: "standard", takes: 3, cap: 10, length: "song" });
    expect(() => saveCreationDefaults(wsDir, null)).toThrow();
  });
});

describe("singing lines (lip sync, 21 Nov 2026)", () => {
  it("the vocal piece: from just before the downbeat before the line to two bars after it is sung; billed per second", () => {
    const downbeats = [0, 2000, 4000, 6000, 8000, 10000, 12000];
    expect(singingPiece({ shownMs: 4500, sungEndMs: 7000 }, downbeats, 60_000)).toEqual({ fromMs: 3500, toMs: 11_000, seconds: 8, usd: 0.48 });
    expect(singingPiece({ shownMs: 300, sungEndMs: 600 }, downbeats, 60_000).fromMs).toBe(0);
    expect(singingPiece({ shownMs: 58_000, sungEndMs: 59_500 }, [], 60_000)).toEqual({ fromMs: 55_500, toMs: 60_000, seconds: 5, usd: 0.3 });
  });
  it("the singer's little script goes to InfiniteTalk with the voice (its optional prompt)", async () => {
    const bodies: unknown[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ data: { id: "s1" } });
    }) as typeof fetch;
    const t = infiniteTalkTransport("KEY", f);
    await t.submit({ image: "https://cdn/p.png", audio: "https://cdn/v.wav", prompt: "turns to the sea, soft smile" });
    await t.submit({ image: "https://cdn/p.png", audio: "https://cdn/v.wav" });
    expect(bodies).toEqual([
      { image: "https://cdn/p.png", audio: "https://cdn/v.wav", prompt: "turns to the sea, soft smile", resolution: "720p", seed: -1 },
      { image: "https://cdn/p.png", audio: "https://cdn/v.wav", resolution: "720p", seed: -1 },
    ]);
  });
  it("every singing take asks the model to sing, not talk; Paul's script follows the cue", () => {
    expect(singingPrompt("")).toBe(SINGING_CUE);
    expect(SINGING_CUE).toMatch(/singing/);
    expect(singingPrompt("turns to the sea")).toBe(`${SINGING_CUE}. turns to the sea`);
  });
  it("lines in a row with the same picture are one take; another picture, a skipped line or a long pause starts a new one", () => {
    const l = (number: number, shownMs: number, sungEndMs: number) => ({ number, shownMs, sungEndMs });
    const lines = [l(9, 49_000, 51_000), l(10, 51_500, 54_000), l(11, 54_500, 57_000), l(12, 57_500, 60_000), l(13, 61_000, 63_000), l(15, 66_000, 68_000), l(16, 90_000, 92_000)];
    const settings = { lines: { "9": "bride.png", "10": "bride.png", "11": "bride.png", "12": "groom.png", "13": "groom.png", "15": "groom.png", "16": "groom.png" } };
    expect(singingRuns(lines, settings)).toEqual([
      { source: "bride.png", first: 9, last: 11 },
      { source: "groom.png", first: 12, last: 13 },
      { source: "groom.png", first: 15, last: 15 }, // line 14 is not ticked
      { source: "groom.png", first: 16, last: 16 }, // 22 s of music before it
    ]);
  });
  it("a singing clip comes back without sound, into Creation, the Storyboard and onto its line with its song time", async () => {
    const paths = songPathsById(ws, id);
    const now = new Date().toISOString();
    let n = 0;
    update(pics, "rain street.jpg", (p) => {
      n = p.takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
      p.takes.push({ n, kind: "lipsync", line: 2, sync_ms: 500, to_ms: 3500, service: "wavespeed", quality: "best", model: "InfiniteTalk", status: "running", started_at: now, cost_usd: 0.18, pid: process.pid });
    });
    await runSinging(open, id, [{ source: "rain street.jpg", n }], { transport: stubSingTransport("1"), sleep: now0 });
    const t = readPictures(pics).pictures["rain street.jpg"].takes.find((x) => x.n === n)!;
    expect(t.status).toBe("done");
    expect(t.file).toBe("takes/rain street sings line 2.mp4");
    const info = await probeMedia(path.join(pics, t.file!));
    expect(info.hasAudio).toBe(false);
    expect(Math.abs(info.durationMs - 3000)).toBeLessThan(200);
    expect(readClipEdits(paths.root).order?.at(-1)).toBe("rain street sings line 2.mp4");
    const recipe = JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: unknown[] };
    expect(recipe.anchors).toEqual([{ line: 2, clip: "rain street sings line 2.mp4", sync: 0.5 }]);
  });
  it("a refused request fails in plain words and nothing was spent; no line is anchored", async () => {
    const now = new Date().toISOString();
    let n = 0;
    update(pics, "rain street.jpg", (p) => {
      n = p.takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
      p.takes.push({ n, kind: "lipsync", line: 3, sync_ms: 0, to_ms: 3000, service: "wavespeed", quality: "best", model: "InfiniteTalk", status: "running", started_at: now, cost_usd: 0.18, pid: process.pid });
    });
    await runSinging(open, id, [{ source: "rain street.jpg", n }], { transport: stubSingTransport("fail"), sleep: now0 });
    const t = readPictures(pics).pictures["rain street.jpg"].takes.find((x) => x.n === n)!;
    expect([t.status, t.error]).toEqual(["failed", "stand-in: the service refused the request. Nothing was spent."]);
  });
});

describe("singing takes: retake, compare, choose (Paul, 21 Nov 2026)", () => {
  const paths = () => songPathsById(ws, id);
  const anchors = () => (JSON.parse(readFileSync(paths().recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number; through?: number }[] }).anchors ?? [];
  const omitted = (clip: string) => (readClipEdits(paths().root).clips[clip] as { omit?: boolean } | undefined)?.omit === true;
  const take = (n: number) => readPictures(pics).pictures["bride by the sea.png"].takes.find((x) => x.n === n)!;
  // A running take of lines 6-7 from the bride picture, as Make singing clips or Retake records it.
  const record = (resolution: string, toMs = 4000) => {
    let n = 0;
    update(pics, "bride by the sea.png", (p) => {
      n = p.takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
      p.takes.push({ n, kind: "lipsync", line: 6, through: 7, sync_ms: 1000, to_ms: toMs, style: 1, resolution, service: "wavespeed", quality: "best", model: "InfiniteTalk", status: "running", started_at: new Date().toISOString(), cost_usd: 0.18, pid: process.pid });
    });
    return n;
  };
  // The stand-in, remembering what each request asked for.
  const asked: { resolution?: string }[] = [];
  const spy = (): SingTransport => {
    const t = stubSingTransport("1");
    return { ...t, submit: (o) => (asked.push({ resolution: o.resolution }), t.submit(o)) };
  };
  let first = 0;
  let second = 0;

  it("the price per second follows the resolution (480p half of 720p)", () => {
    expect(LIPSYNC_USD_PER_SECOND_AT).toEqual({ "480p": 0.03, "720p": 0.06 });
    expect(singingPiece({ shownMs: 4500, sungEndMs: 7000 }, [0, 2000, 4000, 6000, 8000, 10000, 12000], 60_000, LIPSYNC_USD_PER_SECOND_AT["480p"]).usd).toBe(0.24);
  });
  it("the resolution of each take is the one sent to InfiniteTalk", async () => {
    const bodies: { resolution?: string }[] = [];
    const f = (async (_url: string, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), Response.json({ data: { id: "s1" } }))) as typeof fetch;
    await infiniteTalkTransport("KEY", f).submit({ image: "https://cdn/p.png", audio: "https://cdn/v.wav", resolution: "480p" });
    expect(bodies[0].resolution).toBe("480p");
  });
  it("the first take of a group goes onto its lines by itself", async () => {
    first = record("720p");
    await runSinging(open, id, [{ source: "bride by the sea.png", n: first }], { transport: spy(), sleep: now0 });
    expect(take(first)).toMatchObject({ status: "done", sent: "bride by the sea sings lines 6-7.mp4" });
    expect(take(first).fresh).toBeUndefined();
    expect(anchors().filter((a) => a.line === 6)).toEqual([{ line: 6, clip: "bride by the sea sings lines 6-7.mp4", sync: 1, through: 7 }]);
    expect(asked.at(-1)).toEqual({ resolution: "720p" });
  });
  it("a later take of the same lines arrives as New — compare and never replaces the take in use", async () => {
    second = record("480p", 3500);
    await runSinging(open, id, [{ source: "bride by the sea.png", n: second }], { transport: spy(), sleep: now0 });
    expect(take(second)).toMatchObject({ status: "done", fresh: true, file: "takes/bride by the sea sings lines 6-7-2.mp4" });
    expect(take(second).sent).toBeUndefined(); // not in the Storyboard until chosen
    expect(anchors().find((a) => a.line === 6)?.clip).toBe("bride by the sea sings lines 6-7.mp4");
    expect(take(first).status).toBe("done"); // the earlier take is untouched
    expect(asked.at(-1)).toEqual({ resolution: "480p" });
    const card = (await picturesView(ws, id, STUB)).pictures.find((p) => p.file === "bride by the sea.png")!.takes;
    expect([card.find((t) => t.n === first)!.inUse, card.find((t) => t.n === second)!.inUse, card.find((t) => t.n === second)!.fresh]).toEqual([true, false, true]);
  });
  it("watching a New — compare take takes its mark off", () => {
    seenSingingTake(ws, id, "bride by the sea.png", second);
    expect(take(second).fresh).toBeUndefined();
    update(pics, "bride by the sea.png", (p) => (p.takes.find((x) => x.n === second)!.fresh = true));
  });
  it("Use this take switches the lines at once (nothing made again); the take it replaces is set to Omit, and can come back", async () => {
    const made = asked.length;
    const r = await chooseSingingTake(ws, id, "bride by the sea.png", second);
    expect(r).toEqual({ clip: "bride by the sea sings lines 6-7-2.mp4", line: 6, through: 7 });
    expect(anchors().filter((a) => a.line === 6)).toEqual([{ line: 6, clip: "bride by the sea sings lines 6-7-2.mp4", sync: 1, through: 7 }]);
    expect(omitted("bride by the sea sings lines 6-7.mp4")).toBe(true);
    expect(take(second).fresh).toBeUndefined();
    expect(asked.length).toBe(made);
    await chooseSingingTake(ws, id, "bride by the sea.png", first);
    expect(anchors().find((a) => a.line === 6)?.clip).toBe("bride by the sea sings lines 6-7.mp4");
    expect([omitted("bride by the sea sings lines 6-7.mp4"), omitted("bride by the sea sings lines 6-7-2.mp4")]).toEqual([false, true]);
  });
  it("a take that is not finished cannot be chosen", async () => {
    const n = record("720p");
    await expect(chooseSingingTake(ws, id, "bride by the sea.png", n)).rejects.toThrow(/not ready yet/);
    update(pics, "bride by the sea.png", (p) => (p.takes = p.takes.filter((x) => x.n !== n)));
  });
  it("a take's facts show its resolution", () => {
    expect(takeFacts({ ...take(second), ended_at: undefined })).toMatch(/^3 s · 480p · about \$0\.18/);
  });
});

describe("the Tasks menu lists the online takes (Paul, 21 Nov 2026: 'add it to the task in the queue')", () => {
  it("every take of every song, with its song, line or picture, model, length, cost and where it lands; Clear finished hides the finished ones", () => {
    const tasks = listGenerateTasks(ws, Date.now(), () => false);
    expect(tasks.length).toBeGreaterThan(0);
    const sing = tasks.find((t) => t.kind === "singing");
    expect(sing).toMatchObject({ project_id: id, href: `/songs/${id}?tab=lyrics`, model: expect.stringMatching(/^WaveSpeed · InfiniteTalk/) });
    expect(sing!.what).toMatch(/^Singing · lines? \d+/);
    const anim = tasks.find((t) => t.kind === "animate");
    expect(anim).toMatchObject({ href: `/songs/${id}?tab=production`, seconds: expect.any(Number) });
    expect(anim!.what).toMatch(/^Animate · .+ · take \d+/);
    // Read from the song's own files: a restart of the studio keeps the list.
    expect(listGenerateTasks(ws, Date.now(), () => false).map((t) => t.id)).toEqual(tasks.map((t) => t.id));
    // A day later, finished takes leave the list by themselves; Clear finished hides them at once.
    expect(listGenerateTasks(ws, Date.now() + 2 * RECENT_MS, () => false).filter((t) => t.status !== "running")).toEqual([]);
    const cleared = clearFinishedGenerateTasks(ws);
    expect(cleared).toBe(tasks.filter((t) => t.status !== "running").length);
    expect(listGenerateTasks(ws, Date.now(), () => false).filter((t) => t.status !== "running")).toEqual([]);
  });
  it("a take's facts in plain words: length, cost (nothing when never sent), when", () => {
    const base = { started_at: "2026-11-21T13:40:00Z", ended_at: "2026-11-21T13:42:00Z", cost_usd: 1.94 };
    expect(takeFacts({ ...base, status: "done", request_id: "r", seconds: 9 }, "en-GB")).toMatch(/^9 s · about \$1\.94 · 21 Nov, \d\d:\d\d$/);
    expect(takeFacts({ ...base, status: "failed", cost_usd: 1.26, kind: "lipsync", sync_ms: 48_500, to_ms: 69_200 }, "en-GB")).toMatch(/^21 s · nothing spent · /);
    expect(takeFacts({ started_at: base.started_at, status: "running", cost_usd: 1.08 }, "en-GB")).toMatch(/^5 s · about \$1\.08 · sent 21 Nov/);
  });
});

describe("takes play in the browser (Paul, 21 Nov 2026: a real take did not play)", () => {
  const probe = (f: string) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "csv=p=0", f], { encoding: "utf8" }).trim();
  it("a take in another codec or colour format is re-made as H.264 yuv420p; an H.264 one is only copied", () => {
    const odd = path.join(root, "odd.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=160x288:r=24:d=1", "-c:v", "mpeg4", odd);
    makePlayable(odd, false);
    expect(probe(odd)).toBe("h264,yuv420p");
    const rich = path.join(root, "rich.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=160x288:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv444p", rich);
    makePlayable(rich, false);
    expect(probe(rich)).toBe("h264,yuv420p");
  });
  it("a take downloaded before this fix is made playable once when the board is read", async () => {
    const takes = path.join(pics, "takes");
    mkdirSync(takes, { recursive: true });
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=160x288:r=24:d=1", "-c:v", "mpeg4", path.join(takes, "old take.mp4"));
    update(pics, "bride by the sea.png", (p) => {
      p.takes.push({ n: 90, service: "wavespeed", quality: "standard", model: "x", status: "done", started_at: new Date().toISOString(), cost_usd: 1, file: "takes/old take.mp4" });
    });
    await picturesView(ws, id, STUB);
    expect(probe(path.join(takes, "old take.mp4"))).toBe("h264,yuv420p");
    expect(readPictures(pics).pictures["bride by the sea.png"].takes.find((t) => t.n === 90)!.playable).toBe(true);
  });
});

describe("Clean up takes (Paul, 21 Nov 2026): put aside, never deleted, with Restore", () => {
  it("puts aside failed and not-chosen takes only; in use, on a line, in the Storyboard, running or collectable stay", async () => {
    ffmpeg("-f", "lavfi", "-i", "color=c=green:s=96x160", "-frames:v", "1", path.join(root, "tidy.png"));
    await addPictures(ws, id, [{ file: path.join(root, "tidy.png"), name: "tidy.png" }]);
    mkdirSync(path.join(pics, "takes"), { recursive: true });
    for (const n of [3, 4, 5, 6, 7]) writeFileSync(path.join(pics, "takes", `tidy take ${n}.mp4`), `take ${n}`);
    const paths = songPathsById(ws, id);
    const recipe = JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: unknown[] };
    writeFileSync(paths.recipe!, JSON.stringify({ ...recipe, anchors: [...(recipe.anchors ?? []), { line: 30, clip: "tidy take 6.mp4" }, { line: 31, clip: "tidy sings 7.mp4", sync: 12 }] }));
    const at = new Date().toISOString();
    const base = { service: "wavespeed" as const, quality: "standard" as const, model: "x", started_at: at, cost_usd: 1 };
    update(pics, "tidy.png", (p) => {
      p.takes = [
        { ...base, n: 1, status: "failed", error: "no credits" },
        { ...base, n: 2, status: "interrupted", request_id: "r2" }, // still collectable
        { ...base, n: 3, status: "done", file: "takes/tidy take 3.mp4" }, // never sent: not chosen
        { ...base, n: 4, status: "done", file: "takes/tidy take 4.mp4", sent: "tidy take 4.mp4" }, // plays in the Storyboard
        { ...base, n: 5, status: "running", file: "takes/tidy take 5.mp4", pid: process.pid },
        { ...base, n: 6, status: "done", file: "takes/tidy take 6.mp4", sent: "tidy take 6.mp4" }, // on line 30
        { ...base, n: 7, kind: "lipsync", line: 31, sync_ms: 12_000, to_ms: 15_000, status: "done", file: "takes/tidy take 7.mp4", sent: "tidy sings 7.mp4" }, // in use
      ];
    });
    const card = (await picturesView(ws, id, STUB, () => true)).pictures.find((p) => p.file === "tidy.png")!;
    expect(card.cleanable).toEqual([1, 3]);
    expect(() => removeTakes(ws, id, "tidy.png", [7])).toThrow(/in use, on a line or in your Storyboard: it stays/);
    expect(() => removeTakes(ws, id, "tidy.png", [2])).toThrow(/still to collect/);
    expect(removeTakes(ws, id, "tidy.png", null)).toEqual({ removed: [1, 3] });
    const rec = readPictures(pics).pictures["tidy.png"];
    expect(rec.takes.map((t) => t.n)).toEqual([2, 4, 5, 6, 7]);
    expect(rec.removedTakes!.map((t) => [t.n, t.file])).toEqual([[1, undefined], [3, "takes/_removed/tidy take 3.mp4"]]);
    expect(existsSync(path.join(pics, "takes", "_removed", "tidy take 3.mp4"))).toBe(true);
    expect(existsSync(path.join(pics, "takes", "tidy take 3.mp4"))).toBe(false);
    const after = (await picturesView(ws, id, STUB, () => true)).pictures.find((p) => p.file === "tidy.png")!;
    expect([after.cleanable, after.removed.map((r) => [r.n, r.label])]).toEqual([[], [[1, "Take 1"], [3, "Take 3"]]]);
    // Numbers keep counting past the removed takes; Restore brings a take and its file back.
    expect(nextTakeN(rec)).toBe(8);
    expect(restoreTake(ws, id, "tidy.png", 3)).toEqual({ restored: 3 });
    const back = readPictures(pics).pictures["tidy.png"];
    expect(back.takes.find((t) => t.n === 3)!.file).toBe("takes/tidy take 3.mp4");
    expect(readFileSync(path.join(pics, "takes", "tidy take 3.mp4"), "utf8")).toBe("take 3");
    expect(back.removedTakes!.map((t) => t.n)).toEqual([1]);
  });
});

describe("long singing takes in parts of about 8 s (Joey's 4-10 s rule; Paul 22 Nov 2026)", () => {
  const downbeats = Array.from({ length: 40 }, (_, i) => i * 2000); // a bar every 2 s
  it("a piece up to 10 s stays one request; a longer one is cut on downbeats into parts of 4-10 s, pauses first", () => {
    const short = { fromMs: 1500, toMs: 10_500, seconds: 9, usd: 0.54 };
    expect(singingParts(short, downbeats, [])).toBe(short);
    // Line 32: 23 s of voice; a pause between sung lines at 15.5-16.5 s.
    const lines = [{ shownMs: 1_500, sungEndMs: 15_500 }, { shownMs: 16_500, sungEndMs: 24_000 }];
    const p = singingParts({ fromMs: 1500, toMs: 24_500, seconds: 23, usd: 1.38 }, downbeats, lines, 0.06);
    const parts = p.parts!;
    expect(parts[0].fromMs).toBe(1500);
    expect(parts.at(-1)!.toMs).toBe(24_500);
    for (let i = 1; i < parts.length; i++) expect(parts[i].fromMs).toBe(parts[i - 1].toMs); // back to back
    for (const x of parts) {
      expect(x.toMs - x.fromMs).toBeGreaterThanOrEqual(PART_MIN_MS);
      expect(x.toMs - x.fromMs).toBeLessThanOrEqual(PART_MAX_MS);
    }
    expect(parts.slice(0, -1).every((x) => downbeats.includes(x.toMs))).toBe(true); // cut on downbeats
    expect(parts.map((x) => x.toMs)).toContain(16_000); // the downbeat in the pause between the lines
    expect(p.seconds).toBe(parts.reduce((n, x) => n + Math.max(3, Math.ceil((x.toMs - x.fromMs) / 1000)), 0));
    expect(p.usd).toBe(Math.round(p.seconds * 0.06 * 100) / 100);
  });
  it("a take in parts: part 2 starts from the last frame of part 1, each is cut to its song length, joined into one silent take", async () => {
    const uploaded: string[] = [];
    const stub = stubSingTransport("1");
    const spy: SingTransport = { ...stub, upload: (f) => (uploaded.push(path.basename(f)), stub.upload(f)) };
    let n = 0;
    update(pics, "rain street.jpg", (p) => {
      n = nextTakeN(p);
      p.takes.push({ n, kind: "lipsync", line: 40, sync_ms: 0, to_ms: 3800, parts: [{ fromMs: 0, toMs: 1900 }, { fromMs: 1900, toMs: 3800 }], style: 1, service: "wavespeed", quality: "best", model: "InfiniteTalk", status: "running", started_at: new Date().toISOString(), cost_usd: 0.36, pid: process.pid });
    });
    await runSinging(open, id, [{ source: "rain street.jpg", n }], { transport: spy, sleep: now0 });
    const t = readPictures(pics).pictures["rain street.jpg"].takes.find((x) => x.n === n)!;
    expect(t.status).toBe("done");
    expect(uploaded).toEqual(["rain street.jpg", "voice-1.wav", "from-2.png", "voice-2.wav"]);
    expect(t.parts!.every((x) => !!x.request_id) && t.request_id === t.parts![0].request_id).toBe(true);
    const info = await probeMedia(path.join(pics, t.file!));
    expect(info.hasAudio).toBe(false);
    expect(Math.abs(info.durationMs - 3800)).toBeLessThan(80);
  });
});
