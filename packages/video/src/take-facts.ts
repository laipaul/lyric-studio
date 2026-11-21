// A take's facts in plain words, the same in Creation and the Tasks menu (Paul, 21 Nov 2026: "does it give the time,
// costs and model used?"): its length, what it cost (nothing when it was never sent) and when it was made.
export type TakeFactsInput = { status: string; started_at: string; ended_at?: string; request_id?: string; cost_usd: number; kind?: string; sync_ms?: number; to_ms?: number; seconds?: number };

export function takeSeconds(t: TakeFactsInput): number {
  if (t.kind === "lipsync" && t.sync_ms !== undefined && t.to_ms !== undefined) return Math.max(3, Math.ceil((t.to_ms - t.sync_ms) / 1000));
  return t.seconds ?? 5; // before 21 Nov 2026 every Animate take was 5 s
}

// Reached the service (so it is billed); a take refused before sending cost nothing.
export const takeSent = (t: TakeFactsInput) => !!t.request_id || t.status === "done" || t.status === "running";

// "about $1.08", or "nothing spent" for a take that never reached the service.
export function takeCost(t: TakeFactsInput): string {
  return takeSent(t) ? `about $${t.cost_usd.toFixed(2)}` : "nothing spent";
}

// "21 Nov, 13:42" (local time); the time it finished, else the time it was sent.
export function takeWhen(t: { started_at: string; ended_at?: string | null }, locale?: string): string {
  const d = new Date(t.ended_at ?? t.started_at);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString(locale, { day: "numeric", month: "short" })}, ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

export function takeFacts(t: TakeFactsInput, locale?: string): string {
  const when = takeWhen(t, locale);
  return [`${takeSeconds(t)} s`, takeCost(t), t.status === "running" ? `sent ${when}` : when].filter(Boolean).join(" · ");
}
