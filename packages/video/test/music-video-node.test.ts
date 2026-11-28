// A music video made elsewhere, end to end (27 Nov 2026): added to Creation, found in the song, its shots, a shot used
// on its lines (a singing take locked to the song), a shot without a sung line sent to the Storyboard.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, probeMedia, project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, ensureAlignment, songPathsById } from "../src/node";
import { addPictures, picturesView, readPictures, update } from "../src/node/animate";
import { analyseMusicVideo, markStaleTakes, runMusicVideo, startMusicVideo, startMusicVideoFinals, useAllMusicVideoShots, useMusicVideoShot, withMusicVideos } from "../src/node/music-video";
import { finalUsd, runFinal, startFinal } from "../src/node/final";
import { MV_DEFAULT_WORDS, MV_PROMPT_RULES, mvPrompt, mvSection } from "../src/music-video";
import { singerContext } from "../src/node/singer";
import { fakeAlign, ffmpeg, LYRICS } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-mv-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id = "";
let pics = "";

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  // A 12 s song that never repeats (noise shaped by a slow swell), so it lines up in one place only.
  const song = path.join(root, "MV Song.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='(random(0)*2-1)*(0.4+0.3*sin(2*PI*0.37*t))':s=44100:d=12", "-ac", "2", song);
  writeFileSync(path.join(root, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  id = (await createSong(ws, { song, lyrics: path.join(root, "lyrics.txt") })).id;
  const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
  const paths = songPathsById(ws, id);
  const sp = { project: p, songFile: absPath(ws, p.audio_path!), songHash: p.audio_hash!, created: false };
  await ensureAlignment(ws, sp, { lyricsTxt: paths.lyricsTxt, durationMs: 12_000, align: fakeAlign }); // a line every 1.5 s from 1 s
  // "WaveSpeed's" music video: song 2.0-11.0 s under two shots (red 0-5 s, blue 5-9 s), re-encoded to AAC.
  const mv = path.join(root, "mv.mp4");
  ffmpeg(
    "-f", "lavfi", "-i", "color=c=red:s=160x96:r=25:d=5",
    "-f", "lavfi", "-i", "color=c=blue:s=160x96:r=25:d=4",
    "-ss", "2", "-t", "9", "-i", paths.audio!,
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,noise=alls=6:allf=t[v]",
    "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", mv,
  );
  await addPictures(ws, id, [{ file: mv, name: "WaveSpeed bride.mp4" }]);
  pics = path.join(paths.root, "pictures");
}, 120_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("a music video made elsewhere", () => {
  it("is found in the song (its sound is the song) and split into its shots", async () => {
    const mv = await analyseMusicVideo(ws, id, "WaveSpeed bride.mp4");
    expect(mv.matched).toBe(true);
    expect(Math.abs(mv.offsetMs - 2000)).toBeLessThan(30); // AAC re-encoding: within a frame
    expect(mv.score).toBeGreaterThan(0.9);
    expect(mv.shots.map((s) => [Math.round(s.fromMs / 100) / 10, Math.round(s.toMs / 100) / 10])).toEqual([
      [0, 5],
      [5, 9],
    ]);
    expect(readPictures(pics).pictures["WaveSpeed bride.mp4"].mv?.shots).toHaveLength(2);
    // Creation shows each shot with its song time and lines.
    const view = await withMusicVideos(ws, id, await picturesView(ws, id));
    const shots = view.pictures.find((p) => p.file === "WaveSpeed bride.mp4")!.mv!.shots;
    expect(shots[0].songFromMs).toBe(Math.round(mv.offsetMs));
  });

  it("a shot used on its lines is a singing take locked to the song, without sound", async () => {
    const c = await singerContext(ws, id);
    if (!c.lines) throw new Error(`no lines: ${c.why}`);
    const lines = c.lines;
    const mv = readPictures(pics).pictures["WaveSpeed bride.mp4"].mv!;
    const inShot = lines.filter((l) => l.shownMs + 500 >= mv.offsetMs + mv.shots[1].fromMs && l.shownMs + 500 < mv.offsetMs + mv.shots[1].toMs).map((l) => l.number);
    expect(inShot.length).toBeGreaterThan(0);
    const r = await useMusicVideoShot(ws, id, "WaveSpeed bride.mp4", 1);
    expect(r.placed).toBe("lines");
    expect([r.first, r.last]).toEqual([Math.min(...inShot), Math.max(...inShot)]);
    const t = readPictures(pics).pictures["WaveSpeed bride.mp4"].takes.find((x) => x.n === r.n)!;
    expect(t).toMatchObject({ kind: "lipsync", mvShot: 1, model: "WaveSpeed Music Video Generator", status: "done", cost_usd: 0 });
    expect(Math.abs(t.sync_ms! - (mv.offsetMs + 5080))).toBeLessThan(2); // its first frame: the cut + the crossfade frames left out
    const info = await probeMedia(path.join(pics, t.file!));
    expect(info.hasAudio).toBe(false);
    const recipe = JSON.parse(readFileSync(songPathsById(ws, id).recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number }[] };
    expect(recipe.anchors).toContainEqual(expect.objectContaining({ line: r.first, clip: r.clip, sync: t.sync_ms! / 1000 }));
    // Used again: the same take, not a second one.
    const again = await useMusicVideoShot(ws, id, "WaveSpeed bride.mp4", 1);
    expect(again.n).toBe(r.n);
    const view = await withMusicVideos(ws, id, await picturesView(ws, id));
    expect(view.pictures.find((p) => p.file === "WaveSpeed bride.mp4")!.mv!.shots[1].inUse).toBe(true);
  });

  it("Use every singing shot places each shot that carries sung lines", async () => {
    const r = await useAllMusicVideoShots(ws, id, "WaveSpeed bride.mp4");
    expect(r.used).toContain(1);
    // Shots 1 and 2 of the video are sung on consecutive lines and meet at the generator's own cut: they play as ONE take (one
    // singing shot, its crossfade kept), not two trimmed pieces.
    const takes = readPictures(pics).pictures["WaveSpeed bride.mp4"].takes;
    const joined = takes.find((t) => t.mvShot === 0 && t.mvShotTo === 1 && t.finalOf === undefined);
    expect(joined).toBeDefined();
    {
      const mv = readPictures(pics).pictures["WaveSpeed bride.mp4"].mv!;
      expect(Math.abs(joined!.seconds! * 1000 - (mv.shots[1].toMs - mv.shots[0].fromMs))).toBeLessThan(400); // the whole piece, nothing cut out between
    }
  });

  it("a video whose sound is another recording is not matched (it stays an ordinary video)", async () => {
    const other = path.join(root, "other.mp4");
    ffmpeg("-f", "lavfi", "-i", "color=c=green:s=160x96:r=25:d=6", "-f", "lavfi", "-i", "aevalsrc='(random(7)*2-1)*0.5':s=44100:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", other);
    await addPictures(ws, id, [{ file: other, name: "other.mp4" }]);
    const mv = await analyseMusicVideo(ws, id, "other.mp4");
    expect(mv.matched).toBe(false);
    expect(mv.shots).toEqual([]);
    await expect(useMusicVideoShot(ws, id, "other.mp4", 0)).rejects.toThrow(/Check it first/);
  });
});

describe("Make a music video (sent to WaveSpeed from the app)", () => {
  const STUB = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;
  const openWs = () => openWorkspace(wsDir);
  beforeAll(async () => {
    ffmpeg("-f", "lavfi", "-i", "color=c=white:s=96x160", "-frames:v", "1", path.join(root, "singer.png"));
    await addPictures(ws, id, [{ file: path.join(root, "singer.png"), name: "singer.png" }]);
  });

  it("the stretch: lines on bars, the whole song, the prompt with the rules and the Film look", () => {
    const lines = [{ number: 1, shownMs: 4100, sungEndMs: 6000 }, { number: 2, shownMs: 6500, sungEndMs: 9000 }];
    const downbeats = [0, 2000, 4000, 6000, 8000, 10_000, 12_000];
    expect(mvSection({ kind: "lines", first: 1, last: 2 }, lines, downbeats, 14_000)).toEqual({ fromMs: 2000, toMs: 12_000 });
    expect(mvSection({ kind: "whole" }, lines, downbeats, 14_000)).toEqual({ fromMs: 0, toMs: 14_000 });
    expect(() => mvSection({ kind: "lines", first: 2, last: 1 }, lines, downbeats, 14_000)).toThrow(/first and a last/);
    expect(mvPrompt("", "Shot on 35mm film")).toBe(`${MV_DEFAULT_WORDS} ${MV_PROMPT_RULES} Shot on 35mm film.`);
    expect(mvPrompt("  the bride sings in a garden ")).toBe(`the bride sings in a garden. ${MV_PROMPT_RULES}`);
  });

  it("refuses above the cap and without a picture, before anything is sent", async () => {
    await expect(startMusicVideo(ws, id, { pictures: [], section: { kind: "whole" }, cap: 10 }, STUB)).rejects.toThrow(/at least one picture/);
    await expect(startMusicVideo(ws, id, { pictures: ["singer.png"], section: { kind: "whole" }, resolution: "720p", cap: 0.2 }, STUB)).rejects.toThrow(/above your cap of \$0\.20.*Nothing was sent/);
    await expect(startMusicVideo(ws, id, { pictures: ["singer.png"], section: { kind: "latest" }, cap: 10 }, STUB)).rejects.toThrow(/No Reel, TikTok or Shorts video/);
    expect(readPictures(pics).pictures["singer.png"]?.takes.filter((t) => t.kind === "musicvideo") ?? []).toEqual([]);
  });

  it("the request WaveSpeed gets: the song's stretch and the pictures uploaded, then the prompt, shape and size; sent once", async () => {
    const started = await startMusicVideo(ws, id, { pictures: ["singer.png"], section: { kind: "whole" }, aspect: "9:16", resolution: "480p", words: "she sings by the sea", cap: 10 }, { WAVESPEED_API_KEY: "KEY" } as NodeJS.ProcessEnv);
    expect(started.take).toMatchObject({ kind: "musicvideo", status: "running", seconds: 12, cost_usd: 0.36, resolution: "480p", aspect: "9:16", refFiles: ["singer.png"], section: { fromMs: 0, toMs: 12_000 } });
    const calls: { url: string; body?: string }[] = [];
    const uploads: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/media/uploads")) {
        const name = JSON.parse(String(init?.body)).filename as string;
        uploads.push(name);
        return Response.json({ data: { download_url: `https://cdn/${name}`, upload: { method: "PUT", url: `https://put/${name}` } } });
      }
      if (url.startsWith("https://put/")) return new Response(null, { status: 200 });
      if (url.endsWith("/wavespeed-ai/music-video-generator")) return Response.json({ data: { id: "mv-1" } });
      if (url.includes("/predictions/mv-1/result")) return Response.json({ data: { status: "failed", error: "test stop" } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    await runMusicVideo(openWs, id, started.file, started.take.n, { env: { WAVESPEED_API_KEY: "KEY" } as NodeJS.ProcessEnv, f, sleep: async () => undefined });
    expect(uploads).toEqual(["voice.wav", "picture.png"]);
    const sent = calls.find((c) => c.url.endsWith("/wavespeed-ai/music-video-generator"))!;
    expect(JSON.parse(sent.body!)).toEqual({ audio: "https://cdn/voice.wav", images: ["https://cdn/picture.png"], prompt: mvPrompt("she sings by the sea"), aspect_ratio: "9:16", resolution: "480p" });
    expect(calls.filter((c) => c.url.endsWith("/wavespeed-ai/music-video-generator"))).toHaveLength(1);
    const t = readPictures(pics).pictures["singer.png"].takes.find((x) => x.n === started.take.n)!;
    expect(t).toMatchObject({ request_id: "mv-1", status: "interrupted" });
    expect(t.error).toMatch(/test stop.*get its result later, free/);
  });

  it("the stand-in end to end: the video lands in Creation, found in the song and split into shots", async () => {
    const started = await startMusicVideo(ws, id, { pictures: ["singer.png"], section: { kind: "lines", first: 2, last: 4 }, cap: 10 }, STUB);
    await runMusicVideo(openWs, id, started.file, started.take.n, { env: STUB });
    const t = readPictures(pics).pictures["singer.png"].takes.find((x) => x.n === started.take.n)!;
    expect(t.status).toBe("done");
    expect(t.made).toMatch(/^Music video .+\.mp4$/);
    const rec = readPictures(pics).pictures[t.made!];
    expect(rec.source).toBe("WaveSpeed music video");
    expect(rec.mv?.matched).toBe(true);
    expect(Math.abs(rec.mv!.offsetMs - t.section!.fromMs)).toBeLessThan(30);
    expect(rec.mv!.shots.length).toBeGreaterThan(0);
  });
});

describe("the shots in use made 1080p (Make final)", () => {
  const STUB = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;
  it("cost first under the cap; each final takes its draft's place on its lines, at the same song time", async () => {
    const file = "WaveSpeed bride.mp4";
    // (Use every singing shot joined shots 1 and 2 of the video, sung on consecutive lines, into one take.)
    const before = readPictures(pics).pictures[file].takes.find((t) => t.mvShotTo === 1 && t.finalOf === undefined)!;
    expect(before.quality).toBe("draft");
    expect(() => startMusicVideoFinals(ws, id, file, 0.01, (n) => startFinal(ws, id, file, n, STUB), finalUsd)).toThrow(/above your cap of \$0\.01.*Nothing was sent/);
    const r = startMusicVideoFinals(ws, id, file, 10, (n) => startFinal(ws, id, file, n, STUB), finalUsd);
    expect(r.takes.map((t) => t.finalOf)).toContain(before.n);
    for (const t of r.takes) await runFinal(() => openWorkspace(wsDir), id, file, t.n, { env: STUB });
    const fin = readPictures(pics).pictures[file].takes.find((t) => t.finalOf === before.n)!;
    expect(fin).toMatchObject({ status: "done", mvShot: 0, mvShotTo: 1, kind: "lipsync", sync_ms: before.sync_ms, line: before.line });
    const recipe = JSON.parse(readFileSync(songPathsById(ws, id).recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number }[] };
    expect(recipe.anchors?.find((a) => a.line === before.line)?.clip).toBe(fin.sent);
    const shot = (await withMusicVideos(ws, id, await picturesView(ws, id))).pictures.find((p) => p.file === file)!.mv!.shots[1];
    expect([shot.inUse, shot.hd, shot.take]).toEqual([true, "done", fin.n]);
    // Nothing left to make 1080p.
    expect(() => startMusicVideoFinals(ws, id, file, 10, (n) => startFinal(ws, id, file, n, STUB), finalUsd)).toThrow(/No shot on its lines is waiting/);
  });
});

describe("Find its shots again (28 Nov 2026)", () => {
  const file = "One shot.mp4";
  const anchorsOf = () => (JSON.parse(readFileSync(songPathsById(ws, id).recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number; through?: number }[] }).anchors ?? [];
  beforeAll(async () => {
    // The same song stretch under ONE continuous shot (the old check had split such a video in two).
    const one = path.join(root, "one.mp4");
    ffmpeg("-f", "lavfi", "-i", "color=c=green:s=160x96:r=25:d=9", "-ss", "2", "-t", "9", "-i", songPathsById(ws, id).audio!, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", one);
    await addPictures(ws, id, [{ file: one, name: file }]);
  }, 60_000);

  it("only the shots change: takes and anchors stay; a take of the old split is shown as earlier; Use on its lines of the whole shot replaces both anchors", async () => {
    const first = await analyseMusicVideo(ws, id, file);
    expect(first.shots).toHaveLength(1);
    // The old false split, written as the old check left it, and both halves used on their lines (two takes, two anchors).
    update(pics, file, (p) => {
      p.mv!.shots = [{ fromMs: 0, toMs: 4500 }, { fromMs: 4500, toMs: 9000 }];
    });
    const a = await useMusicVideoShot(ws, id, file, 0);
    const b = await useMusicVideoShot(ws, id, file, 1);
    expect(a.placed).toBe("lines");
    const before = anchorsOf();
    expect(before.filter((x) => x.clip === a.clip || x.clip === b.clip).length).toBeGreaterThan(0);
    const takesBefore = readPictures(pics).pictures[file].takes.map((t) => ({ ...t }));

    const again = await analyseMusicVideo(ws, id, file);
    expect(again.shots).toHaveLength(1);
    const rec = readPictures(pics).pictures[file];
    expect(rec.mv!.shots).toHaveLength(1);
    // Every take is kept exactly as it was (only marked as from the earlier split); the anchors are untouched.
    expect(rec.takes.map(({ mvStale: _s, ...t }) => t)).toEqual(takesBefore.map(({ mvStale: _s, ...t }) => t));
    expect(rec.takes.filter((t) => t.mvShot !== undefined).every((t) => t.mvStale)).toBe(true);
    expect(anchorsOf()).toEqual(before);
    // The panel still shows them (no crash, no shot index out of range).
    const view = (await withMusicVideos(ws, id, await picturesView(ws, id))).pictures.find((p) => p.file === file)!.mv!;
    expect(view.shots).toHaveLength(1);
    expect(view.shots[0].inUse).toBe(false);
    expect(view.earlier?.length).toBeGreaterThan(0);
    expect(view.earlier!.some((e) => e.n === a.n)).toBe(true);

    // Use on its lines: ONE new take over the whole shot, ONE anchor (through), the two old ones gone, old clips untouched.
    const r = await useMusicVideoShot(ws, id, file, 0, { hand: true });
    expect([a.n, b.n]).not.toContain(r.n);
    expect(r.last!).toBeGreaterThan(r.first!);
    const t = readPictures(pics).pictures[file].takes.find((x) => x.n === r.n)!;
    expect(t.through).toBe(r.last);
    expect(Math.abs(t.seconds! * 1000 - 9000)).toBeLessThan(400);
    const after = anchorsOf();
    const mine = after.filter((x) => x.line >= r.first! && x.line <= r.last!);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ line: r.first, through: r.last, clip: r.clip });
    expect(after.filter((x) => x.clip !== r.clip)).toEqual([]); // (an identical cut is the same clip: the Storyboard keeps one copy)
    expect(after.some((x) => x.clip === a.clip)).toBe(false);
  });

  it("a take still current after a re-check keeps counting as its shot", () => {
    const takes = [{ n: 1, mvShot: 0 }, { n: 2, mvShot: 1, mvShotTo: 2 }, { n: 3, mvShot: 3, mvStale: true }] as never[];
    markStaleTakes(takes, [{ fromMs: 0, toMs: 3000 }, { fromMs: 3000, toMs: 6000 }, { fromMs: 6000, toMs: 9000 }], [{ fromMs: 0, toMs: 3010 }, { fromMs: 3010, toMs: 6000 }, { fromMs: 6000, toMs: 9000 }]);
    expect(takes.map((t: { mvStale?: boolean }) => !!t.mvStale)).toEqual([false, false, true]);
  });
});
