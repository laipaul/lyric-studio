// Prices: fal's own price list (GET https://api.fal.ai/v1/models/pricing, with the fal key), read before anything is
// sent. When fal does not answer, the spike falls back to prices seen on other sites (marked "not confirmed" in the
// estimate). fal's billing for each request is read afterwards when the key may (as in C1), else the dashboard shows it.

export type Price = { unitPrice: number; unit: string; source: "fal" | "fallback" };

export const PRICING_URL = "https://api.fal.ai/v1/models/pricing";

// Seen on other sites on 18 Nov 2026 (fal.ai itself was out of reach): to be replaced by fal's own list on the PC.
export const FALLBACK_PRICES: Record<string, Price> = {
  "wan-480p": { unitPrice: 0.04, unit: "second", source: "fallback" },
  "wan-720p": { unitPrice: 0.08, unit: "second", source: "fallback" },
  "h3-768p": { unitPrice: 0.3, unit: "second", source: "fallback" },
  "h3-1080p": { unitPrice: 0.45, unit: "second", source: "fallback" },
  depth: { unitPrice: 0.01, unit: "image", source: "fallback" },
  seedream: { unitPrice: 0.04, unit: "image", source: "fallback" }, // checked on fal in C1 (17 Nov 2026)
  "seedance-480p": { unitPrice: 0.12, unit: "second", source: "fallback" },
};

export async function fetchPrices(key: string, ids: string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, Price> | { error: string }> {
  try {
    const q = new URLSearchParams();
    for (const id of ids) q.append("endpoint_id", id);
    const r = await fetchImpl(`${PRICING_URL}?${q}`, { headers: { Authorization: `Key ${key}` } });
    if (!r.ok) return { error: `fal answered HTTP ${r.status}` };
    const j = (await r.json()) as { prices?: { endpoint_id: string; unit_price: number; unit: string }[] };
    const out: Record<string, Price> = {};
    for (const p of j.prices ?? []) out[p.endpoint_id] = { unitPrice: Number(p.unit_price), unit: String(p.unit), source: "fal" };
    return out;
  } catch (error) {
    return { error: (error as Error).message };
  }
}

// What one request costs: seconds of video (some endpoints bill frames normalised to 16 fps: `fpsFactor`), a picture,
// a megapixel, or a whole video. An unknown unit counts as one unit (and says so).
export function costOf(p: Price, o: { seconds?: number; megapixels?: number; fpsFactor?: number }): { usd: number; note: string | null } {
  const u = p.unit.toLowerCase();
  if (/second/.test(u)) return { usd: p.unitPrice * (o.seconds ?? 0) * (o.fpsFactor ?? 1), note: null };
  if (/minute/.test(u)) return { usd: (p.unitPrice * (o.seconds ?? 0) * (o.fpsFactor ?? 1)) / 60, note: null };
  if (/megapixel/.test(u)) return { usd: p.unitPrice * (o.megapixels ?? 1), note: null };
  if (/image|video|request|unit|generation/.test(u)) return { usd: p.unitPrice, note: null };
  return { usd: p.unitPrice, note: `fal's unit "${p.unit}" is not one the spike knows: counted once` };
}

export const money = (usd: number) => `$${usd.toFixed(2)}`;
