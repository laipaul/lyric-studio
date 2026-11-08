// Hand-set line starts (the Lyrics tab's nudges), kept in the song's hints.lrc as "exact" lines:
//   [01:10.05]! #14 You had a heart for two
// "!" = set by hand, used as it is; "#14" = the lyric line number (so repeated hook lines stay apart);
// the text is there to read and to check that it is still the same line. The aligner never sees these
// lines (stripHandTimes): the taps it uses, and so the stored alignment, stay the same. pnpm make
// applies them on top of the alignment, and the vocal-start check leaves those lines alone.
import { normalizeLyric, type TimedLine } from "./lrc";

export type HandTime = { number: number; ms: number; text: string };

const EXACT = /^\s*\[(\d+):(\d{1,2}(?:\.\d+)?)\]!\s*#(\d+)\s*(.*?)\s*$/;
const stamp = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, "0")}`;

export const isHandTimeLine = (line: string) => EXACT.test(line);

export function parseHandTimes(content: string): HandTime[] {
  const out: HandTime[] = [];
  for (const line of content.replace(/^﻿/, "").split("\n")) {
    const m = EXACT.exec(line);
    if (m) out.push({ number: Number(m[3]), ms: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), text: m[4] });
  }
  return out;
}

// The hints without the hand-set lines: exactly the file as it was before they were added.
export function stripHandTimes(content: string): string {
  if (!content.split("\n").some(isHandTimeLine)) return content;
  return content
    .split("\n")
    .filter((l) => !isHandTimeLine(l))
    .join("\n");
}

// The hints with these hand-set lines (replacing the old ones). Written so stripHandTimes gives back the
// taps byte for byte: after a file ending in a newline each line ends with one; otherwise each starts with one.
export function withHandTimes(content: string, times: readonly HandTime[]): string {
  const base = stripHandTimes(content);
  const lines = [...times].sort((a, b) => a.number - b.number).map((t) => `[${stamp(t.ms)}]! #${t.number} ${t.text}`);
  if (!lines.length) return base;
  return base === "" || base.endsWith("\n") ? `${base}${lines.map((l) => `${l}\n`).join("")}` : `${base}${lines.map((l) => `\n${l}`).join("")}`;
}

// Which line each hand-set start belongs to NOW. The number is tried first (with the same text); when the
// lyrics changed and the number shifted, the same text on exactly one line is that line (a hand-set start
// follows its line by text). An entry whose line is gone, or whose text is on several lines, is dropped
// ("problems", plain words); an entry that points at a line another entry already claims by its own number is
// stale ("stale": never overrides the current one).
export type ResolvedHandTime = HandTime & { index: number; was?: number };
export function resolveHandTimes(lines: readonly { text: string }[], times: readonly HandTime[]): { resolved: ResolvedHandTime[]; problems: string[]; stale: HandTime[] } {
  const problems: string[] = [];
  const stale: HandTime[] = [];
  const keys = lines.map((l) => normalizeLyric(l.text));
  const exact = new Map<number, ResolvedHandTime>();
  const moved: ResolvedHandTime[] = [];
  const sorted = [...times].sort((a, b) => a.number - b.number);
  for (const t of sorted) {
    const own = lines[t.number - 1];
    if (own && (!t.text || normalizeLyric(t.text) === keys[t.number - 1])) {
      exact.set(t.number - 1, { ...t, index: t.number - 1 });
      continue;
    }
    const same = t.text ? keys.flatMap((k, i) => (k === normalizeLyric(t.text) ? [i] : [])) : [];
    if (same.length === 1) moved.push({ ...t, number: same[0] + 1, index: same[0], was: t.number });
    else if (!own) problems.push(`hand-set line ${t.number} "${t.text}": there is no line ${t.number} any more; ignored`);
    else problems.push(`hand-set line ${t.number} "${t.text}": line ${t.number} is now "${own.text}"; ignored (set it again in the Lyrics tab)`);
  }
  const resolved = new Map(exact);
  for (const m of moved) {
    if (resolved.has(m.index)) stale.push({ number: m.was!, ms: m.ms, text: m.text });
    else resolved.set(m.index, m);
  }
  return { resolved: [...resolved.values()].sort((a, b) => a.index - b.index), problems, stale };
}

export type HandSkip = { line: number; text: string; ms: number; why: string; with?: number }; // a hand-set start that is NOT used, in plain words (with: the other hand-set line it clashes with)
export type HandPush = { index: number; fromMs: number; toMs: number; because: number }; // a line not set by hand that was moved behind a hand-set line (because: its number)
const PUSH_WITHIN_MS = 300; // a following line starting before, or this close after, a hand-set line is pushed behind it
const PUSH_GAP_MS = 100;

// The lines moved as a whole to their hand-set starts (all words by the same amount), squeezed to end before
// the next line. The user's start wins: a following line that is NOT set by hand and would start before (or
// within 0.3 s after) the hand-set line is pushed behind its sung end (and so on down the song). Two hand-set
// starts must be in order (the later of a pair that clashes is skipped, said so); a hand-set start is also
// skipped when it would be before the start of the previous line (not set by hand). Text that changed with no
// match is skipped and said so (problems for the log, skipped for the Lyrics tab).
export function applyHandTimes(
  lines: readonly TimedLine[],
  times: readonly HandTime[],
): { lines: TimedLine[]; applied: { index: number; fromMs: number; toMs: number }[]; pushed: HandPush[]; problems: string[]; skipped: HandSkip[]; stale: HandTime[] } {
  const out = [...lines];
  const applied: { index: number; fromMs: number; toMs: number }[] = [];
  const { resolved, problems, stale } = resolveHandTimes(lines, times);
  const skipped: HandSkip[] = [];
  for (const p of problems) {
    const m = /^hand-set line (\d+) "(.*)": (.*); ignored/.exec(p);
    if (m) skipped.push({ line: Number(m[1]), text: m[2], ms: times.find((t) => t.number === Number(m[1]))?.ms ?? 0, why: m[3].includes("no line") ? "that line is not in the lyrics any more" : "the words of this line changed" });
  }
  const set = new Map(resolved.map((t) => [t.index, t]));
  for (let again = true; again; ) {
    again = false;
    for (const t of [...set.values()]) {
      const l = out[t.index];
      const prevSet = set.get(t.index - 1);
      const nextSet = set.get(t.index + 1);
      const prevMs = prevSet?.ms ?? out[t.index - 1]?.start_ms ?? -Infinity;
      let why: string | null = null;
      let other: number | undefined;
      if (t.ms <= prevMs) {
        why = `${stamp(t.ms)} is not after line ${t.index}, which starts at ${stamp(prevMs)}${prevSet ? " (set by hand)" : ""}`;
        other = prevSet ? t.index : undefined;
      } else if (nextSet && t.ms >= nextSet.ms) {
        why = `${stamp(t.ms)} is not before line ${t.index + 2}, which you set to ${stamp(nextSet.ms)}`;
        other = t.index + 2;
      }
      if (!why) continue;
      problems.push(`hand-set line ${t.index + 1} "${l.text}" at ${stamp(t.ms)}: not between its neighbours; ignored`);
      skipped.push({ line: t.index + 1, text: l.text, ms: t.ms, why, ...(other ? { with: other } : {}) });
      set.delete(t.index);
      again = true;
      break;
    }
  }
  // Final starts: hand-set ones, then the lines behind them pushed along where they would be too early.
  const starts = out.map((l, i) => set.get(i)?.ms ?? l.start_ms);
  const pushed: HandPush[] = [];
  const nextHandMs = (i: number) => {
    for (let k = i + 1; k < out.length; k++) if (set.has(k)) return set.get(k)!.ms;
    return Infinity;
  };
  for (let i = 1; i < out.length; i++) {
    if (set.has(i) || starts[i - 1] === out[i - 1].start_ms) continue; // only behind a line that moved
    if (starts[i] > starts[i - 1] + PUSH_WITHIN_MS) continue;
    const prev = out[i - 1];
    const naturalEnd = starts[i - 1] + ((prev.sung_end_ms ?? prev.end_ms) - prev.start_ms);
    const to = Math.min(naturalEnd + PUSH_GAP_MS, nextHandMs(i) - PUSH_GAP_MS);
    if (to <= starts[i]) continue;
    const because = [...set.keys()].filter((k) => k < i).pop();
    pushed.push({ index: i, fromMs: starts[i], toMs: to, because: (because ?? i - 1) + 1 });
    starts[i] = to;
  }
  out.forEach((l, i) => {
    if (starts[i] === l.start_ms) return;
    out[i] = shiftLine(l, starts[i], i + 1 < out.length ? starts[i + 1] : null);
  });
  for (const t of [...set.values()].sort((a, b) => a.index - b.index)) {
    const i = t.index;
    if (!set.has(i - 1) && !pushed.some((p) => p.index === i - 1) && out[i - 1]?.sung_end_ms !== undefined && out[i - 1].sung_end_ms! > t.ms) out[i - 1] = { ...out[i - 1], sung_end_ms: t.ms - 50 };
    applied.push({ index: i, fromMs: lines[i].start_ms, toMs: t.ms });
  }
  return { lines: out, applied, pushed, problems, skipped, stale };
}

export function shiftLine(line: TimedLine, toMs: number, nextStartMs: number | null): TimedLine {
  const delta = toMs - line.start_ms;
  const limit = nextStartMs === null ? Infinity : nextStartMs - 50;
  const sungEnd = line.sung_end_ms !== undefined ? line.sung_end_ms + delta : undefined;
  const scale = sungEnd !== undefined && sungEnd > limit && limit > toMs ? (limit - toMs) / (sungEnd - toMs) : 1;
  const at = (ms: number) => Math.round(toMs + (ms + delta - toMs) * scale);
  return {
    ...line,
    start_ms: toMs,
    end_ms: Math.max(line.end_ms + (nextStartMs === null ? delta : 0), toMs + 1),
    ...(line.words ? { words: line.words.map((w) => ({ ...w, start_ms: at(w.start_ms) })) } : {}),
    ...(line.sung_end_ms !== undefined ? { sung_end_ms: at(line.sung_end_ms) } : {}),
  };
}
