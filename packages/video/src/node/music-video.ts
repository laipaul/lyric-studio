// A music video made elsewhere, in Creation (27 Nov 2026, Paul: WaveSpeed's Music Video Generator made "the same bride
// singing in different scenes and camera angles", lips in time with the song). "This is a music video of this song":
//   1. its sound is matched against the song file (both only read): where in the song it starts, to the sample;
//   2. its shots are found (FFmpeg's scene score; the generator's short crossfades);
//   3. each shot shows the lines it carries; "Use on its lines" cuts that shot out (without sound) as a singing take
//      of the video and places it on its lines locked to the song, exactly like a Lyrics Sync singing take (anchors with
//      "sync"); a shot with no sung line goes to the Storyboard as a story clip.
// Saved in pictures.json on the video (mv: MusicVideoRecord); each shot used is a take (mvShot = its number).
// The video's own sound is never kept in any take, clip or output: the video's audio stays the song, as always.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, probeMedia, uniqueFileName, type Workspace } from "@lyric/db";

import { detectCuts, findInSong, linesOfShot, MATCH_MIN, DRIFT_MAX_MS, MV_GENERATOR_PATH, MV_MAX_MS, MV_MAX_PICTURES, MV_MIN_MS, MV_MODEL, MV_USD_PER_SECOND, mvPrompt, mvResolution, mvSection, mvUsd, shotPiece, shotsFromCuts, type MusicVideoRecord, type MvSectionChoice, type MvView } from "../music-video";
import { BOARD_VIDEO_FILE, data, json, keyFor, nextTakeN, PICTURE_FILE, POLL_MS, readPictures, sendToStoryboard, setTake, songFolder, TAKES_DIR, update, WAVESPEED, waveSpeedTransport, waveSpeedUpload, type PicturesView, type Take } from "./animate";
import { errorText } from "./characters/fal";
import { filmLookFor } from "./film-looks";
import { readRecipe } from "./recipe";
import { songPathsById } from "./song-folder";
import { placeSingingTake, singerContext, singingTakeInUse } from "./singer";

export const MV_RATE = 8000; // Hz: enough to line two copies of the same recording up to 1/8000 s

// Mono samples of a file's sound (FFmpeg decodes; the file is only read).
export function decodeMono(file: string, rate = MV_RATE): Float32Array {
  const buf = execFileSync(ffmpegBin(), ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 30, windowsHide: true });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

// FFmpeg's scene-change score of every frame (small frames: quick).
export function sceneScores(file: string): { t: number; score: number }[] {
  const r = spawnSync(ffmpegBin(), ["-v", "error", "-i", file, "-an", "-vf", "scale=160:90,select='gte(scene,0)',metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28, windowsHide: true });
  if (r.status !== 0) throw new Error(`FFmpeg could not read the video's frames: ${(r.stderr || "").trim().slice(0, 200)}`);
  const out: { t: number; score: number }[] = [];
  let t: number | null = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    const pt = /pts_time:([\d.]+)/.exec(line);
    if (pt) t = Number(pt[1]);
    const sc = /scene_score=([\d.]+)/.exec(line);
    if (sc && t !== null) {
      out.push({ t, score: Number(sc[1]) });
      t = null;
    }
  }
  return out;
}

// "This is a music video of this song": matched, its shots found, saved on the video. Read-only on the song.
export async function analyseMusicVideo(ws: Workspace, projectId: string, file: unknown): Promise<MusicVideoRecord> {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  if (!name || !BOARD_VIDEO_FILE.test(name) || !existsSync(path.join(dir, name))) throw new Error(`No video ${String(file)} in this song's Creation space.`);
  const c = await singerContext(ws, projectId);
  if (!existsSync(c.songFile)) throw new Error("The song file is missing from the song folder.");
  const info = await probeMedia(path.join(dir, name));
  if (!info.hasAudio) throw new Error("This video has no sound, so the app cannot tell where it sits in the song. Use the video WaveSpeed gave you as it came (with its sound).");
  const found = findInSong(decodeMono(path.join(dir, name)), decodeMono(c.songFile), MV_RATE);
  const matched = found.score >= MATCH_MIN && found.driftMs <= DRIFT_MAX_MS;
  const shots = matched ? shotsFromCuts(detectCuts(sceneScores(path.join(dir, name))), info.durationMs) : [];
  const rec: MusicVideoRecord = { at: new Date().toISOString(), matched, score: found.score, offsetMs: found.offsetMs, driftMs: found.driftMs, durationMs: info.durationMs, width: info.width, height: info.height, usd: mvUsd(info.durationMs, info.height, info.width), shots };
  update(dir, name, (p) => {
    p.mv = rec;
    if (!p.source) p.source = "WaveSpeed music video";
  });
  return rec;
}

// The video's shots with their lines and takes, for Creation.
export async function withMusicVideos(ws: Workspace, projectId: string, view: PicturesView): Promise<PicturesView> {
  const { dir } = songFolder(ws, projectId);
  const all = readPictures(dir).pictures;
  if (!view.pictures.some((p) => all[p.file]?.mv)) return view;
  const lines = (await singerContext(ws, projectId).catch(() => null))?.lines ?? [];
  return {
    ...view,
    pictures: view.pictures.map((p) => {
      const rec = all[p.file];
      return rec?.mv ? { ...p, mv: mvView(ws, projectId, rec.mv, rec.takes, lines) } : p;
    }),
  };
}

function mvView(ws: Workspace, projectId: string, mv: MusicVideoRecord, takes: readonly Take[], lines: readonly { number: number; text: string; shownMs: number }[]): MvView {
  const shots = mv.shots.map((s, i) => {
    const l = linesOfShot(s, mv.offsetMs, lines);
    const mine = takes.filter((x) => x.mvShot === i);
    // The take in use (a 1080p final replaces its draft on the lines), else the newest finished one.
    const used = [...mine].reverse().find((x) => x.status === "done" && (x.kind === "lipsync" ? singingTakeInUse(ws, projectId, x) : !!(x.sent ?? x.clip)));
    const t = used ?? [...mine].reverse().find((x) => x.status === "done");
    const final = [...mine].reverse().find((x) => x.finalOf !== undefined && x.status !== "failed");
    const sent = t ? (t.sent ?? t.clip ?? null) : null;
    return {
      ...s,
      i,
      songFromMs: Math.round(s.fromMs + mv.offsetMs),
      songToMs: Math.round(s.toMs + mv.offsetMs),
      first: l?.first ?? null,
      last: l?.last ?? null,
      text: l ? (lines.find((x) => x.number === l.first)?.text ?? null) : null,
      take: t?.n ?? null,
      inUse: !!used,
      sent,
      hd: final ? (final.status === "done" ? ("done" as const) : final.status === "running" ? ("running" as const) : ("interrupted" as const)) : null,
    };
  });
  return { ...mv, shots, singing: shots.filter((s) => s.first !== null).length };
}

// "Use on its lines" (a shot that carries sung lines): cut out as a singing take of the video and placed on its lines,
// locked to the song. A shot without a sung line: Send to Storyboard (a story clip). A shot cut before stays one take.
export async function useMusicVideoShot(ws: Workspace, projectId: string, file: unknown, shot: unknown): Promise<{ n: number; placed: "lines" | "storyboard"; first: number | null; last: number | null; clip: string }> {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const rec = readPictures(dir).pictures[name];
  const mv = rec?.mv;
  if (!mv?.matched) throw new Error("Check it first: This is a music video of this song.");
  const i = Number(shot);
  const s = mv.shots[i];
  if (!s) throw new Error("No such shot.");
  const c = await singerContext(ws, projectId);
  const l = linesOfShot(s, mv.offsetMs, c.lines ?? []);
  const lastLine = l ? (c.lines ?? []).find((x) => x.number === l.last) : undefined;
  const piece = shotPiece(s, mv.offsetMs, mv.durationMs, lastLine ? lastLine.sungEndMs : null);
  let t = rec.takes.find((x) => x.mvShot === i && x.status === "done" && x.file && existsSync(path.join(dir, x.file)));
  if (!t) {
    mkdirSync(path.join(dir, TAKES_DIR), { recursive: true });
    const base = name.replace(/\.[^.]+$/, "");
    const out = uniqueFileName(path.join(dir, TAKES_DIR), `${base} shot ${i + 1}.mp4`);
    // Cut exactly (re-encoded), without its sound: the video's audio stays the song.
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", (piece.fromMs / 1000).toFixed(3), "-i", path.join(dir, name), "-t", ((piece.toMs - piece.fromMs) / 1000).toFixed(3), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(dir, TAKES_DIR, out)], { windowsHide: true });
    const now = new Date().toISOString();
    update(dir, name, (p) => {
      const take: Take = {
        n: nextTakeN(p),
        service: "wavespeed",
        quality: "draft", // at most 720p: Make final upscales it to 1080p (final.ts), in its place on its lines
        model: MV_MODEL,
        status: "done",
        started_at: now,
        ended_at: now,
        cost_usd: 0, // the video's cost is on the video (mv.usd), once
        file: `${TAKES_DIR}/${out}`,
        seconds: Math.round((piece.toMs - piece.fromMs) / 100) / 10,
        label: `Shot ${i + 1}`,
        playable: true,
        mvShot: i,
        resolution: mvResolution(mv.height, mv.width),
        ...(l ? { kind: "lipsync" as const, line: l.first, ...(l.last > l.first ? { through: l.last } : {}), sync_ms: Math.round(mv.offsetMs + piece.fromMs), to_ms: Math.round(mv.offsetMs + piece.toMs), voice: "song" as const } : {}),
      };
      p.takes.push(take);
      t = take;
    });
  }
  const take = t!;
  if (take.kind === "lipsync") {
    await placeSingingTake(ws, projectId, name, take.n);
    const placed = readPictures(dir).pictures[name]?.takes.find((x) => x.n === take.n);
    return { n: take.n, placed: "lines", first: take.line ?? null, last: take.through ?? take.line ?? null, clip: placed?.sent ?? "" };
  }
  const r = await sendToStoryboard(ws, projectId, name, take.n);
  return { n: take.n, placed: "storyboard", first: null, last: null, clip: r.clip };
}

// "Use every singing shot": each shot that carries sung lines, on its lines.
export async function useAllMusicVideoShots(ws: Workspace, projectId: string, file: unknown): Promise<{ used: number[] }> {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const mv = readPictures(dir).pictures[name]?.mv;
  if (!mv?.matched) throw new Error("Check it first: This is a music video of this song.");
  const lines = (await singerContext(ws, projectId)).lines ?? [];
  const used: number[] = [];
  for (let i = 0; i < mv.shots.length; i++) {
    if (!linesOfShot(mv.shots[i], mv.offsetMs, lines)) continue;
    await useMusicVideoShot(ws, projectId, name, i);
    used.push(i);
  }
  return { used };
}

// The face check (Takes QA, local and free) of each singing shot used that has none yet. Never throws.
export async function checkMusicVideoShots(openWs: () => Workspace, projectId: string, file: string): Promise<void> {
  try {
    const ws = openWs();
    const { dir } = songFolder(ws, projectId);
    const { checkTake } = await import("./take-qa");
    const { cardFace } = await import("./characters/jobs");
    const face = cardFace();
    for (const t of readPictures(dir).pictures[file]?.takes ?? []) if (t.mvShot !== undefined && t.kind === "lipsync" && t.status === "done" && !t.qa) await checkTake(dir, file, t.n, face);
  } catch {
    // the check is extra: the shots are placed already
  }
}

// ---------------------------------------------------------------- making one on WaveSpeed (27 Nov 2026, Paul: "go")
// "Make a music video" (Creation): Paul picks up to 3 pictures of the singer and a few words; the app sends the stretch
// of the song (his latest Reel's section by default) to WaveSpeed's Music Video Generator, cost first and under his cap,
// sent once and never retried. It is a take of the first picture while it is made (Tasks menu, Get result if the studio
// stops); the video comes back as its own item in Creation, already found in the song and split into shots.
// The song is only read: FFmpeg copies the stretch into a temporary file that is uploaded, then deleted.

export type MvMakeOptions = {
  durationMs: number;
  lines: { number: number; text: string }[];
  latest: { platform: string; fromMs: number; toMs: number } | null; // the section of the latest Reel / TikTok / Shorts video made
  chorus: { first: number; last: number } | null;
  usdPerSecond: Record<"480p" | "720p", number>;
  ready: boolean; // a WaveSpeed key (or the stand-in)
};

const SHORT_PLATFORMS = ["reels", "tiktok", "shorts"];
// The section of the newest short-platform video made (its manifest), or null.
export function latestShortSection(ws: Workspace, projectId: string): { platform: string; fromMs: number; toMs: number } | null {
  let base: string;
  try {
    base = songPathsById(ws, projectId).exports;
  } catch {
    return null;
  }
  if (!base || !existsSync(base)) return null;
  const runs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
  for (const run of runs) {
    for (const platform of SHORT_PLATFORMS) {
      const dir = path.join(base, run, platform);
      if (!existsSync(dir)) continue;
      const m = readdirSync(dir).find((f) => /^v\d+\.manifest\.json$/.test(f));
      if (!m) continue;
      try {
        const s = (JSON.parse(readFileSync(path.join(dir, m), "utf8")) as { section?: { start_ms?: number; end_ms?: number } }).section;
        if (typeof s?.start_ms === "number" && typeof s.end_ms === "number" && s.end_ms > s.start_ms) return { platform, fromMs: s.start_ms, toMs: s.end_ms };
      } catch {
        // an unreadable manifest: the next one
      }
    }
  }
  return null;
}

export async function musicVideoOptions(ws: Workspace, projectId: string, env: NodeJS.ProcessEnv = process.env): Promise<MvMakeOptions | null> {
  const c = await singerContext(ws, projectId).catch(() => null);
  if (!c) return null;
  let chorus: MvMakeOptions["chorus"] = null;
  try {
    const sections = readRecipe(songPathsById(ws, projectId).recipe).sections ?? [];
    const i = sections.findIndex((s) => s.kind === "chorus");
    if (i >= 0 && c.lines?.length) {
      const nextLine = sections[i + 1]?.line ?? Infinity;
      const inIt = c.lines.filter((l) => l.number >= sections[i].line && l.number < nextLine).map((l) => l.number);
      if (inIt.length) chorus = { first: Math.min(...inIt), last: Math.max(...inIt) };
    }
  } catch {
    // no sections
  }
  return { durationMs: c.songMs, lines: (c.lines ?? []).map((l) => ({ number: l.number, text: l.text })), latest: latestShortSection(ws, projectId), chorus, usdPerSecond: MV_USD_PER_SECOND, ready: !!env.LYRIC_GENERATE_STUB || !!keyFor("wavespeed", env) };
}

export type MvMakeRequest = { pictures?: unknown; section?: unknown; aspect?: unknown; resolution?: unknown; words?: unknown; cap?: unknown };

// Checks a press of Make music video and records it as running on the first picture; the caller starts runMusicVideo.
export async function startMusicVideo(ws: Workspace, projectId: string, o: MvMakeRequest, env: NodeJS.ProcessEnv = process.env): Promise<{ file: string; take: Take }> {
  const { dir } = songFolder(ws, projectId);
  const pics = (Array.isArray(o.pictures) ? o.pictures : []).map((p) => path.basename(String(p ?? ""))).filter((p, i, all) => p && all.indexOf(p) === i);
  if (!pics.length) throw new Error("Pick at least one picture of the singer (up to 3).");
  if (pics.length > MV_MAX_PICTURES) throw new Error(`Pick at most ${MV_MAX_PICTURES} pictures.`);
  for (const p of pics) if (!PICTURE_FILE.test(p) || !existsSync(path.join(dir, p))) throw new Error(`No picture ${p} in this song's Creation space.`);
  if (!env.LYRIC_GENERATE_STUB && !keyFor("wavespeed", env)) throw new Error("No WAVESPEED_API_KEY in D:\\videomaker\\.env: add your key from wavespeed.ai → API keys, then restart Lyric Studio.");
  const c = await singerContext(ws, projectId);
  const s = o.section as { kind?: unknown; first?: unknown; last?: unknown } | undefined;
  let choice: MvSectionChoice;
  if (s?.kind === "lines") choice = { kind: "lines", first: Number(s.first), last: Number(s.last) };
  else if (s?.kind === "latest") {
    const latest = latestShortSection(ws, projectId);
    if (!latest) throw new Error("No Reel, TikTok or Shorts video has been made for this song yet: choose lines or the whole song.");
    choice = { kind: "latest", ...latest };
  } else choice = { kind: "whole" };
  if (choice.kind === "lines" && !c.lines?.length) throw new Error("This song's lines are not timed yet: time the lyrics first, or send the whole song.");
  const section = mvSection(choice, c.lines ?? [], c.downbeats, c.songMs);
  const ms = section.toMs - section.fromMs;
  if (ms < MV_MIN_MS) throw new Error("That stretch is shorter than 3 seconds.");
  if (ms > MV_MAX_MS) throw new Error("WaveSpeed takes at most 10 minutes of song: choose fewer lines.");
  const resolution = o.resolution === "480p" ? "480p" : "720p";
  const aspect = o.aspect === "16:9" ? "16:9" : "9:16";
  const seconds = Math.max(3, Math.ceil(ms / 1000));
  const usd = Math.round(seconds * MV_USD_PER_SECOND[resolution] * 100) / 100;
  const cap = Number(o.cap);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (usd > cap) throw new Error(`${seconds} s at ${resolution} costs about $${usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: choose a shorter stretch, 480p, or raise the cap. Nothing was sent.`);
  const look = filmLookFor(ws, projectId);
  const prompt = mvPrompt(String(o.words ?? "").slice(0, 2000), look?.line);
  let made: Take | undefined;
  update(dir, pics[0], (p) => {
    made = {
      n: nextTakeN(p),
      service: "wavespeed",
      quality: "standard",
      model: MV_MODEL,
      kind: "musicvideo",
      status: "running",
      started_at: new Date().toISOString(),
      cost_usd: usd,
      seconds,
      section,
      refFiles: pics,
      aspect,
      resolution,
      prompt,
      ...(look ? { filmLook: look.name, look: look.line } : {}),
      pid: process.pid,
    };
    p.takes.push(made);
  });
  return { file: pics[0], take: made! };
}

export type MvRunDeps = { env?: NodeJS.ProcessEnv; f?: typeof fetch; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number };
const mmss = (ms: number) => `${Math.floor(ms / 60000)}.${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const clockOf = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

// Sends it once (or only waits for it: resumed), files the video in Creation and finds it in the song.
export async function runMusicVideo(openWs: () => Workspace, projectId: string, file: string, n: number, deps: MvRunDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const f = deps.f ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let dir = "";
  let songFile = "";
  {
    const ws = openWs();
    try {
      dir = songFolder(ws, projectId).dir;
      songFile = (await singerContext(ws, projectId)).songFile;
    } catch (error) {
      if (dir) setTake(dir, file, n, { status: "failed", error: `${errorText(error)}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
      return;
    } finally {
      ws.close();
    }
  }
  const t = readPictures(dir).pictures[file]?.takes.find((x) => x.n === n);
  if (!t || t.kind !== "musicvideo" || !t.section) return;
  const section = t.section;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-mv-"));
  let id = t.request_id;
  try {
    // The stretch of the song, copied (read only) into a temporary WAV.
    const cutSong = () => {
      const out = path.join(tmp, "song.wav");
      execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", (section.fromMs / 1000).toFixed(3), "-t", ((section.toMs - section.fromMs) / 1000).toFixed(3), "-i", songFile, "-vn", "-c:a", "pcm_s16le", out], { windowsHide: true });
      return out;
    };
    const video = path.join(tmp, "music video.mp4");
    if (env.LYRIC_GENERATE_STUB) {
      // The browser tests and the cloud: a stand-in video of the picture with the song's stretch under it, nothing sent.
      if (env.LYRIC_GENERATE_STUB === "fail") throw new Error("stand-in: the service refused the request");
      const [w, h] = t.aspect === "16:9" ? [256, 144] : [144, 256];
      execFileSync(ffmpegBin(), ["-y", "-v", "error", "-loop", "1", "-i", path.join(dir, t.refFiles?.[0] ?? file), "-i", cutSong(), "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=yuv420p`, "-r", "25", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", video], { windowsHide: true });
    } else {
      const key = keyFor("wavespeed", env);
      if (!key) throw new Error("No WAVESPEED_API_KEY in .env");
      if (!id) {
        const audio = await waveSpeedUpload(key, cutSong(), f);
        const images: string[] = [];
        for (const p of t.refFiles ?? [file]) images.push(await waveSpeedUpload(key, path.join(dir, p), f));
        const b = data(await json(await f(`${WAVESPEED}/${MV_GENERATOR_PATH}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ audio, images, prompt: t.prompt ?? "", aspect_ratio: t.aspect ?? "9:16", resolution: t.resolution ?? "720p" }) }), "WaveSpeed music video"));
        if (typeof b.id !== "string") throw new Error("WaveSpeed music video: no request id in the answer");
        id = b.id;
        setTake(dir, file, n, { request_id: id });
      }
      const poller = waveSpeedTransport(key, MV_GENERATOR_PATH, f);
      const t0 = Date.now();
      // About 3-6 minutes per minute of song (WaveSpeed's page): wait up to 10 times the length, at least 20 minutes.
      const timeout = deps.timeoutMs ?? Math.max(20 * 60_000, (t.seconds ?? 60) * 10_000);
      let url: string;
      for (;;) {
        const s = await poller.poll(id);
        if (s.status === "done") {
          url = s.url;
          break;
        }
        if (s.status === "failed") throw new Error(`WaveSpeed music video: ${s.error}`);
        if (Date.now() - t0 > timeout) throw new Error(`no answer within ${Math.round(timeout / 60_000)} min: get its result later (free)`);
        await sleep(deps.pollMs ?? POLL_MS);
      }
      await poller.download(url, video);
    }
    // Its own item in Creation (with its sound: that is how it is found in the song).
    const made = uniqueFileName(dir, `Music video ${mmss(section.fromMs)}-${mmss(section.toMs)}.mp4`);
    copyFileSync(video, path.join(dir, made));
    update(dir, made, (p) => {
      p.source = "WaveSpeed music video";
      p.label = `Music video ${clockOf(section.fromMs)}–${clockOf(section.toMs)}`;
    });
    setTake(dir, file, n, { made });
    const ws = openWs();
    try {
      await analyseMusicVideo(ws, projectId, made);
    } catch (error) {
      setTake(dir, file, n, { error: `Made, but not yet found in the song: ${errorText(error)}. Press "This is a music video of this song" on it.` });
    } finally {
      ws.close();
    }
    setTake(dir, file, n, { status: "done", ended_at: new Date().toISOString(), pid: undefined });
  } catch (error) {
    setTake(dir, file, n, { status: id ? "interrupted" : "failed", error: id ? `${errorText(error)} (sent: get its result later, free)` : `${errorText(error)}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// "Make the shots in use 1080p": each singing shot on its lines without a final yet is upscaled with Make final
// (WaveSpeed Video Upscaler Pro); the final takes its place on its lines, in time. Cost first, under the cap.
export function startMusicVideoFinals(ws: Workspace, projectId: string, file: unknown, cap: unknown, startFinal: (n: number) => Take, usdOf: (seconds: number) => number): { takes: Take[]; usd: number } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const takes = readPictures(dir).pictures[name]?.takes ?? [];
  const todo = takes.filter((t) => t.mvShot !== undefined && t.kind === "lipsync" && t.status === "done" && t.finalOf === undefined && singingTakeInUse(ws, projectId, t) && !takes.some((x) => x.finalOf === t.n && x.status !== "failed"));
  if (!todo.length) throw new Error("No shot on its lines is waiting for 1080p.");
  const usd = Math.round(todo.reduce((sum, t) => sum + usdOf(t.seconds ?? 5), 0) * 100) / 100;
  const c = Number(cap);
  if (!Number.isFinite(c) || c <= 0) throw new Error("Set a spending cap above $0.");
  if (usd > c) throw new Error(`${todo.length} shots at 1080p cost about $${usd.toFixed(2)}, above your cap of $${c.toFixed(2)}: raise the cap or use Make final on single shots. Nothing was sent.`);
  return { takes: todo.map((t) => startFinal(t.n)), usd };
}
