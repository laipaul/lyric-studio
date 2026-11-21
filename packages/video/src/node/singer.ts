// Singing lines (Lyrics Sync → Singer, 21 Nov 2026, Paul's workflow): Paul ticks the lines where the singer shows and
// picks, per line, a picture or video from Creation. The app cuts the vocal for each line (the vocal stem, lined up on
// the song; else the song itself), sends it with the picture or video to WaveSpeed InfiniteTalk (his own key; cost
// first, the spending cap), and each singing clip comes back:
//   - into Creation, as a take of its picture labelled "Lip sync · line N" (pictures\takes\<picture> sings line N.mp4,
//     without sound: the vocal is never kept in any file);
//   - into the Storyboard (the end of his story line; he may move it) and onto its line as a story anchor with "sync":
//     the song second its first frame belongs to. Make cuts it in on the beat and plays it in time with the song
//     (anchors.ts), never slowed, never used for other shots.
// The vocal piece runs from just before the downbeat before the line to two bars after it is sung, so the cut and the
// hold that follow always have footage, and the lips sing what the song sings there.
// The song and the stem are only read (FFmpeg decodes a piece into a temporary file). Requests are never retried.
// Settings: <song folder>\pictures\singer.json { "lines": { "<line>": "<Creation file>" } }.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, beat as beatTable, ffmpegBin, project as projectTable, uniqueFileName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { applyDownbeatOffset } from "../beats";
import { BOARD_VIDEO_FILE, PICTURE_FILE, POLL_MS, TAKES_DIR, TIMEOUT_MS, WAVESPEED, data, json, keyFor, readPictures, setTake, sleepMs, songFolder, update, waveSpeedUpload, type Take } from "./animate";
import { importSongClips } from "./assets";
import { download, errorText } from "./characters/fal";
import { lyricsView, saveAnchors } from "./lyrics-view";
import { readRecipe } from "./recipe";
import { songPaths, songPathsById } from "./song-folder";
import { storedStemCheck } from "./voice-source";

export const SINGER_FILE = "singer.json";
export const LIPSYNC_RESOLUTION = "720p";
export const LIPSYNC_USD_PER_SECOND = 0.06; // WaveSpeed InfiniteTalk at 720p (price list, 21 Nov 2026); 480p is $0.03
export const LIPSYNC_MIN_SECONDS = 3; // billed at least 3 s, rounded up to whole seconds
export const LIPSYNC_MODEL = "InfiniteTalk";
const LEAD_MS = 500; // the piece starts this long before the downbeat the shot cuts in on
const TAIL_BARS = 2; // and runs two bars past the line's sung end (the shot holds until the next regular cut)

export type SingerSettings = { lines: Record<string, string> };
export type Piece = { fromMs: number; toMs: number; seconds: number; usd: number };
export type SingerLine = {
  number: number;
  text: string;
  source: string | null; // the Creation file sung from (null: not ticked)
  piece: Piece; // what would be sent for this line
  take: (Take & { file?: string }) | null; // the newest singing take of this line from its source
  needed: boolean; // ticked and without a finished or running take of this source and piece
};
export type SingerView = {
  lines: SingerLine[] | null; // null: no timed lines yet
  why: string | null;
  sources: { file: string; kind: "picture" | "video" }[]; // Creation's pictures and videos
  voice: "stem" | "song";
  ready: boolean; // WAVESPEED_API_KEY (or the stand-in)
  keyName: string;
  toMake: { lines: number[]; seconds: number; usd: number };
  usdPerSecond: number;
};

export function readSinger(dir: string): SingerSettings {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, SINGER_FILE), "utf8")) as Partial<SingerSettings>;
    return { lines: raw.lines && typeof raw.lines === "object" ? raw.lines : {} };
  } catch {
    return { lines: {} };
  }
}
function writeSinger(dir: string, s: SingerSettings): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, SINGER_FILE), `${JSON.stringify({ _help: "Lyrics Sync → Singer: the lines where the singer shows, each with the Creation picture or video it is sung from. Written by the app.", ...s }, null, 2)}\n`);
}

// The vocal piece for a line: from just before the downbeat at or before the line shows, to two bars after it is sung.
export function singingPiece(line: { shownMs: number; sungEndMs: number }, downbeats: readonly number[], songMs: number): Piece {
  const gaps = downbeats.slice(1).map((d, i) => d - downbeats[i]).sort((a, b) => a - b);
  const bar = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2000;
  const cutAt = downbeats.filter((d) => d <= line.shownMs).at(-1) ?? line.shownMs - bar;
  let fromMs = Math.max(0, Math.round((cutAt - LEAD_MS) / 10) * 10);
  let toMs = Math.min(songMs, Math.round((line.sungEndMs + TAIL_BARS * bar) / 10) * 10);
  if (toMs - fromMs < LIPSYNC_MIN_SECONDS * 1000) {
    toMs = Math.min(songMs, fromMs + LIPSYNC_MIN_SECONDS * 1000);
    fromMs = Math.max(0, toMs - LIPSYNC_MIN_SECONDS * 1000);
  }
  const seconds = Math.max(LIPSYNC_MIN_SECONDS, Math.ceil((toMs - fromMs) / 1000));
  return { fromMs, toMs, seconds, usd: Math.round(seconds * LIPSYNC_USD_PER_SECOND * 100) / 100 };
}

type Ctx = { root: string; dir: string; songFile: string; songMs: number; lines: { number: number; text: string; shownMs: number; sungEndMs: number }[] | null; why: string | null; downbeats: number[] };
async function context(ws: Workspace, projectId: string): Promise<Ctx> {
  const { root, dir } = songFolder(ws, projectId);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p?.audio_path) throw new Error("Song not found.");
  const view = await lyricsView(ws, projectId);
  const beats = applyDownbeatOffset(
    ws.db.select().from(beatTable).where(eq(beatTable.project_id, projectId)).all().sort((a, b) => a.time_ms - b.time_ms).map((b) => ({ time_ms: b.time_ms, strength: b.strength, is_downbeat: b.is_downbeat })),
    p.downbeat_offset ?? 0,
  );
  return {
    root,
    dir,
    songFile: absPath(ws, p.audio_path),
    songMs: p.duration_ms ?? 600_000,
    lines: view.lines?.map((l) => ({ number: l.number, text: l.text, shownMs: l.screen.readableMs, sungEndMs: l.sungEndMs ?? l.screen.leaveMs })) ?? null,
    why: view.why,
    downbeats: beats.filter((b) => b.is_downbeat).map((b) => b.time_ms),
  };
}

function newestTake(dir: string, source: string, line: number): Take | null {
  const rec = readPictures(dir).pictures[source];
  return [...(rec?.takes ?? [])].reverse().find((t) => t.kind === "lipsync" && t.line === line) ?? null;
}
const covers = (t: Take | null, piece: Piece) => !!t && (t.status === "running" || t.status === "done" || t.status === "interrupted") && t.sync_ms === piece.fromMs && t.to_ms === piece.toMs;

export async function singerView(ws: Workspace, projectId: string, env: NodeJS.ProcessEnv = process.env): Promise<SingerView> {
  const c = await context(ws, projectId);
  const settings = readSinger(c.dir);
  const sources = existsSync(c.dir)
    ? readdirSync(c.dir)
        .filter((f) => (PICTURE_FILE.test(f) || BOARD_VIDEO_FILE.test(f)) && statSync(path.join(c.dir, f)).isFile())
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((f) => ({ file: f, kind: PICTURE_FILE.test(f) ? ("picture" as const) : ("video" as const) }))
    : [];
  const lines = c.lines?.map((l) => {
    const source = settings.lines[String(l.number)] ?? null;
    const piece = singingPiece(l, c.downbeats, c.songMs);
    const take = source ? newestTake(c.dir, source, l.number) : null;
    return { number: l.number, text: l.text, source, piece, take, needed: !!source && !covers(take, piece) };
  }) ?? null;
  const toMake = (lines ?? []).filter((l) => l.needed);
  return {
    lines,
    why: c.lines ? null : c.why,
    sources,
    voice: (await voiceFor(ws, projectId)).kind,
    ready: !!env.LYRIC_GENERATE_STUB || !!keyFor("wavespeed", env),
    keyName: "WAVESPEED_API_KEY",
    toMake: { lines: toMake.map((l) => l.number), seconds: toMake.reduce((s, l) => s + l.piece.seconds, 0), usd: Math.round(toMake.reduce((s, l) => s + l.piece.usd, 0) * 100) / 100 },
    usdPerSecond: LIPSYNC_USD_PER_SECOND,
  };
}

// Tick or untick a line, or choose what it is sung from (null: not a singing line).
export function setSingerLine(ws: Workspace, projectId: string, line: unknown, source: unknown): SingerSettings {
  const { dir } = songFolder(ws, projectId);
  const n = Number(line);
  if (!Number.isInteger(n) || n < 1) throw new Error("Choose a line.");
  const s = readSinger(dir);
  if (source === null || source === undefined || source === "") delete s.lines[String(n)];
  else {
    const name = path.basename(String(source));
    if (!(PICTURE_FILE.test(name) || BOARD_VIDEO_FILE.test(name)) || !existsSync(path.join(dir, name))) throw new Error(`No ${name} in this song's Creation space: add the picture or video there first.`);
    s.lines[String(n)] = name;
  }
  writeSinger(dir, s);
  return s;
}

// The voice sent to the model: the vocal stem (lined up on the song by the stem check) when it follows the song, else
// the song itself.
type Voice = { kind: "stem"; file: string; offsetMs: number; speed?: number } | { kind: "song" };
async function voiceFor(ws: Workspace, projectId: string, project?: typeof projectTable.$inferSelect): Promise<Voice> {
  const p = project ?? ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) return { kind: "song" };
  const paths = songPaths(ws, p);
  if (!paths.vocals || !existsSync(paths.vocals)) return { kind: "song" };
  const stored = p.audio_hash ? await storedStemCheck(ws, { project: p, songHash: p.audio_hash }).catch(() => null) : null;
  if (stored?.check.status === "rejected") return { kind: "song" };
  return { kind: "stem", file: paths.vocals, offsetMs: stored?.check.offset_ms ?? 0, ...(typeof stored?.check.speed === "number" ? { speed: stored.check.speed } : {}) };
}

// A piece of the voice as a WAV (song time fromMs → toMs; the stem's offset and speed applied).
export function cutVoice(voice: Voice, songFile: string, piece: { fromMs: number; toMs: number }, out: string): void {
  const durS = (piece.toMs - piece.fromMs) / 1000;
  if (voice.kind === "stem") {
    const speed = voice.speed ?? 1;
    const startS = Math.max(0, (voice.offsetMs + speed * piece.fromMs) / 1000);
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", startS.toFixed(3), "-t", (durS * speed).toFixed(3), "-i", voice.file, ...(speed !== 1 ? ["-af", `atempo=${speed}`] : []), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
  } else {
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", (piece.fromMs / 1000).toFixed(3), "-t", durS.toFixed(3), "-i", songFile, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
  }
}

// ---------------------------------------------------------------- the service

export type SingTransport = {
  upload: (file: string) => Promise<string>;
  submit: (o: { image?: string; video?: string; audio: string }) => Promise<{ id: string }>;
  poll: (id: string) => Promise<{ status: "running" } | { status: "done"; url: string } | { status: "failed"; error: string }>;
  download: (url: string, file: string) => Promise<void>;
};

export function infiniteTalkTransport(key: string, f: typeof fetch = (...a) => globalThis.fetch(...a)): SingTransport {
  const auth = { Authorization: `Bearer ${key}` };
  return {
    upload: (file) => waveSpeedUpload(key, file, f),
    submit: async (o) => {
      const model = o.video ? "wavespeed-ai/infinitetalk/video-to-video" : "wavespeed-ai/infinitetalk";
      const body = { ...(o.video ? { video: o.video } : { image: o.image }), audio: o.audio, resolution: LIPSYNC_RESOLUTION, seed: -1 };
      const b = data(await json(await f(`${WAVESPEED}/${model}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), "WaveSpeed InfiniteTalk"));
      if (typeof b.id !== "string") throw new Error("WaveSpeed: no request id in the answer");
      return { id: b.id };
    },
    poll: async (id) => {
      const r = await f(`${WAVESPEED}/predictions/${encodeURIComponent(id)}/result`, { headers: auth });
      if (r.status === 429 || r.status >= 500) return { status: "running" };
      const b = data(await json(r, "WaveSpeed"));
      const s = String(b.status ?? "");
      if (s === "completed") {
        const url = (b.outputs as unknown[] | undefined)?.find((x): x is string => typeof x === "string");
        return url ? { status: "done", url } : { status: "failed", error: "finished without a video" };
      }
      if (["failed", "cancelled", "timeout", "deleted"].includes(s)) return { status: "failed", error: String(b.error || s) };
      return { status: "running" };
    },
    download: (url, file) => download(url, file, writeFileSync, undefined, f),
  };
}

// Tests and the cloud (LYRIC_GENERATE_STUB): a clip as long as the voice, made from the picture (or the video's first
// frame) by FFmpeg, with the voice as its sound (as the real service returns it); nothing sent anywhere.
export function stubSingTransport(mode: string): SingTransport {
  const files = new Map<string, string>();
  let n = 0;
  return {
    upload: async (file) => {
      const url = `stub://${++n}`;
      files.set(url, file);
      return url;
    },
    submit: async (o) => {
      if (mode === "fail") throw new Error("stand-in: the service refused the request");
      return { id: JSON.stringify({ picture: files.get(o.image ?? o.video ?? "") ?? "", audio: files.get(o.audio) ?? "" }) };
    },
    poll: async (id) => ({ status: "done", url: id }),
    download: async (url, file) => {
      const { picture, audio } = JSON.parse(url) as { picture: string; audio: string };
      const still = PICTURE_FILE.test(picture);
      execFileSync(ffmpegBin(), ["-y", "-v", "error", ...(still ? ["-loop", "1"] : ["-stream_loop", "-1"]), "-i", picture, "-i", audio, "-shortest", "-r", "30", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", file]);
    },
  };
}

export function singTransportFor(env: NodeJS.ProcessEnv = process.env): SingTransport {
  if (env.LYRIC_GENERATE_STUB) return stubSingTransport(env.LYRIC_GENERATE_STUB);
  const key = keyFor("wavespeed", env);
  if (!key) throw new Error("No WAVESPEED_API_KEY in .env: add a line WAVESPEED_API_KEY=<your key from wavespeed.ai → API keys> to D:\\videomaker\\.env, then restart Lyric Studio.");
  return infiniteTalkTransport(key);
}

// ---------------------------------------------------------------- make the singing clips

export type SingJob = { source: string; n: number };

// "Make singing clips": checks the cost against the cap and records a running take for every ticked line that has no
// clip for its source and piece yet (a line already made is never paid for twice). `lines`: only these.
export async function startSinging(ws: Workspace, projectId: string, o: { capUsd: number; lines?: number[] }, env: NodeJS.ProcessEnv = process.env): Promise<{ jobs: SingJob[]; usd: number; seconds: number }> {
  const view = await singerView(ws, projectId, env);
  if (!view.lines) throw new Error(view.why ?? "This song's lines are not timed yet.");
  const todo = view.lines.filter((l) => l.needed && (!o.lines || o.lines.includes(l.number)));
  if (!todo.length) throw new Error("Nothing to make: tick the lines where the singer shows (each with its picture or video), or they are made already.");
  if (!view.ready) singTransportFor(env); // throws the plain-words message
  const usd = Math.round(todo.reduce((s, l) => s + l.piece.usd, 0) * 100) / 100;
  const seconds = todo.reduce((s, l) => s + l.piece.seconds, 0);
  const cap = Number(o.capUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (usd > cap) throw new Error(`${todo.length} singing line${todo.length === 1 ? "" : "s"} (${seconds} s of voice) cost about $${usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: tick fewer lines or raise the cap. Nothing was sent.`);
  const { dir } = songFolder(ws, projectId);
  const now = new Date().toISOString();
  const jobs: SingJob[] = [];
  for (const l of todo) {
    update(dir, l.source!, (p) => {
      const n = p.takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
      p.takes.push({ n, kind: "lipsync", line: l.number, sync_ms: l.piece.fromMs, to_ms: l.piece.toMs, service: "wavespeed", quality: "best", model: LIPSYNC_MODEL, status: "running", started_at: now, cost_usd: l.piece.usd, pid: process.pid });
      jobs.push({ source: l.source!, n });
    });
  }
  return { jobs, usd, seconds };
}

// Makes the singing clips (in parallel). Each: the picture or video and its piece of voice go online, the request is
// sent once, polled, downloaded; the sound is removed; the clip goes to Creation, the Storyboard and onto its line.
// `resume`: takes that already have a request id are only polled and fetched (free).
export async function runSinging(openWs: () => Workspace, projectId: string, jobs: SingJob[], o: { env?: NodeJS.ProcessEnv; transport?: SingTransport; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number } = {}): Promise<void> {
  const env = o.env ?? process.env;
  const sleep = o.sleep ?? sleepMs;
  let dir: string;
  let songFile: string;
  let voice: Voice;
  {
    const ws = openWs();
    try {
      dir = songFolder(ws, projectId).dir;
      const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()!;
      songFile = absPath(ws, p.audio_path!);
      voice = await voiceFor(ws, projectId, p);
    } finally {
      ws.close();
    }
  }
  let transport: SingTransport;
  try {
    transport = o.transport ?? singTransportFor(env);
  } catch (error) {
    for (const j of jobs) setTake(dir, j.source, j.n, { status: "failed", error: errorText(error), ended_at: new Date().toISOString(), pid: undefined });
    return;
  }
  const uploads = new Map<string, Promise<string>>(); // one upload per picture or video
  await Promise.all(
    jobs.map(async (j) => {
      const t = readPictures(dir).pictures[j.source]?.takes.find((x) => x.n === j.n);
      if (!t || t.sync_ms === undefined || t.to_ms === undefined || !t.line) return;
      let id = t.request_id;
      const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-sing-"));
      try {
        setTake(dir, j.source, j.n, { status: "running", pid: process.pid, error: undefined });
        if (!id) {
          const src = path.join(dir, j.source);
          if (!uploads.has(j.source)) uploads.set(j.source, transport.upload(src));
          const voiceFile = path.join(tmp, "voice.wav");
          cutVoice(voice, songFile, { fromMs: t.sync_ms, toMs: t.to_ms }, voiceFile);
          let media: string;
          let audio: string;
          try {
            [media, audio] = await Promise.all([uploads.get(j.source)!, transport.upload(voiceFile)]);
          } catch (error) {
            throw Object.assign(new Error(`The picture or the voice could not be put online: ${errorText(error)}`), { unsent: true });
          }
          const sent = await transport.submit(BOARD_VIDEO_FILE.test(j.source) ? { video: media, audio } : { image: media, audio }); // never retried
          id = sent.id;
          setTake(dir, j.source, j.n, { request_id: id });
        }
        const t0 = Date.now();
        let url: string;
        for (;;) {
          const s = await transport.poll(id);
          if (s.status === "done") {
            url = s.url;
            break;
          }
          if (s.status === "failed") throw new Error(`WaveSpeed: ${s.error}`);
          if (Date.now() - t0 > (o.timeoutMs ?? TIMEOUT_MS * 3)) throw new Error("no answer within an hour: get its result later (free)");
          await sleep(o.pollMs ?? POLL_MS);
        }
        const got = path.join(tmp, "sings.mp4");
        await transport.download(url, got);
        // The model's copy carries the vocal: only the picture is kept (the vocal never goes into any file of ours).
        const silent = path.join(tmp, "silent.mp4");
        execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", got, "-map", "0:v:0", "-an", "-c:v", "copy", silent]);
        const takesDir = path.join(dir, TAKES_DIR);
        mkdirSync(takesDir, { recursive: true });
        const name = uniqueFileName(takesDir, `${path.parse(j.source).name} sings line ${t.line}.mp4`);
        copyFileSync(silent, path.join(takesDir, name));
        setTake(dir, j.source, j.n, { file: `${TAKES_DIR}/${name}` });
        // Into the Storyboard (the end of the story line) and onto its line, locked to the song; then it shows as done.
        const ws = openWs();
        try {
          const r = await importSongClips(ws, projectId, [{ file: path.join(takesDir, name), name }]);
          const clip = r.added[0] ?? r.duplicates[0]?.sameAs;
          if (!clip) throw Object.assign(new Error(r.skipped[0]?.reason ?? "it could not be added to the Storyboard"), { made: true });
          const recipe = readRecipe(songPathsById(ws, projectId).recipe);
          const others = (recipe.anchors ?? []).filter((a) => a.line !== t.line);
          saveAnchors(ws, projectId, [...others, { line: t.line, clip, sync: t.sync_ms / 1000 }]);
          setTake(dir, j.source, j.n, { status: "done", sent: clip, ended_at: new Date().toISOString(), pid: undefined });
        } finally {
          ws.close();
        }
      } catch (error) {
        if ((error as { made?: boolean }).made) {
          setTake(dir, j.source, j.n, { status: "done", error: `Made, but not placed: ${errorText(error)}. Send it to the Storyboard from Creation.`, ended_at: new Date().toISOString(), pid: undefined });
          return;
        }
        const unsent = !id || (error as { unsent?: boolean }).unsent;
        setTake(dir, j.source, j.n, { status: unsent ? "failed" : "interrupted", error: unsent ? `${errorText(error)}. Nothing was spent.` : `${errorText(error)} (sent: get its result later, free)`, ended_at: new Date().toISOString(), pid: undefined });
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }),
  );
}
