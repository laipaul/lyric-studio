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

// The line moved as a whole to its hand-set start (all words by the same amount), squeezed to end before
// the next line. A line whose text no longer matches (lyrics changed) or that would pass a neighbour is skipped.
export function applyHandTimes(lines: readonly TimedLine[], times: readonly HandTime[]): { lines: TimedLine[]; applied: { index: number; fromMs: number; toMs: number }[]; problems: string[] } {
  const out = [...lines];
  const applied: { index: number; fromMs: number; toMs: number }[] = [];
  const problems: string[] = [];
  for (const t of [...times].sort((a, b) => a.number - b.number)) {
    const i = t.number - 1;
    const l = out[i];
    if (!l) {
      problems.push(`hand-set line ${t.number} "${t.text}": there is no line ${t.number} any more; ignored`);
      continue;
    }
    if (t.text && normalizeLyric(t.text) !== normalizeLyric(l.text)) {
      problems.push(`hand-set line ${t.number} "${t.text}": line ${t.number} is now "${l.text}"; ignored (set it again in the Lyrics tab)`);
      continue;
    }
    const prevStart = out[i - 1]?.start_ms ?? -Infinity;
    const nextStart = out[i + 1]?.start_ms ?? Infinity;
    if (t.ms <= prevStart || t.ms >= nextStart) {
      problems.push(`hand-set line ${t.number} "${l.text}" at ${stamp(t.ms)}: not between its neighbours; ignored`);
      continue;
    }
    out[i] = shiftLine(l, t.ms, nextStart === Infinity ? null : nextStart);
    if (out[i - 1]?.sung_end_ms !== undefined && out[i - 1].sung_end_ms! > t.ms) out[i - 1] = { ...out[i - 1], sung_end_ms: t.ms - 50 };
    applied.push({ index: i, fromMs: l.start_ms, toMs: t.ms });
  }
  return { lines: out, applied, problems };
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
