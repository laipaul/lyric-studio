// Prepare → Pictures (G2, 21 Nov 2026, decided with Paul: "pictures, then clips, then play with the order"). Paul makes
// clips from Midjourney pictures at random and finds the video by arranging them against the song; there is no story or
// shot list in this path. So:
//   - a picture board per song: <song folder>\pictures\ (his pictures under their own names);
//   - "Animate" on a picture sends it as image-to-video to WaveSpeed or Higgsfield (Seedance 2.5) with HIS key from
//     .env; the app chooses the length, size (the picture's own shape), resolution, a gentle-motion prompt and no sound;
//     Paul may add a few words of mood. Several takes at once (3 by default), so surprises happen;
//   - the cost is shown before anything is sent, and a press is refused above its cap;
//   - each finished take goes into the song's clips (clips\<picture> take N.mp4) at the END of the clip order, like
//     any dropped clip: Paul orders them himself (Prepare → Storyboard or Shape), never the app.
// State: pictures\pictures.json (each picture's mood and takes: service, request id, status, cost, the clip made).
// A take whose studio stopped mid-way is "interrupted"; with a request id its result can still be fetched (free).
// The picture is never changed. Requests are never retried on submit (a retry could be billed twice).
// No rendering code is imported here, so the studio's server can use it.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, probeMedia, uniqueFileName, type Workspace } from "@lyric/db";

import { importSongClips } from "./assets";
import { download, errorText } from "./characters/fal";
import { processAlive } from "./jobs";
import { songPathsById } from "./song-folder";

export const PICTURES_DIR = "pictures";
export const PICTURES_FILE = "pictures.json";
export const PICTURE_FILE = /\.(jpe?g|png|webp)$/i;
export const TAKE_SECONDS = 5; // the app's choice: long enough for the beat cuts, the services' minimum is 4
export const RESOLUTION = "720p";
export const DEFAULT_TAKES = 3;
export const MAX_TAKES = 6;
export const DEFAULT_CAP_USD = 10;
const POLL_MS = 4000;
const TIMEOUT_MS = 20 * 60 * 1000;
const UPLOAD_KEEP_MS = 5 * 24 * 3600 * 1000; // WaveSpeed keeps uploads 7 days: reused for 5

export type ServiceId = "wavespeed" | "higgsfield";
export type Quality = "standard" | "best";
type Model = { label: string; path: string; usdPerSecond: number; priceNote: string };
export type Service = { id: ServiceId; label: string; keyName: string; models: Partial<Record<Quality, Model>> };

// Prices per second at 720p, without sound (WaveSpeed's model pages, 21 Nov 2026). Higgsfield's docs do not list
// Seedance 2.5's price: WaveSpeed's is used and marked as an estimate (see console.higgsfield.ai for the real one).
export const SERVICES: Record<ServiceId, Service> = {
  wavespeed: {
    id: "wavespeed",
    label: "WaveSpeed",
    keyName: "WAVESPEED_API_KEY",
    models: {
      standard: { label: "Seedance 2.5 Flash", path: "bytedance/seedance-2.5-flash/image-to-video", usdPerSecond: 0.216, priceNote: "WaveSpeed price list, 21 Nov 2026" },
      best: { label: "Seedance 2.5", path: "bytedance/seedance-2.5/image-to-video", usdPerSecond: 0.324, priceNote: "WaveSpeed price list, 21 Nov 2026" },
    },
  },
  higgsfield: {
    id: "higgsfield",
    label: "Higgsfield",
    keyName: "HIGGSFIELD_API_KEY",
    models: {
      best: { label: "Seedance 2.5", path: "bytedance/seedance-2.5/image-to-video", usdPerSecond: 0.324, priceNote: "estimate: Higgsfield does not publish this price in its docs" },
    },
  },
};

export type TakeStatus = "running" | "done" | "failed" | "interrupted";
export type Take = {
  n: number;
  service: ServiceId;
  quality: Quality;
  model: string;
  status: TakeStatus;
  started_at: string;
  ended_at?: string;
  request_id?: string;
  poll_url?: string;
  cost_usd: number; // the estimate (the services bill what they bill)
  clip?: string; // the clip it became in the song's clips folder
  error?: string;
  pid?: number;
};
export type PictureRecord = { mood?: string; takes: Take[]; upload?: { service: ServiceId; url: string; at: string } };
export type PicturesFile = { _help?: string; pictures: Record<string, PictureRecord> };
export type PictureView = { file: string; url: string; mood: string; takes: Take[]; width: number | null; height: number | null };
export type PicturesView = {
  pictures: PictureView[];
  services: { id: ServiceId; label: string; ready: boolean; keyName: string; qualities: { id: Quality; label: string; usdPerSecond: number; priceNote: string }[] }[];
  takeSeconds: number;
  defaultTakes: number;
  maxTakes: number;
  defaultCap: number;
  spentUsd: number; // estimates of the takes sent for this song
};

const HELP =
  "This song's pictures (Prepare → Pictures) and the clips animated from them: per picture, the mood words and every take " +
  "(service, request id, status, the estimated cost, the clip it became in clips\\). Written by the app.";

// ---------------------------------------------------------------- files

function songFolder(ws: Workspace, projectId: string): { root: string; dir: string } {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return { root: paths.root, dir: path.join(paths.root, PICTURES_DIR) };
}

export function readPictures(dir: string): PicturesFile {
  const file = path.join(dir, PICTURES_FILE);
  if (!existsSync(file)) return { pictures: {} };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as PicturesFile;
    return { pictures: raw.pictures && typeof raw.pictures === "object" ? raw.pictures : {} };
  } catch {
    return { pictures: {} };
  }
}
function writePictures(dir: string, f: PicturesFile): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, PICTURES_FILE), `${JSON.stringify({ _help: HELP, pictures: f.pictures }, null, 2)}\n`);
}
// Read, change and write in one go (synchronous: the takes running at the same time never overwrite each other).
function update(dir: string, file: string, change: (p: PictureRecord) => void): PictureRecord {
  const all = readPictures(dir);
  const rec = all.pictures[file] ?? { takes: [] };
  change(rec);
  all.pictures[file] = rec;
  writePictures(dir, all);
  return rec;
}
function setTake(dir: string, file: string, n: number, patch: Partial<Take>): void {
  update(dir, file, (p) => {
    const t = p.takes.find((x) => x.n === n);
    if (t) Object.assign(t, patch);
  });
}

// Pictures dropped on the board: copied into pictures\ under their own names (a free name when one is taken; the same
// content twice is not copied again).
export async function addPictures(ws: Workspace, projectId: string, files: readonly { file: string; name: string }[]): Promise<{ added: string[]; skipped: { name: string; reason: string }[] }> {
  const { dir } = songFolder(ws, projectId);
  mkdirSync(dir, { recursive: true });
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const existing = readdirSync(dir).filter((f) => PICTURE_FILE.test(f));
  for (const f of files) {
    const name = path.basename(f.name);
    if (!PICTURE_FILE.test(name)) {
      skipped.push({ name, reason: "not a picture (.jpg, .png or .webp)" });
      continue;
    }
    const info = await probeMedia(f.file).catch(() => null);
    if (!info?.width || !info.height) {
      skipped.push({ name, reason: "no picture found in the file" });
      continue;
    }
    const bytes = readFileSync(f.file);
    const same = existing.find((e) => statSync(path.join(dir, e)).size === bytes.length && readFileSync(path.join(dir, e)).equals(bytes));
    if (same) {
      skipped.push({ name, reason: `already on the board as ${same}` });
      continue;
    }
    const target = uniqueFileName(dir, name);
    copyFileSync(f.file, path.join(dir, target));
    existing.push(target);
    added.push(target);
  }
  return { added, skipped };
}

export function setMood(ws: Workspace, projectId: string, file: string, mood: unknown): string {
  const { dir } = songFolder(ws, projectId);
  if (!existsSync(path.join(dir, path.basename(file)))) throw new Error(`No picture ${file} on this song's board.`);
  const text = String(mood ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  update(dir, path.basename(file), (p) => {
    p.mood = text || undefined;
  });
  return text;
}

// Takes left "running" by a studio that stopped are interrupted (their result may still be fetched).
function markInterrupted(dir: string, isAlive: (pid: number) => boolean): void {
  const all = readPictures(dir);
  let changed = false;
  for (const rec of Object.values(all.pictures))
    for (const t of rec.takes)
      if (t.status === "running" && (!t.pid || (t.pid !== process.pid && !isAlive(t.pid)))) {
        t.status = "interrupted";
        t.error = t.request_id ? "The studio stopped while this take was being made: get its result (free)." : "The studio stopped before this take was sent: nothing was spent.";
        changed = true;
      }
  if (changed) writePictures(dir, all);
}

export function keyFor(service: ServiceId, env: NodeJS.ProcessEnv = process.env): string | null {
  return env[SERVICES[service].keyName]?.trim() || null;
}

export async function picturesView(ws: Workspace, projectId: string, env: NodeJS.ProcessEnv = process.env, isAlive: (pid: number) => boolean = processAlive): Promise<PicturesView> {
  const { dir } = songFolder(ws, projectId);
  if (existsSync(dir)) markInterrupted(dir, isAlive);
  const all = readPictures(dir);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => PICTURE_FILE.test(f) && statSync(path.join(dir, f)).isFile()) : [];
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const rel = path.relative(ws.dir, dir).split(path.sep).join("/");
  const pictures: PictureView[] = [];
  for (const f of files) {
    const info = await probeMedia(path.join(dir, f)).catch(() => null);
    const rec = all.pictures[f];
    pictures.push({ file: f, url: `${rel}/${f}`, mood: rec?.mood ?? "", takes: rec?.takes ?? [], width: info?.width ?? null, height: info?.height ?? null });
  }
  const stub = !!env.LYRIC_GENERATE_STUB;
  return {
    pictures,
    services: (Object.values(SERVICES) as Service[]).map((s) => ({
      id: s.id,
      label: s.label,
      keyName: s.keyName,
      ready: stub || !!keyFor(s.id, env),
      qualities: (Object.entries(s.models) as [Quality, Model][]).map(([id, m]) => ({ id, label: m.label, usdPerSecond: m.usdPerSecond, priceNote: m.priceNote })),
    })),
    takeSeconds: TAKE_SECONDS,
    defaultTakes: DEFAULT_TAKES,
    maxTakes: MAX_TAKES,
    defaultCap: DEFAULT_CAP_USD,
    spentUsd: Math.round(Object.values(all.pictures).flatMap((p) => p.takes).filter((t) => t.request_id && t.status !== "failed").reduce((s, t) => s + t.cost_usd, 0) * 100) / 100,
  };
}

// ---------------------------------------------------------------- the request

// The app's prompt: gentle, natural motion that keeps the picture as it is; Paul's mood words, if any, at the end.
export function motionPrompt(mood?: string): string {
  const base =
    "Bring this picture to life with gentle, natural motion: a light breeze, hair and fabric moving softly, small natural movements of the people, " +
    "soft shifts in the light, and a slow, subtle camera drift. Keep the people, faces, clothes, colours, light and composition exactly as in the picture. " +
    "One continuous shot, no cuts, no text, no subtitles, no logos.";
  const m = mood?.replace(/\s+/g, " ").trim();
  return m ? `${base} Mood: ${m}.` : base;
}

export type Estimate = { takes: number; seconds: number; usdPerTake: number; usd: number; model: string; priceNote: string };
export function estimate(service: ServiceId, quality: Quality, takes: number): Estimate {
  const s = SERVICES[service];
  const m = s.models[quality] ?? s.models.best!;
  const usdPerTake = Math.round(m.usdPerSecond * TAKE_SECONDS * 100) / 100;
  return { takes, seconds: TAKE_SECONDS, usdPerTake, usd: Math.round(usdPerTake * takes * 100) / 100, model: m.label, priceNote: m.priceNote };
}

// One service's calls. `download` writes the finished video to a file.
export type Transport = {
  upload: (file: string) => Promise<string>; // a public URL of the picture
  submit: (imageUrl: string, prompt: string) => Promise<{ id: string; pollUrl?: string }>;
  poll: (id: string, pollUrl?: string) => Promise<{ status: "running" } | { status: "done"; url: string } | { status: "failed"; error: string }>;
  download: (url: string, file: string) => Promise<void>;
};

const WAVESPEED = "https://api.wavespeed.ai/api/v3";
const HIGGSFIELD = "https://api.higgsfield.ai";
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

async function json(r: Response, what: string): Promise<Record<string, unknown>> {
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  if (!r.ok) {
    const msg = (body.message ?? body.detail ?? body.error ?? text.slice(0, 200)) as unknown;
    const hint = r.status === 401 || r.status === 403 ? " (check the key in D:\\videomaker\\.env)" : r.status === 402 ? " (top up your balance on the service)" : "";
    throw new Error(`${what}: HTTP ${r.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}${hint}`);
  }
  return body;
}
const data = (b: Record<string, unknown>) => ((b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>);

// WaveSpeed's direct upload: a ticket, then the bytes PUT to it; the picture's public URL lives 7 days.
async function waveSpeedUpload(key: string, file: string, f: typeof fetch): Promise<string> {
  const bytes = readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const ticket = data(await json(await f(`${WAVESPEED}/media/uploads`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ filename: `picture${ext}`, size: bytes.length, content_type: MIME[ext] ?? "image/jpeg" }) }), "WaveSpeed upload"));
  const up = ticket.upload as { method?: string; url?: string; headers?: Record<string, string> } | undefined;
  const url = ticket.download_url;
  if (!up?.url || typeof url !== "string") throw new Error("WaveSpeed upload: no upload address in the answer");
  const put = await f(up.url, { method: up.method ?? "PUT", headers: up.headers ?? {}, body: bytes });
  if (!put.ok) throw new Error(`WaveSpeed upload: HTTP ${put.status} when sending the picture`);
  return url;
}

export function waveSpeedTransport(key: string, model: string, f: typeof fetch = (...a) => globalThis.fetch(...a)): Transport {
  const auth = { Authorization: `Bearer ${key}` };
  return {
    upload: (file) => waveSpeedUpload(key, file, f),
    submit: async (image, prompt) => {
      const b = data(await json(await f(`${WAVESPEED}/${model}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ image, prompt, duration: TAKE_SECONDS, resolution: RESOLUTION, generate_audio: false, output_format: "mp4" }) }), "WaveSpeed"));
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

// Higgsfield takes the picture only as a public URL (no upload of its own): it goes up through WaveSpeed's upload
// when that key is there, else fal's storage (FAL_KEY).
export function higgsfieldTransport(key: string, model: string, env: NodeJS.ProcessEnv = process.env, f: typeof fetch = (...a) => globalThis.fetch(...a)): Transport {
  const auth = { Authorization: `Key ${key}` };
  return {
    upload: async (file) => {
      const ws = keyFor("wavespeed", env);
      if (ws) return waveSpeedUpload(ws, file, f);
      const fal = env.FAL_KEY?.trim();
      if (!fal) throw new Error("Higgsfield needs the picture online first: add WAVESPEED_API_KEY or FAL_KEY to D:\\videomaker\\.env (used only to put the picture online).");
      const { createFalClient } = await import("@fal-ai/client");
      const client = createFalClient({ credentials: fal, suppressLocalCredentialsWarning: true });
      return client.storage.upload(new Blob([readFileSync(file)], { type: MIME[path.extname(file).toLowerCase()] ?? "image/jpeg" }));
    },
    submit: async (image, prompt) => {
      const b = await json(await f(`${HIGGSFIELD}/${model}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ image_url: image, prompt, duration: TAKE_SECONDS, resolution: RESOLUTION, generate_audio: false }) }), "Higgsfield");
      if (typeof b.request_id !== "string") throw new Error("Higgsfield: no request id in the answer");
      return { id: b.request_id, pollUrl: typeof b.status_url === "string" ? b.status_url : undefined };
    },
    poll: async (id, pollUrl) => {
      const r = await f(pollUrl ?? `${HIGGSFIELD}/requests/${encodeURIComponent(id)}/status`, { headers: auth });
      if (r.status === 429 || r.status >= 500) return { status: "running" };
      const b = await json(r, "Higgsfield");
      const s = String(b.status ?? "");
      if (s === "completed") {
        const url = (b.video as { url?: string } | undefined)?.url;
        return url ? { status: "done", url } : { status: "failed", error: "finished without a video" };
      }
      if (s === "nsfw") return { status: "failed", error: "Higgsfield's content check refused this picture or result" };
      if (s === "failed" || s === "canceled") return { status: "failed", error: String(b.error || s) };
      return { status: "running" };
    },
    download: (url, file) => download(url, file, writeFileSync, undefined, f),
  };
}

// The browser tests' and the cloud's stand-in (LYRIC_GENERATE_STUB=1): a 5 s clip made from the picture by FFmpeg,
// nothing sent anywhere. LYRIC_GENERATE_STUB=fail makes every take fail.
export function stubTransport(mode: string): Transport {
  const pictures = new Map<string, string>();
  let n = 0;
  return {
    upload: async (file) => {
      const url = `stub://${++n}`;
      pictures.set(url, file);
      return url;
    },
    submit: async (image) => {
      if (mode === "fail") throw new Error("stand-in: the service refused the request");
      return { id: `stub-${image.slice(7)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, pollUrl: image };
    },
    poll: async (_id, pollUrl) => ({ status: "done", url: pollUrl ?? "" }),
    download: async (url, file) => {
      const picture = pictures.get(url);
      if (!picture) throw new Error("stand-in: unknown picture");
      execFileSync(ffmpegBin(), ["-y", "-v", "error", "-loop", "1", "-i", picture, "-t", String(TAKE_SECONDS), "-r", "30", "-vf", `scale=trunc(iw/2)*2:trunc(ih/2)*2,noise=alls=12:allf=t:all_seed=${Math.floor(Math.random() * 1e6)},format=yuv420p`, "-c:v", "libx264", "-preset", "ultrafast", file]);
    },
  };
}

export function transportFor(service: ServiceId, quality: Quality, env: NodeJS.ProcessEnv = process.env): Transport {
  if (env.LYRIC_GENERATE_STUB) return stubTransport(env.LYRIC_GENERATE_STUB);
  const key = keyFor(service, env);
  const s = SERVICES[service];
  if (!key) throw new Error(`No ${s.keyName} in .env: add a line ${s.keyName}=<your key from ${service === "wavespeed" ? "wavespeed.ai → API keys" : 'open.higgsfield.ai → API keys, written as "key id:key secret"'}> to D:\\videomaker\\.env, then restart Lyric Studio.`);
  const model = (s.models[quality] ?? s.models.best!).path;
  return service === "wavespeed" ? waveSpeedTransport(key, model) : higgsfieldTransport(key, model, env);
}

// ---------------------------------------------------------------- animate

export type AnimateOptions = { service: ServiceId; quality?: Quality; takes?: number; capUsd?: number };

// Checks a press of Animate and records its takes as running; returns them (the caller starts runTakes without waiting).
export function startAnimate(ws: Workspace, projectId: string, file: string, o: AnimateOptions, env: NodeJS.ProcessEnv = process.env): { takes: Take[]; estimate: Estimate } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  if (!name || !existsSync(path.join(dir, name)) || !PICTURE_FILE.test(name)) throw new Error(`No picture ${file} on this song's board.`);
  if (!(o.service in SERVICES)) throw new Error("Choose WaveSpeed or Higgsfield.");
  const s = SERVICES[o.service];
  const quality: Quality = o.quality && s.models[o.quality] ? o.quality : s.models.standard ? "standard" : "best";
  const takes = Math.round(Number(o.takes ?? DEFAULT_TAKES));
  if (!Number.isFinite(takes) || takes < 1 || takes > MAX_TAKES) throw new Error(`Make 1 to ${MAX_TAKES} takes at a time.`);
  if (!env.LYRIC_GENERATE_STUB && !keyFor(o.service, env)) transportFor(o.service, quality, env); // throws the plain-words message
  const e = estimate(o.service, quality, takes);
  const cap = Number(o.capUsd ?? DEFAULT_CAP_USD);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (e.usd > cap) throw new Error(`${takes} takes cost about $${e.usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: make fewer takes or raise the cap. Nothing was sent.`);
  const now = new Date().toISOString();
  let made: Take[] = [];
  update(dir, name, (p) => {
    const first = p.takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
    made = Array.from({ length: takes }, (_, i) => ({ n: first + i, service: o.service, quality, model: e.model, status: "running" as const, started_at: now, cost_usd: e.usdPerTake, pid: process.pid }));
    p.takes.push(...made);
  });
  return { takes: made, estimate: e };
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Makes the takes (in parallel): the picture online once, each request sent once, its result polled, downloaded and
// put at the end of the song's clips. `resume`: takes that already have a request id are only polled and fetched.
export async function runTakes(openWs: () => Workspace, projectId: string, file: string, ns: number[], o: { env?: NodeJS.ProcessEnv; transport?: Transport; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number } = {}): Promise<void> {
  const env = o.env ?? process.env;
  const sleep = o.sleep ?? sleepMs;
  const ws = openWs();
  let dir: string;
  try {
    dir = songFolder(ws, projectId).dir;
  } finally {
    ws.close();
  }
  const picture = path.join(dir, file);
  const rec = readPictures(dir).pictures[file];
  const takes = (rec?.takes ?? []).filter((t) => ns.includes(t.n));
  if (!takes.length) return;
  const { service, quality } = takes[0];
  let transport: Transport;
  try {
    transport = o.transport ?? transportFor(service, quality, env);
  } catch (error) {
    for (const t of takes) setTake(dir, file, t.n, { status: "failed", error: errorText(error), ended_at: new Date().toISOString(), pid: undefined });
    return;
  }
  // The picture's public URL: made once and reused while the service keeps it.
  let imageUrl: string | null = null;
  const needsUpload = takes.some((t) => !t.request_id);
  if (needsUpload) {
    const known = readPictures(dir).pictures[file]?.upload;
    if (known && known.service === service && Date.now() - Date.parse(known.at) < UPLOAD_KEEP_MS && !env.LYRIC_GENERATE_STUB && !o.transport) imageUrl = known.url;
    else {
      try {
        imageUrl = await transport.upload(picture);
        const url = imageUrl;
        update(dir, file, (p) => {
          p.upload = { service, url, at: new Date().toISOString() };
        });
      } catch (error) {
        for (const t of takes.filter((x) => !x.request_id)) setTake(dir, file, t.n, { status: "failed", error: `The picture could not be put online: ${errorText(error)}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
      }
    }
  }
  const mood = readPictures(dir).pictures[file]?.mood;
  // The takes are made at the same time, but join the clips in their own order (take 1, 2, 3), whichever comes back first.
  const turns = takes.map(() => {
    let done!: () => void;
    const p = new Promise<void>((r) => (done = r));
    return { p, done };
  });
  await Promise.all(
    takes.map(async (t, k) => {
      let id = t.request_id;
      let pollUrl = t.poll_url;
      try {
        setTake(dir, file, t.n, { status: "running", pid: process.pid, error: undefined });
        if (!id) {
          if (!imageUrl) return;
          const sent = await transport.submit(imageUrl, motionPrompt(mood)); // never retried: a retry could be billed twice
          id = sent.id;
          pollUrl = sent.pollUrl;
          setTake(dir, file, t.n, { request_id: id, poll_url: pollUrl });
        }
        const t0 = Date.now();
        let url: string | null = null;
        for (;;) {
          const s = await transport.poll(id, pollUrl);
          if (s.status === "done") {
            url = s.url;
            break;
          }
          if (s.status === "failed") throw new Error(`${SERVICES[service].label}: ${s.error}`);
          if (Date.now() - t0 > (o.timeoutMs ?? TIMEOUT_MS)) throw new Error(`no answer within ${Math.round((o.timeoutMs ?? TIMEOUT_MS) / 60000)} min: get its result later (free)`);
          await sleep(o.pollMs ?? POLL_MS);
        }
        const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-take-"));
        try {
          const base = path.parse(file).name;
          const out = path.join(tmp, `${base} take ${t.n}.mp4`);
          await transport.download(url, out);
          if (k > 0) await turns[k - 1].p;
          const w = openWs();
          try {
            const r = await importSongClips(w, projectId, [{ file: out, name: path.basename(out) }]);
            const clip = r.added[0] ?? r.duplicates[0]?.sameAs;
            if (!clip) throw new Error(r.skipped[0]?.reason ?? "the clip could not be added");
            setTake(dir, file, t.n, { status: "done", clip, ended_at: new Date().toISOString(), pid: undefined });
          } finally {
            w.close();
          }
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      } catch (error) {
        setTake(dir, file, t.n, { status: id ? "interrupted" : "failed", error: id ? `${errorText(error)} (sent: get its result later, free)` : `${errorText(error)}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
      } finally {
        turns[k].done();
      }
    }),
  );
}

// "Get result": takes that were sent (they have a request id) but did not come back; only polled and fetched (free).
export function startResume(ws: Workspace, projectId: string, file: string, n: number): Take {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(file);
  const t = readPictures(dir).pictures[name]?.takes.find((x) => x.n === n);
  if (!t) throw new Error("No such take.");
  if (t.status === "running") throw new Error("This take is still being made.");
  if (!t.request_id) throw new Error("This take was never sent: animate the picture again.");
  if (t.status === "done") throw new Error("This take is already in your clips.");
  setTake(dir, name, n, { status: "running", pid: process.pid, error: undefined });
  return t;
}
