// Singing slots (26 Nov 2026, Nextgen sprint step 2; Paul: "singing on chorus entries and emotional peaks, story B-roll on
// verses and instrumentals; never lip-sync the whole song"). Where in a video the singing shots should go, as
// suggestions only: chorus entries first, then the emotional peaks (long held lines, the strongest vocal passages). A
// slot starts on a sung line's start and ends on a sung line's end, so cuts land on vocal entrances and exits, and lasts
// about 8 s at most (a single longer line stays whole: a line is never cut). The targets are minimums: 1/6 of a Reel /
// TikTok / Short, 1/3 of a YouTube video or a Mini film; when the clips cannot reach it, the shortfall is said, never
// padded with weak slots. Matched with the clips checked for lip sync (lipsync-check.ts). Pure.
import type { LipCheck } from "./lipsync-check";

export type SlotLine = { number: number; text: string; startMs: number; endMs: number; isHook?: boolean }; // sung start / end
export type SlotSection = { line: number; lastLine: number; kind: string; name: string };
export type SingingSlot = {
  key: string; // "L5-7": its lines (stable while the lines are)
  label: string; // "Chorus 1 · entry", "Verse 2 · peak"
  kind: "chorus" | "peak";
  lines: [number, number];
  fromMs: number; // the first line's sung start
  toMs: number; // the last line's sung end
  reason: string;
};
export const SLOT_MAX_MS = 8000;
export const TARGET_SHARE = { short: 1 / 6, full: 1 / 3 } as const; // Reels, TikTok, Shorts / YouTube, Mini film

export const singingTargetMs = (videoMs: number, kind: keyof typeof TARGET_SHARE) => Math.round(videoMs * TARGET_SHARE[kind]);

// The slots of one video: `window` is its part of the song (song ms); `splits`: line numbers after which a slot may not
// continue (the user's "Split here"); `level`: an optional vocal strength per line (0-1) for the peaks.
export function singingSlots(
  lines: readonly SlotLine[],
  sections: readonly SlotSection[],
  window: { fromMs: number; toMs: number },
  targetMs: number,
  o: { splits?: readonly number[]; level?: (line: number) => number | null } = {},
): { slots: SingingSlot[]; totalMs: number; targetMs: number; linesShortMs: number } {
  const inside = lines.filter((l) => l.startMs >= window.fromMs - 1 && l.endMs <= window.toMs + 1 && l.endMs > l.startMs).sort((a, b) => a.startMs - b.startMs);
  const sectionOf = (n: number) => sections.find((s) => s.line <= n && n <= s.lastLine) ?? null;
  const splits = new Set(o.splits ?? []);
  const nextOf = (l: SlotLine) => inside.find((x) => x.number === l.number + 1);
  // Lines from `first` on, in the same section, never across a split, while the slot stays within 8 s.
  const grow = (first: SlotLine): SlotLine[] => {
    const out = [first];
    for (let cur = first; ; ) {
      const next = nextOf(cur);
      if (!next || splits.has(cur.number) || sectionOf(next.number) !== sectionOf(first.number) || next.endMs - first.startMs > SLOT_MAX_MS) break;
      out.push(next);
      cur = next;
    }
    return out;
  };
  const slotOf = (ls: SlotLine[], kind: SingingSlot["kind"], label: string, reason: string): SingingSlot => ({
    key: `L${ls[0].number}-${ls.at(-1)!.number}`,
    label,
    kind,
    lines: [ls[0].number, ls.at(-1)!.number],
    fromMs: ls[0].startMs,
    toMs: ls.at(-1)!.endMs,
    reason,
  });
  // 1. Chorus entries, in the order they come.
  const chorusFirsts = sections.filter((s) => /chorus/i.test(s.kind) && !/pre/i.test(s.kind)).flatMap((s) => inside.filter((l) => l.number === s.line).map((l) => ({ l, s })));
  const hookFirsts = !chorusFirsts.length ? inside.filter((l, i) => l.isHook && !inside[i - 1]?.isHook).map((l) => ({ l, s: sectionOf(l.number) })) : [];
  const entries = [...chorusFirsts, ...hookFirsts].map(({ l, s }) => slotOf(grow(l), "chorus", `${s?.name ?? "Chorus"} · entry`, "a chorus entry: the hook, where the singer belongs"));
  // 2. Peaks: the rest of the lines by how long they are held and how strongly they are sung.
  const held = (l: SlotLine) => l.endMs - l.startMs;
  const longest = Math.max(1, ...inside.map(held));
  const peaks = inside
    .map((l) => ({ l, score: held(l) / longest + (o.level?.(l.number) ?? 0) }))
    .sort((a, b) => b.score - a.score || a.l.startMs - b.l.startMs)
    .map(({ l }) => slotOf([l], "peak", `${sectionOf(l.number)?.name ?? "Song"} · peak`, held(l) >= 3500 ? "a long held line: an emotional peak" : "one of the strongest sung lines"));
  const chosen: SingingSlot[] = [];
  let total = 0;
  const overlaps = (s: SingingSlot) => chosen.some((c) => s.fromMs < c.toMs && c.fromMs < s.toMs);
  for (const s of [...entries, ...peaks]) {
    if (total >= targetMs) break;
    if (overlaps(s)) continue;
    chosen.push(s);
    total += s.toMs - s.fromMs;
  }
  return { slots: chosen.sort((a, b) => a.fromMs - b.fromMs), totalMs: total, targetMs, linesShortMs: Math.max(0, targetMs - total) };
}

export type SlotClip = { name: string; label?: string | null; check: LipCheck | null };
export type SlotMatch = {
  slot: SingingSlot;
  clip: string | null; // the suggested (or accepted) clip
  verdict: LipCheck["verdict"] | null;
  coverMs: number; // how much of the slot its best window covers
  full: boolean; // it covers the whole slot
  accepted: boolean;
  splitAfter: number | null; // a sung-line boundary to split the slot at, when the best clip covers only a part
  text: string; // plain words for the card and the timeline
};

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// Each slot its clip: the accepted one, else the best ✅ whose best window covers the slot, else a ⚠️ one, else the best
// partial match (with its coverage and a split point on a sung-line boundary). A clip carries one slot. Chorus slots
// choose first. `ignored`: slot key -> clips the user ignored for it.
export function matchSlots(
  slots: readonly SingingSlot[],
  clips: readonly SlotClip[],
  lines: readonly SlotLine[],
  o: { accepted?: Readonly<Record<string, string>>; ignored?: Readonly<Record<string, readonly string[]>> } = {},
): SlotMatch[] {
  const used = new Set(Object.values(o.accepted ?? {}).map((c) => c.toLowerCase()));
  const order = [...slots].sort((a, b) => (a.kind === b.kind ? a.fromMs - b.fromMs : a.kind === "chorus" ? -1 : 1));
  const out = new Map<string, SlotMatch>();
  const winMs = (c: SlotClip) => (c.check?.window ? (c.check.window.to - c.check.window.from) * 1000 : 0);
  for (const slot of order) {
    const len = slot.toMs - slot.fromMs;
    const acc = o.accepted?.[slot.key];
    if (acc) {
      const c = clips.find((x) => x.name.toLowerCase() === acc.toLowerCase());
      const cover = c ? Math.min(len, winMs(c)) : 0;
      out.set(slot.key, { slot, clip: acc, verdict: c?.check?.verdict ?? null, coverMs: cover, full: cover >= len - 100, accepted: true, splitAfter: null, text: `${c?.label ?? acc}: accepted for singing` });
      continue;
    }
    const ignored = new Set((o.ignored?.[slot.key] ?? []).map((x) => x.toLowerCase()));
    const pool = clips.filter((c) => c.check && c.check.verdict !== "bad" && c.check.window && !used.has(c.name.toLowerCase()) && !ignored.has(c.name.toLowerCase()));
    const rank = (c: SlotClip) => [winMs(c) >= len - 100 ? 1 : 0, c.check!.verdict === "good" ? 1 : 0, Math.min(len, winMs(c))] as const;
    pool.sort((a, b) => {
      const x = rank(a);
      const y = rank(b);
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
    const best = pool[0];
    if (!best) {
      out.set(slot.key, { slot, clip: null, verdict: null, coverMs: 0, full: false, accepted: false, splitAfter: null, text: `${slot.label}: no clip good for lip sync; needs a front or 3/4 medium close-up` });
      continue;
    }
    used.add(best.name.toLowerCase());
    const cover = Math.min(len, winMs(best));
    const full = cover >= len - 100;
    // A partial match: the sung-line boundary inside the slot nearest the covered length (at or under it).
    let splitAfter: number | null = null;
    if (!full && slot.lines[1] > slot.lines[0]) {
      const inSlot = lines.filter((l) => l.number >= slot.lines[0] && l.number < slot.lines[1]);
      const fit = inSlot.filter((l) => l.endMs - slot.fromMs <= cover + 100).at(-1) ?? inSlot[0];
      splitAfter = fit?.number ?? null;
    }
    const who = best.label ?? best.name;
    out.set(slot.key, {
      slot,
      clip: best.name,
      verdict: best.check!.verdict,
      coverMs: cover,
      full,
      accepted: false,
      splitAfter,
      text: full ? `${who} (${best.check!.verdict === "good" ? "✅" : "⚠️"} best ${best.check!.window!.from.toFixed(1)}–${best.check!.window!.to.toFixed(1)} s)` : `${who} covers ${sec(cover)} of ${sec(len)}${splitAfter ? `: split after line ${splitAfter}` : ""}`,
    });
  }
  return slots.map((s) => out.get(s.key)!);
}

// The meter: the singing a video has (slots fully covered by a suggested or accepted clip) against its target.
export function singingMeter(matches: readonly SlotMatch[], targetMs: number): { haveMs: number; targetMs: number; needClip: number; text: string } {
  const haveMs = matches.filter((m) => m.full).reduce((n, m) => n + (m.slot.toMs - m.slot.fromMs), 0);
  const needClip = matches.filter((m) => !m.full).length;
  return { haveMs, targetMs, needClip, text: `Singing: ${Math.round(haveMs / 1000)} s / ${Math.round(targetMs / 1000)} s${needClip ? ` · ${needClip} slot${needClip === 1 ? "" : "s"} need${needClip === 1 ? "s" : ""} a clip` : ""}` };
}
