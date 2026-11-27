// A take's facts in plain words, the same in Creation and the Tasks menu (Paul, 21 Nov 2026: "does it give the time,
// costs and model used?"): its length, what it cost (nothing when it was never sent) and when it was made.
export type TakeFactsInput = { status: string; started_at: string; ended_at?: string; request_id?: string; cost_usd: number; kind?: string; sync_ms?: number; to_ms?: number; seconds?: number; resolution?: string; feeling?: string; feelingTo?: string };

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

// "longing", "longing → hope" (feelings.ts): the feeling the take was sent with, if any.
export const takeFeeling = (t: Pick<TakeFactsInput, "feeling" | "feelingTo">) => (t.feelingTo && t.feelingTo !== t.feeling ? `${t.feeling ?? "no feeling"} → ${t.feelingTo}` : (t.feeling ?? ""));

export function takeFacts(t: TakeFactsInput, locale?: string): string {
  const when = takeWhen(t, locale);
  return [`${takeSeconds(t)} s`, ...(t.kind === "lipsync" && t.resolution ? [t.resolution] : []), takeFeeling(t), takeCost(t), t.status === "running" ? `sent ${when}` : when].filter(Boolean).join(" · ");
}

// A take's short tag (25 Nov 2026, Paul: "how do I distinguish which take and run was it?"), the same in Creation and
// Compare: its name (Paul's or the draft test's own label first), what made it, its feeling and its cost, e.g.
// "Take 3 · Draft 480p · joy · $0.54", "Take 4 · final of 3 · 1080p · $0.20", "Take 5 · Jennifer's face · $1.62".
export type TakeTagInput = TakeFactsInput & { section?: { fromMs: number; toMs: number }; mvShot?: number; n: number; label?: string; quality?: string; model?: string; finalOf?: number; refNames?: string[]; service?: string; filmLook?: string; feel?: string; line?: number; through?: number };

const clk = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export function takeKind(t: TakeTagInput): string {
  if (t.finalOf !== undefined) return "1080p";
  if (/upscaler/i.test(t.model ?? "")) return /pro/i.test(t.model ?? "") ? "1080p upscale" : "1080p basic upscale";
  if (t.kind === "lipsync") return `singing, ${t.through && t.through > (t.line ?? 0) ? `lines ${t.line}-${t.through}` : `line ${t.line}`} · ${t.resolution ?? "720p"}`;
  if (t.kind === "musicvideo") return `music video${t.section ? ` · ${clk(t.section.fromMs)}–${clk(t.section.toMs)}` : ""}${t.resolution ? ` · ${t.resolution}` : ""}`;
  if (t.kind === "references") {
    const face = t.refNames?.find((r) => / · face sheet$/.test(r));
    return face ? `${face.replace(/ · face sheet$/, "")}'s face` : "with references";
  }
  if (t.mvShot !== undefined) return `music video shot ${t.mvShot + 1}${t.resolution ? ` · ${t.resolution}` : ""}`;
  if (t.quality === "draft") return "Draft 480p";
  if (t.quality === "standard") return "Flash 720p";
  if (t.quality === "magi2") return "MAGI-2 1080p";
  return "Full quality 720p";
}

// Ends with when it was made (Paul: "add timestamp"): "25 Nov, 11:06", local time.
export function takeTag(t: TakeTagInput, locale?: string): string {
  const kind = takeKind(t);
  const name = t.label?.trim() || (t.finalOf !== undefined ? `Take ${t.n} · final of ${t.finalOf}` : `Take ${t.n}`);
  // "Draft" + "Draft 480p" -> "Draft · 480p": the name already says the first words.
  const rest = kind.toLowerCase().startsWith(name.toLowerCase()) ? kind.slice(name.length).trim() : kind;
  const cost = takeSent(t) ? `$${t.cost_usd.toFixed(2)}` : "nothing spent";
  return [name, rest, takeFeeling(t), cost, takeWhen(t, locale)].filter(Boolean).join(" · ");
}

// Everything about the take, for a hover.
export function takeDetails(t: TakeTagInput, locale?: string): string {
  const service = t.service === "wavespeed" ? "WaveSpeed" : t.service === "higgsfield" ? "Higgsfield" : (t.service ?? "");
  return [
    [service, t.model].filter(Boolean).join(" · "),
    takeFacts(t, locale),
    t.filmLook ? `Film look: ${t.filmLook}` : "",
    t.feel ? `Feel: ${t.feel}` : "",
    t.refNames?.length ? `Pictures sent: ${t.refNames.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
