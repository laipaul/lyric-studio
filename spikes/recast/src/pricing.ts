// Prices. Two sources, both printed per line in the estimate:
//  - fal's own price list (GET https://api.fal.ai/v1/models/pricing, with the fal key), read before anything is sent;
//  - the formulas fal documents on each endpoint's page ("fal docs, 18 Nov 2026"): used first where the price depends
//    on things the list's single number cannot say (Wan: resolution and frames; H3: resolution, 5 s minimum, input
//    tokens), and when the list has no entry or a unit the spike cannot compute.
// When neither can be computed the estimate is "unknown" and the run stops before anything is uploaded: an unknown
// unit is never counted as one unit. fal's billing for each request is read afterwards when the key may.

export type Source = "fal" | "fal docs" | "not confirmed";
export type Price = { unitPrice: number; unit: string; source: "fal" };
export type Estimate = { usd: number; source: Source; basis: string; note: string | null };
export type Unknown = { unknown: string };

export const PRICING_URL = "https://api.fal.ai/v1/models/pricing";
export const DOCS_DATE = "18 Nov 2026";

export type Quality = "draft" | "high";
export type FormulaInput = { durationS: number; fps: number; quality: Quality };
export type Formula = { source: "fal docs" | "not confirmed"; basis: (i: FormulaInput) => string; usd: (i: FormulaInput) => number };

const WAN_RATE = { draft: 0.04, high: 0.08 }; // per "video second" at 480p / 720p (580p: 0.06)
const WAN_FRAMES = (i: FormulaInput) => i.durationS * i.fps; // billed frames ÷ 16 = video seconds
const H3_RATE = { draft: 0.085, high: 0.17 }; // per output second at 768P / 1080P, 5 s minimum
const H3_TOKENS_PER_S = 6750;
const H3_FREE_TOKENS = 4096;
const H3_PER_1000_TOKENS = 0.022;

export const h3Seconds = (durationS: number) => Math.max(5, durationS);
export const h3Tokens = (durationS: number) => Math.max(0, Math.ceil(durationS * H3_TOKENS_PER_S) - H3_FREE_TOKENS);

export const FORMULAS: Record<string, Formula> = {
  wan: {
    source: "fal docs",
    basis: (i) => `${money(WAN_RATE[i.quality])} per video second at ${i.quality === "draft" ? "480p" : "720p"}, ${(WAN_FRAMES(i) / 16).toFixed(2)} video seconds (${i.durationS.toFixed(2)} s × ${i.fps.toFixed(0)} fps ÷ 16)`,
    usd: (i) => WAN_RATE[i.quality] * (WAN_FRAMES(i) / 16),
  },
  h3: {
    source: "fal docs",
    basis: (i) => `${money(H3_RATE[i.quality])} per output second at ${i.quality === "draft" ? "768P" : "1080P"} × ${h3Seconds(i.durationS).toFixed(2)} s (5 s minimum) + ${h3Tokens(i.durationS).toLocaleString("en-US")} input tokens × $0.022 per 1,000`,
    usd: (i) => H3_RATE[i.quality] * h3Seconds(i.durationS) + (h3Tokens(i.durationS) / 1000) * H3_PER_1000_TOKENS,
  },
  kling: { source: "fal docs", basis: (i) => `$0.168 per second × ${i.durationS.toFixed(2)} s`, usd: (i) => 0.168 * i.durationS },
  seedream: { source: "fal docs", basis: () => "$0.04 per image (Seedream 4.5)", usd: () => 0.04 },
  "nano-pro": { source: "fal docs", basis: () => "$0.15 per image (Nano Banana Pro, 1K and 2K)", usd: () => 0.15 },
  gpt: { source: "fal docs", basis: () => "about $0.24 per image (GPT Image 1.5, high quality: $0.20 + input image tokens)", usd: () => 0.24 },
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

// What one request costs by fal's unit: seconds of video (some endpoints bill frames normalised to 16 fps: `fpsFactor`),
// a picture, a megapixel or a whole video. A unit the spike does not know gives null (never "counted once").
export function costOf(p: Price, o: { seconds?: number; megapixels?: number; fpsFactor?: number }): { usd: number; note: string | null } | null {
  const u = p.unit.toLowerCase();
  if (/second/.test(u)) return { usd: p.unitPrice * (o.seconds ?? 0) * (o.fpsFactor ?? 1), note: null };
  if (/minute/.test(u)) return { usd: (p.unitPrice * (o.seconds ?? 0) * (o.fpsFactor ?? 1)) / 60, note: null };
  if (/megapixel/.test(u)) return { usd: p.unitPrice * (o.megapixels ?? 1), note: null };
  if (/image|video|request|unit|generation/.test(u)) return { usd: p.unitPrice, note: null };
  return null;
}

export type PriceSpec = { formula?: string; formulaFirst?: boolean; units: { seconds?: number; megapixels?: number; fpsFactor?: number; note?: string }; input: FormulaInput };

// The estimate of one step: the documented formula first where `formulaFirst`, else fal's list when its unit is one the
// spike can compute, else the formula, else unknown (the run stops).
export function estimate(spec: PriceSpec, fal: Price | undefined, endpoint: string): Estimate | Unknown {
  const formula = spec.formula ? FORMULAS[spec.formula] : undefined;
  const fromFormula = (): Estimate => ({ usd: formula!.usd(spec.input), source: formula!.source, basis: `${formula!.source === "fal docs" ? `fal docs, ${DOCS_DATE}` : "not confirmed"}: ${formula!.basis(spec.input)}`, note: spec.units.note ?? null });
  if (formula && spec.formulaFirst) return fromFormula();
  if (fal) {
    const c = costOf(fal, spec.units);
    if (c) return { usd: c.usd, source: "fal", basis: `fal's price list: ${money(fal.unitPrice)} per ${fal.unit}`, note: spec.units.note ?? c.note };
  }
  if (formula) return fromFormula();
  return { unknown: `${endpoint}${fal ? ` (fal's unit "${fal.unit}")` : " (fal's price list has no entry)"}` };
}

export const money = (usd: number) => `$${usd.toFixed(2)}`;
