// fal.ai calls of the spike: submit to the queue, poll, fetch the answer (one retry on a failure or timeout), and
// the actual charge per request from fal's Billing Events API (needs a key with billing permission).
import type { FalClient } from "@fal-ai/client";

export type Attempt = { request_id: string | null; started_at: string; ended_at: string; outcome: string };

export async function callModel(
  fal: FalClient,
  endpoint: string,
  input: Record<string, unknown>,
  opts: { timeoutMs: number; pollMs: number; log?: (m: string) => void; sleep?: (ms: number) => Promise<void> },
): Promise<{ data: Record<string, unknown>; requestId: string; attempts: Attempt[] }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts: Attempt[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    let requestId: string | null = null;
    try {
      requestId = (await fal.queue.submit(endpoint, { input })).request_id;
      for (;;) {
        if (Date.now() - t0 > opts.timeoutMs) {
          await fal.queue.cancel(endpoint, { requestId }).catch(() => undefined);
          throw new Error(`no answer within ${Math.round(opts.timeoutMs / 60000)} min`);
        }
        const s = await fal.queue.status(endpoint, { requestId, logs: false });
        if (s.status === "COMPLETED") break;
        await sleep(opts.pollMs);
      }
      const r = await fal.queue.result(endpoint, { requestId });
      attempts.push({ request_id: requestId, started_at: new Date(t0).toISOString(), ended_at: new Date(Date.now()).toISOString(), outcome: "done" });
      return { data: r.data as Record<string, unknown>, requestId, attempts };
    } catch (error) {
      const msg = errorText(error);
      attempts.push({ request_id: requestId, started_at: new Date(t0).toISOString(), ended_at: new Date(Date.now()).toISOString(), outcome: `failed: ${msg}` });
      opts.log?.(`failed (${msg})${attempt === 1 ? ", trying once more" : ""}`);
    }
  }
  throw Object.assign(new Error(attempts.map((a) => a.outcome.replace(/^failed: /, "")).join("; then: ")), { attempts });
}

export function firstImageUrl(data: Record<string, unknown>): string {
  const images = data.images as { url?: string }[] | undefined;
  const url = images?.[0]?.url;
  if (!url) throw new Error(`no image in the answer (${JSON.stringify(data).slice(0, 200)})`);
  return url;
}

export function errorText(error: unknown): string {
  const e = error as { message?: string; status?: number; body?: { detail?: unknown } };
  const detail = e?.body?.detail;
  const d = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((x) => (x as { msg?: string }).msg ?? JSON.stringify(x)).join("; ") : "";
  const text = [e?.status ? `HTTP ${e.status}` : "", e?.message ?? String(error), d].filter(Boolean).join(": ");
  return text.replace(/Key\s+[A-Za-z0-9:_-]{8,}/g, "Key ***").slice(0, 400);
}

const DOWNLOAD_WAITS_MS = [1000, 2000, 4000, 8000, 15000];

// Downloads the result image: up to 6 tries (waits 1, 2, 4, 8, 15 s) on network errors and HTTP 5xx / 429; any other
// HTTP 4xx gives up at once. `sleep` and `fetchImpl` can be replaced (tests).
export async function download(
  url: string,
  file: string,
  write: (file: string, data: Buffer) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a),
): Promise<void> {
  let last: unknown;
  for (let i = 0; i <= DOWNLOAD_WAITS_MS.length; i++) {
    let retry = true;
    try {
      const r = await fetchImpl(url);
      if (!r.ok) {
        retry = r.status >= 500 || r.status === 429;
        throw new Error(`HTTP ${r.status}`);
      }
      write(file, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (error) {
      last = error;
      if (!retry || i === DOWNLOAD_WAITS_MS.length) break;
      await sleep(DOWNLOAD_WAITS_MS[i]);
    }
  }
  throw new Error(`the image could not be downloaded (${errorText(last)})`);
}

// ---- actual cost (fal Billing Events: GET https://api.fal.ai/v1/models/billing-events) ----

export type ActualCost =
  | { status: "ok"; byRequest: Record<string, number>; missing: string[] }
  | { status: "no_permission"; message: string }
  | { status: "failed"; message: string };

export const BILLING_URL = "https://api.fal.ai/v1/models/billing-events";

export async function actualCosts(key: string, requestIds: string[], startIso: string, fetchImpl: typeof fetch = fetch): Promise<ActualCost> {
  const byRequest: Record<string, number> = {};
  try {
    for (let i = 0; i < requestIds.length; i += 50) {
      const q = new URLSearchParams({ start: startIso, limit: "1000" });
      for (const id of requestIds.slice(i, i + 50)) q.append("request_id", id);
      let cursor: string | null = null;
      do {
        if (cursor) q.set("cursor", cursor);
        const r = await fetchImpl(`${BILLING_URL}?${q}`, { headers: { Authorization: `Key ${key}` } });
        if (r.status === 401 || r.status === 403)
          return { status: "no_permission", message: "your fal key cannot read billing (it needs the BILLING or FULL preset)" };
        if (!r.ok) return { status: "failed", message: `fal answered HTTP ${r.status}` };
        const j = (await r.json()) as { billing_events?: { request_id: string; cost_total: number }[]; next_cursor?: string | null; has_more?: boolean };
        for (const e of j.billing_events ?? []) byRequest[e.request_id] = (byRequest[e.request_id] ?? 0) + Number(e.cost_total ?? 0);
        cursor = j.has_more ? (j.next_cursor ?? null) : null;
      } while (cursor);
    }
  } catch (error) {
    return { status: "failed", message: errorText(error) };
  }
  return { status: "ok", byRequest, missing: requestIds.filter((id) => !(id in byRequest)) };
}
