// The three fal.ai lip-sync models behind one interface. Endpoint IDs, inputs and prices were checked on fal.ai's
// model pages (llms.txt + OpenAPI) on 17 Nov 2026:
//   fal-ai/sync-lipsync/v2                    video_url, audio_url, model "lipsync-2", sync_mode "cut_off"
//   fal-ai/kling-video/lipsync/audio-to-video video_url (.mp4, 2-10 s, 720-1920 px per side), audio_url (2-60 s, <= 5 MB)
//   fal-ai/infinitalk/video-to-video          video_url, audio_url, prompt (required), num_frames 41-241, resolution 480p|720p
// All three return { video: { url } }.
import type { FalClient } from "@fal-ai/client";

import { estimateCost, infinitalkFrames, type ProviderId } from "./plan";

export type LipSyncJob = { videoUrl: string; audioUrl: string; durationS: number; prompt: string };
export type Submitted = { requestId: string };
export type PollState = { state: "queued" | "running" | "done"; position?: number };

export interface LipSyncProvider {
  id: ProviderId;
  name: string;
  endpoint: string;
  estimateCost(durationS: number): number;
  input(job: LipSyncJob): Record<string, unknown>;
  submit(fal: FalClient, job: LipSyncJob): Promise<Submitted>;
  poll(fal: FalClient, requestId: string): Promise<PollState>;
  download(fal: FalClient, requestId: string): Promise<{ url: string; data: unknown }>;
  cancel(fal: FalClient, requestId: string): Promise<void>;
}

function falProvider(id: ProviderId, name: string, endpoint: string, input: (job: LipSyncJob) => Record<string, unknown>): LipSyncProvider {
  return {
    id,
    name,
    endpoint,
    estimateCost: (d) => estimateCost(id, d),
    input,
    async submit(fal, job) {
      const r = await fal.queue.submit(endpoint, { input: input(job) });
      return { requestId: r.request_id };
    },
    async poll(fal, requestId) {
      const s = await fal.queue.status(endpoint, { requestId, logs: false });
      if (s.status === "COMPLETED") return { state: "done" };
      if (s.status === "IN_QUEUE") return { state: "queued", position: s.queue_position };
      return { state: "running" };
    },
    async download(fal, requestId) {
      const r = await fal.queue.result(endpoint, { requestId }); // throws the model's error when the request failed
      const data = r.data as { video?: { url?: string } };
      const url = data?.video?.url;
      if (!url) throw new Error(`no video in the answer (${JSON.stringify(data).slice(0, 200)})`);
      return { url, data };
    },
    async cancel(fal, requestId) {
      await fal.queue.cancel(endpoint, { requestId }).catch(() => undefined);
    },
  };
}

export const PROVIDERS: Record<ProviderId, LipSyncProvider> = {
  sync: falProvider("sync", "Sync lipsync 2", "fal-ai/sync-lipsync/v2", (j) => ({
    video_url: j.videoUrl,
    audio_url: j.audioUrl,
    model: "lipsync-2",
    sync_mode: "cut_off", // video and audio have the same length; cut_off never loops or stretches
  })),
  kling: falProvider("kling", "Kling LipSync", "fal-ai/kling-video/lipsync/audio-to-video", (j) => ({
    video_url: j.videoUrl,
    audio_url: j.audioUrl,
  })),
  infinitetalk: falProvider("infinitetalk", "InfiniteTalk", "fal-ai/infinitalk/video-to-video", (j) => ({
    video_url: j.videoUrl,
    audio_url: j.audioUrl,
    prompt: j.prompt,
    num_frames: infinitalkFrames(j.durationS),
    resolution: "480p",
    seed: 42,
    acceleration: "regular",
  })),
};

export const DEFAULT_PROMPT = "The person in the video sings these words with natural, expressive mouth movement; keep the scene, lighting, framing and camera movement exactly as they are.";

export type Attempt = { request_id: string | null; started_at: string; ended_at: string; outcome: string };

// Submit, poll until done (or `timeoutMs`), fetch the answer; on a failure or timeout try once more.
export async function runWithRetry(
  fal: FalClient,
  p: LipSyncProvider,
  job: LipSyncJob,
  opts: { timeoutMs: number; pollMs: number; log: (m: string) => void; sleep?: (ms: number) => Promise<void> },
): Promise<{ url: string; attempts: Attempt[] }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts: Attempt[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    const started = new Date(t0);
    let requestId: string | null = null;
    try {
      requestId = (await p.submit(fal, job)).requestId;
      opts.log(`${p.name}: sent (request ${requestId})${attempt > 1 ? ", second try" : ""}`);
      let last = "";
      for (;;) {
        if (Date.now() - t0 > opts.timeoutMs) {
          await p.cancel(fal, requestId);
          throw new Error(`no answer within ${Math.round(opts.timeoutMs / 60000)} min`);
        }
        const s = await p.poll(fal, requestId);
        const now = s.state === "queued" ? `waiting in fal's queue${s.position !== undefined ? ` (position ${s.position})` : ""}` : s.state === "running" ? "working" : "done";
        if (now !== last) opts.log(`${p.name}: ${now}`);
        last = now;
        if (s.state === "done") break;
        await sleep(opts.pollMs);
      }
      const { url } = await p.download(fal, requestId);
      attempts.push({ request_id: requestId, started_at: started.toISOString(), ended_at: new Date(Date.now()).toISOString(), outcome: "done" });
      return { url, attempts };
    } catch (error) {
      const msg = errorText(error);
      attempts.push({ request_id: requestId, started_at: started.toISOString(), ended_at: new Date(Date.now()).toISOString(), outcome: `failed: ${msg}` });
      opts.log(`${p.name}: failed (${msg})${attempt === 1 ? ", trying once more" : ""}`);
    }
  }
  throw Object.assign(new Error(attempts.map((a) => a.outcome.replace(/^failed: /, "")).join("; then: ")), { attempts });
}

// The fal client's errors carry the model's message in `body.detail`; never the key.
export function errorText(error: unknown): string {
  const e = error as { message?: string; status?: number; body?: { detail?: unknown } };
  const detail = e?.body?.detail;
  const d = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((x) => (x as { msg?: string }).msg ?? JSON.stringify(x)).join("; ") : "";
  const text = [e?.status ? `HTTP ${e.status}` : "", e?.message ?? String(error), d].filter(Boolean).join(": ");
  return text.replace(/Key\s+[A-Za-z0-9:_-]{8,}/g, "Key ***").slice(0, 400);
}
