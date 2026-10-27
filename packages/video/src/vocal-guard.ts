// Vocal-start guard (pnpm make): a lyric line may not start long before it is sung.
// The aligner sometimes pulls line 1 (or the first line after a bridge or solo) into the instrumental
// part before it. Applied to the stored alignment, never re-aligning: for line 1 and every line after
// an instrumental gap, a start more than EARLY_MS before the voice (the voice map of the vocal stem)
// moves to where the voice starts. Pure, so the tests check exactly what pnpm make does.
import type { TimedLine } from "./lrc";

export const EARLY_MS = 1000; // the voice starts this much after the line: the line is early
export const LONG_GAP_MS = 4000; // silence on the vocal track before a line: an instrumental gap
const PRE_ROLL_MS = 200; // voice this close before a line's start counts as the line's own
const NEXT_MARGIN_MS = 100;

export type VoiceStretch = readonly [number, number]; // ms, sustained voice on the vocal stem
export type GuardMove = { index: number; fromMs: number; toMs: number };

// Where the voice is heard at or after `ms` (a stretch already going on at ms counts at ms).
export function voiceFrom(stretches: readonly VoiceStretch[], ms: number): number | null {
  for (const [start, end] of stretches) if (end > ms) return Math.max(start, ms);
  return null;
}

// Per line: how long after its start the voice begins (0: sung at once); null: no voice after it.
export function earlyMs(lines: readonly TimedLine[], stretches: readonly VoiceStretch[]): (number | null)[] {
  return lines.map((l) => {
    const voice = voiceFrom(stretches, l.start_ms - PRE_ROLL_MS);
    return voice === null ? null : Math.max(0, voice - l.start_ms);
  });
}

// Line 1 and lines after an instrumental gap that start more than EARLY_MS before the voice; never
// moved onto or past the next line. `skip`: lines placed by hand (they stay where they are).
export function planGuard(lines: readonly TimedLine[], stretches: readonly VoiceStretch[], skip: ReadonlySet<number> = new Set()): GuardMove[] {
  const moves: GuardMove[] = [];
  lines.forEach((l, i) => {
    if (skip.has(i)) return;
    const voice = voiceFrom(stretches, l.start_ms - PRE_ROLL_MS);
    if (voice === null || voice - l.start_ms <= EARLY_MS) return;
    // The voice heard before it (the previous line's singing): the silence must be an instrumental gap.
    const before = Math.max(0, ...stretches.filter(([, end]) => end <= voice).map(([, end]) => end));
    if (i > 0 && voice - before < LONG_GAP_MS) return;
    if (i + 1 < lines.length && voice >= lines[i + 1].start_ms - NEXT_MARGIN_MS) return;
    moves.push({ index: i, fromMs: l.start_ms, toMs: voice });
  });
  return moves;
}

// The line starting at `toMs`. Words already in the voice keep their times and the early ones are
// spread up to the first of them (a first word stretched over the intro); a line placed entirely
// before the voice moves as a whole, squeezed to end before the next line.
export function moveLineStart(line: TimedLine, toMs: number, nextStartMs: number | null): TimedLine {
  const limit = nextStartMs === null ? Infinity : nextStartMs - 50;
  const words = line.words ?? [];
  const firstInVoice = words.findIndex((w) => w.start_ms >= toMs);
  if (words.length && firstInVoice > 0) {
    const until = words[firstInVoice].start_ms;
    const step = (until - toMs) / firstInVoice;
    const moved = words.map((w, k) => (k < firstInVoice ? { ...w, start_ms: Math.round(toMs + k * step) } : w));
    return { ...line, start_ms: toMs, words: moved, end_ms: Math.max(line.end_ms, toMs + 1) };
  }
  if (words.length && firstInVoice === 0) return { ...line, start_ms: toMs, end_ms: Math.max(line.end_ms, toMs + 1) };
  const delta = toMs - line.start_ms;
  const sungEnd = line.sung_end_ms !== undefined ? line.sung_end_ms + delta : undefined;
  const scale = sungEnd !== undefined && sungEnd > limit && limit > toMs ? (limit - toMs) / (sungEnd - toMs) : 1;
  const at = (ms: number) => Math.round(toMs + (ms + delta - toMs) * scale);
  return {
    ...line,
    start_ms: toMs,
    end_ms: Math.min(Math.max(line.end_ms, (sungEnd !== undefined ? at(line.sung_end_ms!) : toMs) + 1), nextStartMs ?? Infinity),
    ...(line.words ? { words: line.words.map((w) => ({ ...w, start_ms: at(w.start_ms) })) } : {}),
    ...(line.sung_end_ms !== undefined ? { sung_end_ms: at(line.sung_end_ms) } : {}),
  };
}

export function applyGuard(lines: readonly TimedLine[], moves: readonly GuardMove[]): TimedLine[] {
  const out = [...lines];
  for (const m of moves) out[m.index] = moveLineStart(out[m.index], m.toMs, out[m.index + 1]?.start_ms ?? null);
  return out;
}
