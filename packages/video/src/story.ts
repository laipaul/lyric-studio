// Instrumental songs (song.json "instrumental": true): no sung lyrics; an optional story.txt, one
// sentence per line (a blank line = a pause between chapters), that the app times itself: each sentence
// appears on a bar at the start of a phrase, stays long enough to read, and the sentences are spread over
// the music with room for the intro and the end. Also: the strongest stretch of the music, where a
// short-form section of an instrumental starts (there is no chorus line to start on).
import type { Beat } from "./beats";
import type { TimedLine } from "./lrc";

export type StorySentence = { text: string; pauseBefore: boolean };

// One sentence per non-empty line; one or more blank lines before a sentence = a pause (chapter break).
// A leading "* " (a hook marker in lyrics.txt) is dropped: a story has no hooks.
export function parseStory(text: string): StorySentence[] {
  const out: StorySentence[] = [];
  let blank = false;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/^\*\s+/, "").trim();
    if (!line) {
      blank = out.length > 0;
      continue;
    }
    out.push({ text: line, pauseBefore: blank });
    blank = false;
  }
  return out;
}

// How long a sentence needs on screen to be read comfortably: 1.5 s + 0.35 s a word, at least 3 s.
export function storyReadMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(3000, 1500 + words * 350);
}

export const STORY_INTRO_BARS = 2; // music before the first sentence (room for the title opening)
export const STORY_OUTRO_BARS = 2; // music after the last one
export const STORY_PAUSE_BARS = 2; // a blank line in story.txt

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// The bar starts of the song (detected downbeats; without any, every 2 s).
export function barStarts(beats: readonly Beat[], durationMs: number): number[] {
  const downbeats = beats.filter((b) => b.is_downbeat).map((b) => b.time_ms).sort((a, b) => a - b);
  if (downbeats.length >= 2) return downbeats;
  const out: number[] = [];
  for (let t = 0; t < durationMs; t += 2000) out.push(t);
  return out;
}

// Times the story: every sentence starts on a bar (shown exactly on it: its stamp is `leadMs` after the
// bar, as lyric lines appear `leadMs` before their stamp), lasts whole bars covering its reading time,
// and the bars left over are spread evenly between the sentences (and after the last), so the story runs
// through the whole piece. Too long for the music: the pauses go first, then the extra reading time, and
// the sentences that still do not fit are said.
export function planStory(
  sentences: readonly StorySentence[],
  beats: readonly Beat[],
  durationMs: number,
  options: { leadMs?: number } = {},
): { lines: TimedLine[]; warnings: string[] } {
  const leadMs = options.leadMs ?? 250;
  if (!sentences.length) return { lines: [], warnings: [] };
  const bars = barStarts(beats, durationMs).filter((t) => t < durationMs);
  const barMs = median(bars.slice(1).map((t, i) => t - bars[i])) || 2000;
  const first = Math.min(STORY_INTRO_BARS, Math.max(0, bars.length - 1));
  const last = Math.max(first, bars.length - 1 - STORY_OUTRO_BARS); // the last bar a sentence may still end on
  const available = last - first;
  const need = sentences.map((s) => Math.max(1, Math.ceil(storyReadMs(s.text) / barMs)));
  const minNeed = sentences.map(() => Math.max(1, Math.ceil(3000 / barMs)));
  let pauses: number[] = sentences.map((s, i) => (i > 0 && s.pauseBefore ? STORY_PAUSE_BARS : 0));
  let lengths = need;
  const total = () => lengths.reduce((a, b) => a + b, 0) + pauses.reduce((a, b) => a + b, 0);
  const warnings: string[] = [];
  if (total() > available) pauses = pauses.map(() => 0);
  if (total() > available) lengths = minNeed;
  // Spread what is left: n slots (between the sentences and after the last).
  const spare = Math.max(0, available - total());
  const n = sentences.length;
  const extra = (k: number) => Math.floor((spare * (k + 1)) / n) - Math.floor((spare * k) / n);

  const lines: TimedLine[] = [];
  let bar = first;
  for (let i = 0; i < n; i++) {
    if (i > 0) bar += pauses[i];
    const endBar = bar + lengths[i];
    if (endBar > bars.length - 1 && lines.length) {
      warnings.push(`The story is longer than the music: ${n - i} sentence(s) from "${sentences[i].text}" do not fit; shorten story.txt`);
      break;
    }
    const start = bars[bar] ?? 0;
    const end = Math.min(durationMs, bars[Math.min(endBar, bars.length - 1)] ?? durationMs);
    const read = storyReadMs(sentences[i].text);
    lines.push({
      text: sentences[i].text,
      start_ms: start + leadMs,
      end_ms: end + leadMs,
      isHook: false,
      // "Sung" until it has been read: before a long pause the sentence fades out after that.
      sung_end_ms: Math.min(end + leadMs, start + leadMs + read),
    });
    bar = endBar + extra(i);
  }
  return { lines, warnings };
}

// The strongest stretch of the music for a short-form section of an instrumental: the bar start (on the
// phrase grid, every 4 bars from the first bar, else any bar) whose `lengthMs` that follows is loudest
// on average (`level(fromMs, toMs)`, e.g. the RMS of the song's samples). Returns that bar start.
export function strongestStretch(bars: readonly number[], lengthMs: number, durationMs: number, level: (fromMs: number, toMs: number) => number): number {
  const fits = bars.filter((t) => t + lengthMs <= durationMs);
  if (!fits.length) return bars[0] ?? 0;
  const phrases = fits.filter((_, i) => i % 4 === 0);
  const pool = phrases.length >= 2 ? phrases : fits;
  let best = pool[0];
  let bestLevel = -Infinity;
  for (const t of pool) {
    const l = level(t, t + lengthMs);
    if (l > bestLevel + 1e-9) [best, bestLevel] = [t, l];
  }
  return best;
}

// RMS level of mono samples between two times (for strongestStretch).
export function rmsLevel(audio: { rate: number; samples: Float32Array }, fromMs: number, toMs: number): number {
  const a = Math.max(0, Math.floor((fromMs / 1000) * audio.rate));
  const b = Math.min(audio.samples.length, Math.floor((toMs / 1000) * audio.rate));
  if (b <= a) return 0;
  let sum = 0;
  const step = Math.max(1, Math.floor((b - a) / 200_000)); // at most ~200k samples read
  let count = 0;
  for (let i = a; i < b; i += step) {
    sum += audio.samples[i] * audio.samples[i];
    count += 1;
  }
  return Math.sqrt(sum / count);
}
