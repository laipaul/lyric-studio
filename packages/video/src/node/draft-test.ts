// Draft test (25 Nov 2026, Paul approved about $3): before building "Draft, then Make final", see by eye whether a
// cheap draft, upscaled, is good enough. WaveSpeed's Seedance has no seed, so a full-quality re-run never matches the
// draft: Make final can only be an upscale of the draft. One picture becomes four takes in Creation:
//   "Draft"               Seedance 2.5 Flash, 480p, 5 s          about $0.54
//   "Draft upscaled"      that draft, Video Upscaler to 1080p     about $0.03
//   "Draft upscaled Pro"  that draft, Video Upscaler Pro, 1080p  about $0.20
//   "Full quality"        Seedance 2.5, 720p, 5 s (today's take)  about $1.62
// All with the same prompt as a normal Animate take (the realism rules, the Film look, the mood). Prices: WaveSpeed's
// model pages, read 25 Nov 2026. Each request is sent once and never retried (a retry could be billed twice).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { uniqueFileName, type Workspace } from "@lyric/db";

import { data, json, makePlayable, motionPrompt, nextTakeN, PICTURE_FILE, readPictures, songFolder, TAKES_DIR, update, WAVESPEED, waveSpeedTransport, waveSpeedUpload, type Take } from "./animate";
import { feelFor, filmLookFor } from "./film-looks";

export const DRAFT_TEST_SECONDS = 5;
export type DraftTestPart = { key: "draft" | "up" | "pro" | "full"; label: string; model: string; path: string; usd: number };
export const DRAFT_TEST_PARTS: DraftTestPart[] = [
  { key: "draft", label: "Draft", model: "Seedance 2.5 Flash 480p", path: "bytedance/seedance-2.5-flash/image-to-video", usd: 0.108 * DRAFT_TEST_SECONDS },
  { key: "up", label: "Draft upscaled", model: "Video Upscaler 1080p", path: "wavespeed-ai/video-upscaler", usd: 0.005 * DRAFT_TEST_SECONDS },
  { key: "pro", label: "Draft upscaled Pro", model: "Video Upscaler Pro 1080p", path: "wavespeed-ai/video-upscaler-pro", usd: 0.04 * DRAFT_TEST_SECONDS },
  { key: "full", label: "Full quality", model: "Seedance 2.5 720p", path: "bytedance/seedance-2.5/image-to-video", usd: 0.324 * DRAFT_TEST_SECONDS },
];
export const draftTestUsd = () => Math.round(DRAFT_TEST_PARTS.reduce((s, p) => s + p.usd, 0) * 100) / 100;

export type DraftTestDeps = { key: string; f?: typeof fetch; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number; log?: (line: string) => void };
export type DraftTestResult = { label: string; file?: string; error?: string }[];

export function checkDraftTestPicture(ws: Workspace, projectId: string, picture: string): { dir: string; name: string } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(picture);
  if (!PICTURE_FILE.test(name) || !existsSync(path.join(dir, name))) {
    const have = Object.keys(readPictures(dir).pictures).filter((p) => PICTURE_FILE.test(p));
    throw new Error(`No picture "${name}" in this song's Creation.${have.length ? ` Pictures there: ${have.join(", ")}` : " Add one in Prepare → Creation first."}`);
  }
  return { dir, name };
}

export async function runDraftTest(ws: Workspace, projectId: string, picture: string, deps: DraftTestDeps): Promise<DraftTestResult> {
  const { dir, name } = checkDraftTestPicture(ws, projectId, picture);
  const f = deps.f ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? (() => undefined);
  const auth = { Authorization: `Bearer ${deps.key}`, "Content-Type": "application/json" };
  const poller = waveSpeedTransport(deps.key, "", f);
  const look = filmLookFor(ws, projectId);
  const feel = feelFor(ws, projectId);
  const prompt = motionPrompt(readPictures(dir).pictures[name]?.mood, look?.line, feel);
  const part = (k: DraftTestPart["key"]) => DRAFT_TEST_PARTS.find((p) => p.key === k)!;

  const send = async (p: DraftTestPart, body: Record<string, unknown>): Promise<string> => {
    const b = data(await json(await f(`${WAVESPEED}/${p.path}`, { method: "POST", headers: auth, body: JSON.stringify(body) }), `WaveSpeed (${p.label})`));
    if (typeof b.id !== "string") throw new Error(`WaveSpeed (${p.label}): no request id in the answer`);
    log(`  sent ${p.label} (request ${b.id})`);
    return b.id;
  };
  const wait = async (p: DraftTestPart, id: string): Promise<string> => {
    const t0 = Date.now();
    for (;;) {
      const s = await poller.poll(id);
      if (s.status === "done") return s.url;
      if (s.status === "failed") throw new Error(`WaveSpeed (${p.label}): ${s.error}`);
      if (Date.now() - t0 > (deps.timeoutMs ?? 20 * 60 * 1000)) throw new Error(`WaveSpeed (${p.label}): no answer within 20 min (request ${id})`);
      await sleep(deps.pollMs ?? 4000);
    }
  };
  // The finished video becomes a take of the picture, named so the four sit side by side in Creation.
  const keep = async (p: DraftTestPart, id: string, url: string, startedAt: string): Promise<string> => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-draft-test-"));
    try {
      const out = path.join(tmp, "take.mp4");
      await poller.download(url, out);
      makePlayable(out, false);
      const takesDir = path.join(dir, TAKES_DIR);
      mkdirSync(takesDir, { recursive: true });
      const file = uniqueFileName(takesDir, `${path.parse(name).name} ${p.label.toLowerCase()}.mp4`);
      copyFileSync(out, path.join(takesDir, file));
      update(dir, name, (rec) => {
        const take: Take = { n: nextTakeN(rec), service: "wavespeed", quality: p.key === "full" ? "best" : "standard", model: p.model, status: "done", started_at: startedAt, ended_at: new Date().toISOString(), request_id: id, cost_usd: Math.round(p.usd * 1000) / 1000, seconds: DRAFT_TEST_SECONDS, file: `${TAKES_DIR}/${file}`, playable: true, label: p.label, ...(look ? { filmLook: look.name, look: look.line } : {}), feel };
        rec.takes.push(take);
      });
      log(`  ✓ ${p.label}: ${TAKES_DIR}/${file}`);
      return `${TAKES_DIR}/${file}`;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
  const result: DraftTestResult = [];
  const done = (label: string, r: { file?: string; error?: string }) => result.push({ label, ...r });
  const run = async (p: DraftTestPart, body: Record<string, unknown>, after?: (url: string) => Promise<void>) => {
    const at = new Date().toISOString();
    let id: string | undefined;
    try {
      id = await send(p, body);
      const url = await wait(p, id);
      done(p.label, { file: await keep(p, id, url, at) });
      if (after) await after(url);
    } catch (error) {
      const msg = (error as Error).message;
      log(`  ✗ ${p.label}: ${msg}`);
      done(p.label, { error: msg });
    }
  };

  log(`Putting ${name} online…`);
  const image = await waveSpeedUpload(deps.key, path.join(dir, name), f);
  const video = { image, prompt, duration: DRAFT_TEST_SECONDS, generate_audio: false, output_format: "mp4" };
  await Promise.all([
    run(part("full"), { ...video, resolution: "720p" }),
    run(part("draft"), { ...video, resolution: "480p" }, async (draftUrl) => {
      await Promise.all([run(part("up"), { video: draftUrl, target_resolution: "1080p" }), run(part("pro"), { video: draftUrl, target_resolution: "1080p" })]);
    }),
  ]);
  const order = DRAFT_TEST_PARTS.map((p) => p.label);
  return result.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}
