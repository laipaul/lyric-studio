// The Music Video Generator as a second singing engine (28 Nov 2026, Paul: "WaveSpeed's Music Video Generator gives
// better lip sync than InfiniteTalk"): the price with its handles and the 3 s minimum, the request body as WaveSpeed's
// docs show it (one picture, the range + handles, the shape, the resolution), the take trimmed back to its song range
// and placed at its song time, the length and cut warnings, the engine choice saved per song.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, probeMedia, resolveWorkspaceDir, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, songPathsById } from "../src/node";
import { readPictures, update } from "../src/node/animate";
import { engineOf, infiniteTalkTransport, MV_SING_RULES, mvSingPiece, mvSingPrompt, mvTakeWarnings, readSinger, runSinging, setSingerAspect, setSingerEngine, setSingerResolution, setSingerScene, stubSingTransport, BREATHING, type SingTransport } from "../src/node/singer";
import { takeKind } from "../src/take-facts";
import { ffmpeg, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-mv-singer-"));
const wsDir = path.join(root, "workspace");
let ws: Workspace;
let id: string;
let pics: string;
const previousWorkspace = process.env.WORKSPACE_DIR;
const open = () => openWorkspace(resolveWorkspaceDir());
const now0 = async () => undefined;
const PIC = "bride.png";

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "MV Engine Song.wav");
  makeSong(song, 10);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  pics = path.join(songPathsById(ws, id).root, "pictures");
  mkdirSync(pics, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=144x256", "-frames:v", "1", path.join(pics, PIC));
  makeClip(path.join(pics, "singer video.mp4"), 3, "red", "144x256");
});
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

// A running MV Generator take of line `line`, song range 2.0-5.0 s, as the Singer records it.
const record = (source = PIC, line = 2) => {
  let n = 0;
  update(pics, source, (p) => {
    n = p.takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
    p.takes.push({ n, kind: "lipsync", line, sync_ms: 2000, to_ms: 5000, style: 1, prompt: "soft smile", engine: "mv", handles: { inMs: 1000, outMs: 1000 }, aspect: "9:16", scene: "morning light by the window", resolution: "720p", service: "wavespeed", quality: "best", model: "MV Generator", status: "running", started_at: new Date().toISOString(), cost_usd: 0.3, pid: process.pid });
  });
  return n;
};
const take = (n: number, source = PIC) => readPictures(pics).pictures[source].takes.find((x) => x.n === n)!;

// The stand-in, remembering each request and the voice sent; `make` replaces the returned video.
function spy(make?: (file: string) => void) {
  const asked: { o: Parameters<SingTransport["submit"]>[0]; voiceMs: number }[] = [];
  const files = new Map<string, string>();
  const base = stubSingTransport("1");
  const t: SingTransport = {
    upload: async (file) => {
      const url = await base.upload(file);
      files.set(url, file);
      return url;
    },
    submit: async (o) => {
      asked.push({ o, voiceMs: (await probeMedia(files.get(o.audio)!)).durationMs });
      return base.submit(o);
    },
    poll: base.poll,
    download: make ? async (_url, file) => make(file) : base.download,
  };
  return { t, asked };
}

describe("the price (WaveSpeed: per second of audio, rounded up, at least 3 s)", () => {
  it("counts the 1 s handles before and after; $0.03 / $0.06 / $0.12 a second at 480p / 720p / 1080p", () => {
    expect(mvSingPiece({ fromMs: 5000, toMs: 9000 }, 60_000, "720p")).toEqual({ fromMs: 5000, toMs: 9000, seconds: 6, usd: 0.36, handles: { inMs: 1000, outMs: 1000 } });
    expect(mvSingPiece({ fromMs: 5000, toMs: 15_200 }, 60_000, "1080p")).toMatchObject({ seconds: 13, usd: 1.56 });
    expect(mvSingPiece({ fromMs: 5000, toMs: 9000 }, 60_000, "480p").usd).toBe(0.18);
  });
  it("the 3 s minimum; handles never reach outside the song", () => {
    expect(mvSingPiece({ fromMs: 0, toMs: 1000 }, 60_000, "480p")).toEqual({ fromMs: 0, toMs: 1000, seconds: 3, usd: 0.09, handles: { inMs: 0, outMs: 1000 } });
    expect(mvSingPiece({ fromMs: 400, toMs: 59_700 }, 60_000, "720p").handles).toEqual({ inMs: 400, outMs: 300 });
  });
});

describe("the request (WaveSpeed's docs, 28 Nov 2026)", () => {
  it("goes to wavespeed-ai/music-video-generator with ONE picture, the voice, the prompt, the shape and the resolution", async () => {
    const sent: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init?: RequestInit) => (sent.push({ url, body: JSON.parse(String(init?.body)) }), Response.json({ data: { id: "mv1" } }))) as typeof fetch;
    const r = await infiniteTalkTransport("KEY", f).submit({ image: "https://cdn/bride.png", audio: "https://cdn/voice.wav", prompt: "P", resolution: "1080p", mv: { aspect: "9:16" } });
    expect(r).toEqual({ id: "mv1" });
    expect(sent).toEqual([{ url: "https://api.wavespeed.ai/api/v3/wavespeed-ai/music-video-generator", body: { audio: "https://cdn/voice.wav", images: ["https://cdn/bride.png"], prompt: "P", aspect_ratio: "9:16", resolution: "1080p" } }]);
  });
  it("InfiniteTalk is unchanged, and a song set to 1080p gets 720p from it", async () => {
    const sent: unknown[] = [];
    const f = (async (_url: string, init?: RequestInit) => (sent.push(JSON.parse(String(init?.body))), Response.json({ data: { id: "s1" } }))) as typeof fetch;
    await infiniteTalkTransport("KEY", f).submit({ image: "https://cdn/p.png", audio: "https://cdn/v.wav", resolution: "1080p" });
    expect(sent).toEqual([{ image: "https://cdn/p.png", audio: "https://cdn/v.wav", resolution: "720p", seed: -1 }]);
  });
  it("the prompt: the fixed rules, the take's lip prompt, then its scene", () => {
    expect(MV_SING_RULES).toBe("Keep exactly the woman, face, outfit, setting and light from the image. ONE continuous shot, no cuts, no transitions, no other people, no text.");
    expect(mvSingPrompt("A person singing", "soft morning light")).toBe(`${MV_SING_RULES} A person singing. Scene and mood: soft morning light.`);
    expect(mvSingPrompt("A person singing.", "")).toBe(`${MV_SING_RULES} A person singing.`);
  });
});

describe("a take of the MV Generator", () => {
  it("sends the range + handles as it is, comes back silent, trimmed to its range and placed at its song time", async () => {
    const n = record();
    const { t, asked } = spy();
    await runSinging(open, id, [{ source: PIC, n }], { transport: t, sleep: now0 });
    expect(take(n)).toMatchObject({ status: "done", file: "takes/bride sings line 2.mp4" });
    expect(take(n).warnings).toBeUndefined();
    expect(asked).toHaveLength(1);
    expect(Math.abs(asked[0].voiceMs - 5000)).toBeLessThan(60); // 1.0-6.0 s of the song
    expect(asked[0].o.mv).toEqual({ aspect: "9:16" });
    expect(asked[0].o.resolution).toBe("720p");
    expect(asked[0].o.prompt).toMatch(new RegExp(`^${MV_SING_RULES.replace(/[.]/g, "\\.")} .*soft smile.*Scene and mood: morning light by the window\\.$`));
    expect(asked[0].o.prompt).not.toContain(BREATHING); // the voice goes as it is
    const info = await probeMedia(path.join(pics, take(n).file!));
    expect(info.hasAudio).toBe(false);
    // Of its 1 s handles it keeps 0.4 s before and 0.3 s after (V2 -> V1 change, tracks.ts): 3.0 + 0.7 s, starting 0.4 s earlier in the song.
    expect(Math.abs(info.durationMs - 3700)).toBeLessThan(70);
    expect(take(n)).toMatchObject({ sync_ms: 1600, to_ms: 5300, kept: { inMs: 400, outMs: 300 }, handles: { inMs: 1000, outMs: 1000 } });
    const recipe = JSON.parse(readFileSync(songPathsById(ws, id).recipe!, "utf8")) as { anchors?: unknown[] };
    expect(recipe.anchors).toContainEqual({ line: 2, clip: "bride sings line 2.mp4", sync: 1.6 });
    expect(takeKind({ ...take(n) })).toBe("MV Generator singing, line 2 · 720p");
  });
  it("a video of another length than the voice sent: a warning, never stretched", async () => {
    const n = record(PIC, 3);
    const { t } = spy((file) => ffmpeg("-f", "lavfi", "-i", "color=c=white:s=144x256:r=30:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", file));
    await runSinging(open, id, [{ source: PIC, n }], { transport: t, sleep: now0 });
    expect(take(n).status).toBe("done");
    expect(take(n).warnings).toEqual(["It came back 4.00 s long for 5.00 s of voice sent: kept as it is, not stretched. Check the lips with the song, or retake."]);
    const info = await probeMedia(path.join(pics, take(n).file!));
    expect(Math.abs(info.durationMs - 3400)).toBeLessThan(70); // from 0.6 s (1 s handle, 0.4 s of it kept): 3.4 s of the 4 s are there
  });
  it("a cut the model added inside the take is said, with its time", async () => {
    const n = record(PIC, 4);
    const { t } = spy((file) => ffmpeg("-f", "lavfi", "-i", "testsrc2=s=144x256:r=30:d=2.6", "-f", "lavfi", "-i", "color=c=blue:s=144x256:r=30:d=2.4", "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", file));
    await runSinging(open, id, [{ source: PIC, n }], { transport: t, sleep: now0 });
    expect(take(n).status).toBe("done");
    expect(take(n).warnings).toHaveLength(1);
    expect(take(n).warnings![0]).toMatch(/^The model added a cut at 0:0[12]\.0: retake it/);
  });
  it("a video as the singer: refused in plain words, nothing spent", async () => {
    const n = record("singer video.mp4", 5);
    const { t, asked } = spy();
    await runSinging(open, id, [{ source: "singer video.mp4", n }], { transport: t, sleep: now0 });
    expect(asked).toHaveLength(0);
    expect([take(n, "singer video.mp4").status, take(n, "singer video.mp4").error]).toEqual(["failed", "The MV Generator needs a picture of the singer, not a video. Nothing was spent."]);
  });
  it("the warnings in plain words", () => {
    expect(mvTakeWarnings(5050, 5000, [])).toEqual([]);
    expect(mvTakeWarnings(5000, 5000, [3200])).toEqual(["The model added a cut at 0:03.2: retake it, or use the take up to there."]);
  });
});

describe("the engine choice (saved per song)", () => {
  it("a group's choice is also the song's from now on; another group keeps its own", () => {
    const dir = pics;
    setSingerEngine(ws, id, 3, "mv");
    expect(readSinger(dir)).toMatchObject({ engine: "mv", engines: { "3": "mv" } });
    expect(engineOf(readSinger(dir), 9)).toBe("mv"); // no choice of its own: the song's last one
    setSingerEngine(ws, id, 9, "infinitetalk");
    expect([engineOf(readSinger(dir), 3), engineOf(readSinger(dir), 9), engineOf(readSinger(dir), 12)]).toEqual(["mv", "infinitetalk", "infinitetalk"]);
    expect(() => setSingerEngine(ws, id, 3, "sora")).toThrow(/InfiniteTalk or MV Generator/);
  });
  it("the scene per group, the shape and 1080p are saved; wrong values are refused", () => {
    setSingerScene(ws, id, 3, "  soft   morning light ");
    setSingerAspect(ws, id, "16:9");
    setSingerResolution(ws, id, "1080p");
    expect(readSinger(pics)).toMatchObject({ scenes: { "3": "soft morning light" }, aspect: "16:9", resolution: "1080p" });
    setSingerScene(ws, id, 3, "");
    expect(readSinger(pics).scenes).toEqual({});
    expect(() => setSingerAspect(ws, id, "1:1")).toThrow(/9:16 or 16:9/);
    expect(() => setSingerResolution(ws, id, "4k")).toThrow(/480p, 720p, 1080p/);
  });
});
