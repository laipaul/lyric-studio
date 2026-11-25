// Make final (25 Nov 2026, from Paul's draft test): a Draft take (Seedance 2.5 Flash at 480p, about $0.54 for 5 s) that
// Paul likes is upscaled with WaveSpeed's Video Upscaler Pro to 1080p (about $0.04 a second). WaveSpeed's Seedance has
// no seed, so a full-quality re-run would move differently; the upscale keeps exactly the take he chose. In the test
// the upscaled draft was hard to tell from a full-quality take (about $1.62) and sharper in the face and lace.
// The final is its own take, right after the draft (finalOf: the draft's number; the draft gets final: its number).
// The draft stays: nothing is deleted. Each request is sent once and never retried (a retry could be billed twice).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { uniqueFileName, type Workspace } from "@lyric/db";

import { errorText } from "./characters/fal";
import { data, json, keyFor, makePlayable, nextTakeN, readPictures, songFolder, setTake, TAKES_DIR, update, WAVESPEED, waveSpeedTransport, waveSpeedUpload, type Take } from "./animate";

export const FINAL_MODEL = { label: "Video Upscaler Pro 1080p", path: "wavespeed-ai/video-upscaler-pro", target: "1080p", usdPerSecond: 0.04, minSeconds: 3, priceNote: "WaveSpeed price list, 25 Nov 2026" };
export const finalUsd = (seconds: number) => Math.round(Math.max(FINAL_MODEL.minSeconds, Math.ceil(seconds)) * FINAL_MODEL.usdPerSecond * 1000) / 1000;

// Checks a press of Make final on draft take n and records the final as running; the caller starts runFinal.
export function startFinal(ws: Workspace, projectId: string, file: string, n: unknown, env: NodeJS.ProcessEnv = process.env): Take {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const draft = readPictures(dir).pictures[name]?.takes.find((t) => t.n === Number(n));
  if (!draft) throw new Error("No such take.");
  if (draft.quality !== "draft") throw new Error("Only a Draft take can be made final (the others are already full quality).");
  if (draft.status !== "done" || !draft.file || !existsSync(path.join(dir, draft.file))) throw new Error("This draft is not finished yet.");
  const before = readPictures(dir).pictures[name]?.takes.find((t) => t.finalOf === draft.n && t.status !== "failed");
  if (before) throw new Error(before.status === "running" ? "Its final is being made." : `It already has a final (take ${before.n}).`);
  if (!env.LYRIC_GENERATE_STUB && !keyFor("wavespeed", env)) throw new Error("No WAVESPEED_API_KEY in D:\\videomaker\\.env: add your key from wavespeed.ai → API keys, then restart Lyric Studio.");
  const seconds = draft.seconds ?? 5;
  let made: Take | undefined;
  update(dir, name, (p) => {
    made = {
      n: nextTakeN(p),
      service: "wavespeed",
      quality: "best",
      model: FINAL_MODEL.label,
      status: "running",
      started_at: new Date().toISOString(),
      cost_usd: finalUsd(seconds),
      seconds,
      finalOf: draft.n,
      ...(draft.label ? { label: `${draft.label} final` } : {}),
      ...(draft.filmLook ? { filmLook: draft.filmLook, look: draft.look } : {}),
      ...(draft.feel ? { feel: draft.feel } : {}),
      ...(draft.feeling ? { feeling: draft.feeling } : {}),
      ...(draft.feelingTo ? { feelingTo: draft.feelingTo } : {}),
      pid: process.pid,
    };
    p.takes.push(made);
    const d = p.takes.find((t) => t.n === draft.n);
    if (d) d.final = made.n;
  });
  return made!;
}

export type FinalDeps = { env?: NodeJS.ProcessEnv; f?: typeof fetch; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number };

// Puts the draft online, sends it to the upscaler once, waits, and files the result as the final take.
export async function runFinal(openWs: () => Workspace, projectId: string, file: string, n: number, deps: FinalDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const f = deps.f ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ws = openWs();
  let dir: string;
  try {
    dir = songFolder(ws, projectId).dir;
  } finally {
    ws.close();
  }
  const takes = readPictures(dir).pictures[file]?.takes ?? [];
  const t = takes.find((x) => x.n === n);
  const draft = takes.find((x) => x.n === t?.finalOf);
  if (!t || !draft?.file) return;
  const save = (src: string) => {
    const takesDir = path.join(dir, TAKES_DIR);
    mkdirSync(takesDir, { recursive: true });
    const out = uniqueFileName(takesDir, `${path.parse(file).name} take ${draft.n} final.mp4`);
    copyFileSync(src, path.join(takesDir, out));
    setTake(dir, file, n, { status: "done", file: `${TAKES_DIR}/${out}`, playable: true, ended_at: new Date().toISOString(), pid: undefined });
  };
  let id = t.request_id;
  try {
    if (env.LYRIC_GENERATE_STUB) {
      if (env.LYRIC_GENERATE_STUB === "fail") throw new Error("stand-in: the service refused the request");
      save(path.join(dir, draft.file)); // the browser tests and the cloud: the draft itself stands in for the final
      return;
    }
    const key = keyFor("wavespeed", env);
    if (!key) throw new Error("No WAVESPEED_API_KEY in .env");
    const poller = waveSpeedTransport(key, FINAL_MODEL.path, f);
    if (!id) {
      const video = await waveSpeedUpload(key, path.join(dir, draft.file), f);
      const b = data(await json(await f(`${WAVESPEED}/${FINAL_MODEL.path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ video, target_resolution: FINAL_MODEL.target }) }), "WaveSpeed upscaler"));
      if (typeof b.id !== "string") throw new Error("WaveSpeed upscaler: no request id in the answer");
      id = b.id;
      setTake(dir, file, n, { request_id: id });
    }
    const t0 = Date.now();
    let url: string;
    for (;;) {
      const s = await poller.poll(id);
      if (s.status === "done") {
        url = s.url;
        break;
      }
      if (s.status === "failed") throw new Error(`WaveSpeed upscaler: ${s.error}`);
      if (Date.now() - t0 > (deps.timeoutMs ?? 20 * 60 * 1000)) throw new Error("no answer within 20 min: get its result later (free)");
      await sleep(deps.pollMs ?? 4000);
    }
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-final-"));
    try {
      const out = path.join(tmp, "final.mp4");
      await poller.download(url, out);
      makePlayable(out, false);
      save(out);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } catch (error) {
    setTake(dir, file, n, { status: id ? "interrupted" : "failed", error: id ? `${errorText(error)} (sent: get its result later, free)` : `${errorText(error)}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
  }
}
