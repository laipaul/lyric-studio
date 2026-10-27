// Vocal-start check (pnpm make): the first sung word of a song, and the first word after every long
// instrumental, must be placed right (within ~0.3 s) with no manual fix. The aligner sometimes pulls
// such a line into the music before it. Applied to the stored alignment, never re-aligning. Three
// signals for line 1, lines after an instrumental gap and lines whose first word is stretched:
//   voice           the onset of sustained voice on the vocal track: at most VOICE_BELOW_SINGING_DB under
//                   the song's own singing level (measured on the aligned lines), for at least
//                   MIN_VOICE_MS, so instrument bleed, breaths and short hums are not "voice";
//   words           a short speech-recognition pass on the vocal track around the line, matched against
//                   the line's first words (services/audio first_words; optional: needs the AI packages);
//   word durations  the alignment's own first word: when it lasts seconds (stretched back into the
//                   music), the singing-level energy just before the second word; else the stamp.
// The line starts where at least two agree (within AGREE_MS); when none agree, the recognised words win
// (then the stretched-word estimate, then a clearly early stamp moves to the voice). The reason is
// printed. Never onto the next line or before the previous line's singing ends. Pure, so the tests
// check exactly what pnpm make does.
import { normalizeLyric, type TimedLine } from "./lrc";

export const EARLY_MS = 1000; // without agreement: the voice this much after the stamp = early
export const AGREE_MS = 300; // two signals this close agree
export const MOVE_MS = 300; // a line is moved when the decision is this far from its stamp
export const LONG_GAP_MS = 4000; // no voice for this long before a line: an instrumental gap
export const MIN_VOICE_MS = 500; // voice must last this long (pauses under JOIN_GAP_MS inside it are fine)
export const VOICE_BELOW_SINGING_DB = 15; // voice: at most this far under the song's singing level
export const STRETCHED_WORD_MS = 2500; // a first word lasting this long (to the second word's start) was stretched back
const JOIN_GAP_MS = 150;
const WORD_BEFORE_MS = 400; // no energy found near the second word: the first word starts this much before it
const NEAR_SECOND_MS = 1500;
const WORD_LEVEL_DB = 6; // the first word's own energy: within this of the singing level
const PRE_ROLL_MS = 200; // voice this close before a line's start counts as the line's own
const NEXT_MARGIN_MS = 100;
const MISSED_WORD_MS = 250; // the recognised words start at the second lyric word: the first one this much earlier

export type VoiceLevels = { hopMs: number; db: readonly number[] }; // the voice map (version 2)
export type VoiceStretch = readonly [number, number]; // ms: sustained voice
export type GuardMove = { index: number; fromMs: number; toMs: number };
export type AsrWord = { text: string; start_ms: number; end_ms: number; prob: number };
export type LineCheck = {
  index: number;
  stampMs: number;
  voiceMs: number | null; // a: the onset of sustained voice (null: none found)
  wordsMs: number | null; // b: where the recognised words matching the line's first words start
  wordsText: string | null; // the recognised words that matched
  durationMs: number | null; // c: from the alignment's word durations (the stamp unless the first word is stretched)
  firstWordMs: number | null; // how long the first word lasts (to the second word's start)
  loudestBeforeDb: number | null; // the loudest sound between the voice before and this voice (bleed, breaths)
  targetMs: number; // where the line starts now
  agree: string[]; // the signals that agreed on targetMs
  why: string;
  result: "moved" | "in time" | "kept" | "set by hand";
};
export type VocalCheck = { levelDb: number; thresholdDb: number; lines: LineCheck[]; moves: GuardMove[]; stretches: VoiceStretch[] };

const quantile = (values: number[], q: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
};
const slice = (v: VoiceLevels, fromMs: number, toMs: number) => v.db.slice(Math.max(0, Math.floor(fromMs / v.hopMs)), Math.max(0, Math.ceil(toMs / v.hopMs)));

// The song's singing level: the median over the lines of each line's loud part (90th percentile of its
// sung span), so a few misplaced lines do not move it.
export function singingLevel(lines: readonly TimedLine[], v: VoiceLevels): number {
  const perLine = lines
    .map((l) => quantile([...slice(v, l.start_ms, l.sung_end_ms ?? l.end_ms)], 0.9))
    .filter((x): x is number => x !== null && x > -90);
  return quantile(perLine, 0.5) ?? quantile([...v.db].filter((x) => x > -90), 0.95) ?? -20;
}

// Stretches of sustained voice: above the threshold for at least minMs (default MIN_VOICE_MS).
export function voiceStretches(v: VoiceLevels, thresholdDb: number, minMs = MIN_VOICE_MS): VoiceStretch[] {
  const out: VoiceStretch[] = [];
  let start: number | null = null;
  let last = -Infinity;
  const close = () => {
    if (start !== null && last + v.hopMs - start >= minMs) out.push([start, last + v.hopMs]);
    start = null;
  };
  v.db.forEach((db, k) => {
    if (db <= thresholdDb) return;
    const ms = k * v.hopMs;
    if (start !== null && ms - (last + v.hopMs) >= JOIN_GAP_MS) close();
    if (start === null) start = ms;
    last = ms;
  });
  close();
  return out;
}

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

// Where the recognised words match the line's first words (the first three tokens, compared as
// normalised text, so "won't" = "won t"; the first lyric word may be missed by the recognition).
export function matchFirstWords(lineText: string, words: readonly AsrWord[]): { ms: number; text: string } | null {
  const want = normalizeLyric(lineText).split(" ").filter(Boolean).slice(0, 3);
  const got = words.flatMap((w, k) => normalizeLyric(w.text).split(" ").filter(Boolean).map((t) => ({ t, k })));
  if (!want.length) return null;
  // How many of `rest` follow in order from token `from` (each within the next three tokens); the last token used.
  const follows = (from: number, rest: string[]) => {
    let at = from;
    let n = 0;
    let last = from - 1;
    for (const w of rest) {
      const found = got.slice(at, at + 3).findIndex((g) => g.t === w);
      if (found < 0) continue;
      n++;
      last = at + found;
      at = last + 1;
    }
    return { n, last };
  };
  const text = (fromTok: number, toTok: number) => words.slice(got[fromTok].k, got[toTok].k + 1).map((w) => w.text).join(" ");
  for (let j = 0; j < got.length; j++) {
    if (got[j].t === want[0]) {
      const f = follows(j + 1, want.slice(1));
      const word = words[got[j].k];
      if (f.n >= 1 || want.length === 1 || (want[0].length >= 4 && word.prob >= 0.5)) return { ms: word.start_ms, text: text(j, Math.max(j, f.last)) };
    }
    // The first lyric word not recognised (often a short "a" / "I"): the next two match here.
    if (want.length >= 3 && got[j].t === want[1]) {
      const f = follows(j + 1, [want[2]]);
      if (f.n === 1) return { ms: words[got[j].k].start_ms - MISSED_WORD_MS, text: text(j, f.last) };
    }
  }
  return null;
}

type Signals = { i: number; voice: number | null; duration: number; firstWordMs: number | null; loud: number | null };

// The lines to check (line 1, after an instrumental gap, a stretched first word) with their voice and
// word-duration signals.
function signalsFor(lines: readonly TimedLine[], v: VoiceLevels, levelDb: number, stretches: readonly VoiceStretch[]): Signals[] {
  const sung = voiceStretches(v, levelDb - WORD_LEVEL_DB, 200); // singing-level energy (for stretched first words)
  const out: Signals[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const prevEnd = prev ? (prev.sung_end_ms ?? prev.end_ms) : 0;
    // a: the voice at the stamp (the start of the stretch it is in, not before the previous line's
    // singing), else the next voice after it.
    const inside = stretches.find(([start, end]) => start <= l.start_ms + PRE_ROLL_MS && end > l.start_ms - PRE_ROLL_MS);
    const voice = inside ? Math.max(inside[0], prevEnd) : voiceFrom(stretches, l.start_ms - PRE_ROLL_MS);
    const before = voice === null ? null : Math.max(0, ...stretches.filter(([, end]) => end <= voice).map(([, end]) => end));
    const voiceGap = voice !== null && before !== null && voice - before >= LONG_GAP_MS;
    const alignGap = !!prev && l.start_ms - prevEnd >= LONG_GAP_MS;
    const words = l.words ?? [];
    const firstWordMs = words.length >= 2 ? words[1].start_ms - words[0].start_ms : null;
    const stretched = firstWordMs !== null && firstWordMs >= STRETCHED_WORD_MS;
    if (i > 0 && !voiceGap && !alignGap && !stretched) return; // inside a verse: not checked (QA still sees early_ms)
    let duration = l.start_ms;
    if (stretched) {
      const second = words[1].start_ms;
      const near = sung.filter(([start, end]) => start <= second + JOIN_GAP_MS && end > second - NEAR_SECOND_MS && start > l.start_ms + EARLY_MS).at(-1);
      duration = near ? near[0] : Math.max(l.start_ms, second - WORD_BEFORE_MS);
    }
    const loud = voice === null ? null : quantile([...slice(v, Math.max(before ?? 0, 0), Math.max(voice, l.start_ms))], 1);
    out.push({ i, voice, duration, firstWordMs, loud });
  });
  return out;
}

// The windows for the recognised-words pass: around each checked line's signals (line number, from, to).
export function asrWindows(lines: readonly TimedLine[], v: VoiceLevels): [number, number, number][] {
  const levelDb = singingLevel(lines, v);
  const stretches = voiceStretches(v, levelDb - VOICE_BELOW_SINGING_DB);
  return signalsFor(lines, v, levelDb, stretches).map((s) => {
    const l = lines[s.i];
    const prev = lines[s.i - 1];
    const points = [l.start_ms, s.duration, ...(s.voice !== null ? [s.voice] : [])];
    const from = Math.max(prev ? (prev.sung_end_ms ?? prev.end_ms) : 0, Math.min(...points) - 2_000, 0);
    const to = Math.min(lines[s.i + 1]?.start_ms ?? Infinity, Math.max(...points) + 4_000, from + 30_000);
    return [s.i + 1, Math.round(from), Math.round(to)];
  });
}

export function checkVocalStart(
  lines: readonly TimedLine[],
  v: VoiceLevels,
  options: { skip?: ReadonlySet<number>; asr?: ReadonlyMap<number, readonly AsrWord[]> } = {},
): VocalCheck {
  const skip = options.skip ?? new Set<number>();
  const levelDb = singingLevel(lines, v);
  const thresholdDb = levelDb - VOICE_BELOW_SINGING_DB;
  const stretches = voiceStretches(v, thresholdDb);
  const checks: LineCheck[] = [];
  const moves: GuardMove[] = [];
  for (const s of signalsFor(lines, v, levelDb, stretches)) {
    const l = lines[s.i];
    const prev = lines[s.i - 1];
    const prevEnd = prev ? (prev.sung_end_ms ?? prev.end_ms) : 0;
    const nextStart = lines[s.i + 1]?.start_ms ?? Infinity;
    const asr = options.asr?.get(s.i);
    const heard = asr ? matchFirstWords(l.text, asr) : null;
    const base = { index: s.i, stampMs: l.start_ms, voiceMs: s.voice, wordsMs: heard?.ms ?? null, wordsText: heard?.text ?? null, durationMs: s.duration, firstWordMs: s.firstWordMs, loudestBeforeDb: s.loud };
    if (skip.has(s.i)) {
      checks.push({ ...base, targetMs: l.start_ms, agree: [], why: "placed by hand", result: "set by hand" });
      continue;
    }
    const cands = [
      { name: "voice", ms: s.voice },
      { name: "words", ms: heard?.ms ?? null },
      { name: "word durations", ms: s.duration },
    ].filter((c): c is { name: string; ms: number } => c.ms !== null);
    const groups = cands.map((c) => cands.filter((o) => Math.abs(o.ms - c.ms) <= AGREE_MS));
    const rank = (g: typeof cands) => g.length * 10 + (g.some((c) => c.name === "words") ? 2 : 0) + (g.some((c) => c.name === "voice") ? 1 : 0);
    const best = groups.sort((x, y) => rank(y) - rank(x))[0] ?? [];
    let target: number;
    let agree: string[] = [];
    let why: string;
    if (best.length >= 2) {
      agree = best.map((c) => c.name);
      // The most precise of the agreeing signals: the voice onset, then the singing-level energy of a
      // stretched first word, then the recognised word (speech recognition times are rougher).
      const stretchedWord = s.firstWordMs !== null && s.firstWordMs >= STRETCHED_WORD_MS;
      target = (best.find((c) => c.name === "voice") ?? (stretchedWord ? best.find((c) => c.name === "word durations") : undefined) ?? best.find((c) => c.name === "words") ?? best[0]).ms;
      why = `${agree.join(", ")} agree`;
    } else if (heard) {
      target = heard.ms;
      why = "no two signals agree; the recognised words decide";
    } else if (s.firstWordMs !== null && s.firstWordMs >= STRETCHED_WORD_MS) {
      target = s.duration;
      why = "no two signals agree; the first word was stretched, so the word durations decide";
    } else if (s.voice !== null && s.voice - l.start_ms > EARLY_MS) {
      target = s.voice;
      why = "no two signals agree; the stamp is clearly before the voice";
    } else {
      target = l.start_ms;
      why = "no two signals agree; the alignment is kept";
    }
    if (Math.abs(target - l.start_ms) <= MOVE_MS) {
      checks.push({ ...base, targetMs: l.start_ms, agree, why, result: "in time" });
    } else if (target >= nextStart - NEXT_MARGIN_MS || (s.i > 0 && target <= prevEnd)) {
      checks.push({ ...base, targetMs: l.start_ms, agree, why: `${why}, but ${target >= nextStart - NEXT_MARGIN_MS ? "that is past the next line" : "that is inside the previous line"}`, result: "kept" });
    } else {
      moves.push({ index: s.i, fromMs: l.start_ms, toMs: target });
      checks.push({ ...base, targetMs: target, agree, why, result: "moved" });
    }
  }
  return { levelDb, thresholdDb, lines: checks, moves, stretches };
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
