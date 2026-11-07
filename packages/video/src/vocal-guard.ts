// Vocal-start check (pnpm make): the first sung word of a song, and the first word after every long
// instrumental, must be placed right (within ~0.3 s) with no manual fix. The aligner sometimes pulls
// such a line into the music before it. Applied to the stored alignment, never re-aligning. For line 1,
// lines after an instrumental gap, lines whose first word is stretched and every hook line (an early
// karaoke highlight is very visible; with `all`: every line), these signals:
//   stamp           the aligner's own line start (WhisperX);
//   voice           the onset of sustained voice on the vocal track: at most VOICE_BELOW_SINGING_DB under
//                   the song's own singing level (measured on the aligned lines), for at least
//                   MIN_VOICE_MS, so instrument bleed, breaths and short hums are not "voice";
//   words           a short speech-recognition pass on the vocal track around the line, matched against
//                   the line's first words (services/audio first_words; optional: needs the AI packages);
//   word durations  only when the first word is stretched (>= STRETCHED_WORD_MS, back into the music):
//                   the singing-level energy just before the second word. A normal first word gives no
//                   independent signal (it is the stamp).
// A line moves only where two signals agree within AGREE_MS (never on one signal alone), except: a first
// word of LONG_FIRST_WORD_MS or more with the recognised words within WORDS_NEAR_MS of the word-duration
// estimate moves to the recognised words; and a first word of LONG_WORD_MS or more with voice and words
// both later than the stamp and within PAIR_NEAR_MS of each other moves to the recognised words (not on
// the last line: a held note); and, where no rule above fired, a stamp in silence on the vocal track
// (the loudest level in the 2 s after it under the voice level) with every other signal (voice, words, word
// durations) later by at least the lead-in (reviewMs), at least two of them (never one alone), moves to the
// recognised words when they are within WORDS_NEAR_MS of the voice or of the word-duration estimate, else to
// the earliest of those signals: they all say the stamp is wrong, even where they differ among themselves.
// A signal that disagrees with the stamp without a second one keeps the stamp and flags the line for review
// (the Lyrics tab); a stretched first word on a hook or the last line may be a held note: flagged, never
// moved on that alone (only when the stamp is NOT in silence; in silence the rule above may move them).
// Never onto the next line or into the previous one. Pure, so the tests check exactly what pnpm make does.
import { normalizeLyric, type TimedLine } from "./lrc";

export const EARLY_MS = 1000; // a stretched first word: its singing starts at least this much after the stamp
export const AGREE_MS = 300; // two signals this close agree
export const MOVE_MS = 300; // a line is moved when the decision is this far from its stamp
export const LONG_GAP_MS = 4000; // no voice for this long before a line: an instrumental gap
export const MIN_VOICE_MS = 500; // voice must last this long (pauses under JOIN_GAP_MS inside it are fine)
export const VOICE_BELOW_SINGING_DB = 15; // voice: at most this far under the song's singing level
export const STRETCHED_WORD_MS = 2500; // a first word lasting this long (to the second word's start) was stretched back
export const LONG_FIRST_WORD_MS = 4000; // with the recognised words near the estimate: moved on those two
export const WORDS_NEAR_MS = 1000;
export const LONG_WORD_MS = 2000; // a first word this long is checked; with voice + words within PAIR_NEAR_MS: moved to the words
export const PAIR_NEAR_MS = 600;
const JOIN_GAP_MS = 250; // short pauses between sung words do not split the voice
const WORD_BEFORE_MS = 400; // no energy found near the second word: the first word starts this much before it
const NEAR_SECOND_MS = 1500;
const WORD_LEVEL_DB = 6; // the first word's own energy: within this of the singing level
const PRE_ROLL_MS = 200; // voice this close before a line's start counts as the line's own
const NEXT_MARGIN_MS = 100;
const MISSED_WORD_MS = 250; // the recognised words start at the second lyric word: the first one this much earlier

export type VoiceLevels = { hopMs: number; db: readonly number[] }; // the voice map (version 2)
export type VoiceStretch = readonly [number, number]; // ms: sustained voice
// shortensPrevious: a later start inside the previous line (its last note held too long): that line ends here.
// reason: set by the stamp-in-silence rule, for the log: "(<reason>)" instead of "(vocals start)".
export type GuardMove = { index: number; fromMs: number; toMs: number; shortensPrevious?: boolean; reason?: string };
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
  stampLevelDb: number | null; // the vocal track's loudest level in the 2 s after the stamp (why the voice was or was not heard there)
  targetMs: number; // where the line starts now
  agree: string[]; // the signals that agreed on targetMs
  why: string;
  result: "moved" | "in time" | "kept" | "flagged for review" | "set by hand";
};
// The signals of a check that point at a start of their own: voice, words, and the word durations
// (only when the first word is stretched, i.e. they differ from the stamp).
const startSignals = (c: Pick<LineCheck, "stampMs" | "voiceMs" | "wordsMs" | "durationMs">) =>
  [
    { name: "voice", ms: c.voiceMs },
    { name: "words", ms: c.wordsMs },
    { name: "word durations", ms: c.durationMs !== null && Math.abs(c.durationMs - c.stampMs) > AGREE_MS ? c.durationMs : null },
  ].filter((x): x is { name: string; ms: number } => x.ms !== null);

export const LIKELY_START_MS = 1000; // two signals this close make a likely start (looser than AGREE_MS, which moves a line by itself)

// A flagged line's likely start: two signals within LIKELY_START_MS of each other; the EARLIER of the pair
// (a line a little early is better than late). The closest pair wins. null: no pair, or it is the stamp already.
export function likelyStart(c: Pick<LineCheck, "stampMs" | "voiceMs" | "wordsMs" | "durationMs">): number | null {
  const sig = startSignals(c);
  let best: { gap: number; ms: number } | null = null;
  for (let i = 0; i < sig.length; i++) {
    for (let j = i + 1; j < sig.length; j++) {
      const gap = Math.abs(sig[i].ms - sig[j].ms);
      if (gap <= LIKELY_START_MS && (!best || gap < best.gap)) best = { gap, ms: Math.min(sig[i].ms, sig[j].ms) };
    }
  }
  return best && Math.abs(best.ms - c.stampMs) > AGREE_MS ? Math.round(best.ms) : null;
}

// "about 2 s" / "about 1.5 s": whole seconds above 2 s, halves below (at least half a second).
const aboutSeconds = (ms: number) => {
  const s = Math.abs(ms) / 1000;
  const r = s > 2 ? Math.round(s) : Math.max(0.5, Math.round(s * 2) / 2);
  return `about ${r} s`;
};

// A flagged line in plain words (the technical `why` stays in a tooltip). heldNote: the first word is long
// and this is a hook or the last line, so it may simply be a held note.
export function flagReason(c: Pick<LineCheck, "stampMs" | "voiceMs" | "wordsMs" | "durationMs">, heldNote = false): string {
  const sig = startSignals(c);
  const far = sig.filter((x) => Math.abs(x.ms - c.stampMs) > AGREE_MS);
  if (heldNote && far.length && far.every((x) => x.name === "word durations")) return "The first word may be a long held note. Listen with ▶.";
  const ms = likelyStart(c) ?? far[0]?.ms ?? null;
  if (ms === null) return "The app could not hear where this line starts. Listen with ▶.";
  return `The singing may start ${aboutSeconds(ms - c.stampMs)} ${ms >= c.stampMs ? "later" : "earlier"} than shown. Listen with ▶.`;
}

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
  return out.flatMap((st) => splitAtAttacks(v, thresholdDb, st, minMs));
}

// A wet vocal stem (Suno's vocals.wav keeps the reverb) fills a short pause with the tail of the phrase
// before, so the next phrase joined it (pauses under JOIN_GAP_MS join) and its own start was lost. Found
// with the clean-stem tests of L1a: a pause of at least SPLIT_GAP_MS under the threshold followed by a
// sharp attack (ATTACK_DB up within ATTACK_MS) starts a new stretch, when both parts last at least minMs
// (so no voice is ever dropped). Demucs stems rarely have such pauses inside a stretch.
const SPLIT_GAP_MS = 100;
const ATTACK_DB = 12;
const ATTACK_MS = 60;
function splitAtAttacks(v: VoiceLevels, thresholdDb: number, [start, end]: VoiceStretch, minMs: number): VoiceStretch[] {
  const out: VoiceStretch[] = [];
  let from = start;
  let gapStart: number | null = null;
  for (let ms = start; ms < end; ms += v.hopMs) {
    const db = v.db[Math.round(ms / v.hopMs)];
    if (db <= thresholdDb) {
      if (gapStart === null) gapStart = ms;
      continue;
    }
    if (gapStart !== null && ms - gapStart >= SPLIT_GAP_MS && ms - from >= minMs && end - ms >= minMs) {
      const gap = v.db.slice(Math.round(gapStart / v.hopMs), Math.round(ms / v.hopMs));
      const attack = Math.max(...v.db.slice(Math.round(ms / v.hopMs), Math.round((ms + ATTACK_MS) / v.hopMs) + 1));
      if (attack - Math.min(...gap) >= ATTACK_DB && gapStart - from >= minMs) {
        out.push([from, gapStart]);
        from = ms;
      }
    }
    gapStart = null;
  }
  out.push([from, end]);
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
function signalsFor(lines: readonly TimedLine[], v: VoiceLevels, levelDb: number, stretches: readonly VoiceStretch[], all = false): Signals[] {
  const sung = voiceStretches(v, levelDb - WORD_LEVEL_DB, 200); // singing-level energy (for stretched first words)
  const out: Signals[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const prevEnd = prev ? (prev.sung_end_ms ?? prev.end_ms) : 0;
    // a: the voice at the stamp (the start of the stretch it is in, not before the previous line's
    // singing), else the next voice after it.
    // The previous line's own singing (the stretch its last word starts in) never counts for this line,
    // even when it ends just before this stamp (an early stamp right after the previous line).
    const prevLast = prev ? (prev.words?.at(-1)?.start_ms ?? prev.start_ms) : null;
    const mine = stretches.filter(([start, end]) => prevLast === null || !(start <= prevLast && end > prevLast));
    // The stretch the line is in: one going on at the stamp, else one starting within the pre-roll, else
    // one ending within it. (In that order since L1a: on a wet stem a phrase's reverb tail can end just
    // before the next line's stamp, and that phrase is not the next line's voice.)
    const inside =
      mine.find(([start, end]) => start <= l.start_ms && end > l.start_ms) ??
      mine.find(([start]) => start >= l.start_ms - PRE_ROLL_MS && start <= l.start_ms + PRE_ROLL_MS) ??
      mine.find(([start, end]) => start <= l.start_ms + PRE_ROLL_MS && end > l.start_ms - PRE_ROLL_MS);
    // Sung on without a pause from the previous line: no onset of its own to measure (no voice signal).
    const continuous = prevLast !== null && stretches.some(([start, end]) => start <= prevLast && end > l.start_ms + PRE_ROLL_MS);
    const voice = continuous ? null : inside ? inside[0] : voiceFrom(mine, l.start_ms - PRE_ROLL_MS);
    const before = voice === null ? null : Math.max(0, ...stretches.filter(([, end]) => end <= voice).map(([, end]) => end));
    const voiceGap = voice !== null && before !== null && voice - before >= LONG_GAP_MS;
    const alignGap = !!prev && l.start_ms - prevEnd >= LONG_GAP_MS;
    const words = l.words ?? [];
    const firstWordMs = words.length >= 2 ? words[1].start_ms - words[0].start_ms : null;
    const stretched = firstWordMs !== null && firstWordMs >= STRETCHED_WORD_MS;
    const longWord = firstWordMs !== null && firstWordMs >= LONG_WORD_MS;
    // Inside a verse and not a hook: not checked unless `all` (QA still sees early_ms).
    if (!all && i > 0 && !voiceGap && !alignGap && !longWord && !l.isHook) return;
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
export function asrWindows(lines: readonly TimedLine[], v: VoiceLevels, all = false): [number, number, number][] {
  const levelDb = singingLevel(lines, v);
  const stretches = voiceStretches(v, levelDb - VOICE_BELOW_SINGING_DB);
  return signalsFor(lines, v, levelDb, stretches, all).map((s) => {
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
  // reviewMs: a disagreement smaller than this (the brand's lead-in, motion.gapLeadInS) is not visible: not flagged.
  // all: check every line (pnpm lyrics:check-start --all), not only line 1, gaps, stretched words and hooks.
  options: { skip?: ReadonlySet<number>; asr?: ReadonlyMap<number, readonly AsrWord[]>; reviewMs?: number; all?: boolean } = {},
): VocalCheck {
  const reviewMs = options.reviewMs ?? 1000;
  const skip = options.skip ?? new Set<number>();
  const levelDb = singingLevel(lines, v);
  const thresholdDb = levelDb - VOICE_BELOW_SINGING_DB;
  const stretches = voiceStretches(v, thresholdDb);
  const checks: LineCheck[] = [];
  const moves: GuardMove[] = [];
  for (const s of signalsFor(lines, v, levelDb, stretches, options.all)) {
    const l = lines[s.i];
    const prev = lines[s.i - 1];
    const prevEnd = prev ? (prev.sung_end_ms ?? prev.end_ms) : 0;
    const nextStart = lines[s.i + 1]?.start_ms ?? Infinity;
    const asr = options.asr?.get(s.i);
    const heard = asr ? matchFirstWords(l.text, asr) : null;
    const stampLevelDb = quantile([...slice(v, l.start_ms, l.start_ms + 2_000)], 1);
    const base = { index: s.i, stampMs: l.start_ms, voiceMs: s.voice, wordsMs: heard?.ms ?? null, wordsText: heard?.text ?? null, durationMs: s.duration, firstWordMs: s.firstWordMs, loudestBeforeDb: s.loud, stampLevelDb };
    if (skip.has(s.i)) {
      checks.push({ ...base, targetMs: l.start_ms, agree: [], why: "placed by hand", result: "set by hand" });
      continue;
    }
    const stretched = s.firstWordMs !== null && s.firstWordMs >= STRETCHED_WORD_MS;
    const heldNote = stretched && (l.isHook || s.i === lines.length - 1); // a long first word may be sung long
    const at = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
    const by = (ms: number) => `${ms >= l.start_ms ? "+" : "-"}${(Math.abs(ms - l.start_ms) / 1000).toFixed(1)} s`;
    const cands = [
      { name: "stamp", ms: l.start_ms as number | null },
      { name: "voice", ms: s.voice },
      { name: "words", ms: heard?.ms ?? null },
      { name: "word durations", ms: stretched ? s.duration : null }, // only an independent signal when stretched
    ].filter((c): c is { name: string; ms: number } => c.ms !== null);
    const groups = cands.map((c) => cands.filter((o) => Math.abs(o.ms - c.ms) <= AGREE_MS));
    const rank = (g: typeof cands) => g.length * 10 + (g.some((c) => c.name === "words") ? 2 : 0) + (g.some((c) => c.name === "voice") ? 1 : 0);
    const best = [...groups].sort((x, y) => rank(y) - rank(x))[0] ?? [];
    let target = l.start_ms;
    let agree: string[] = [];
    let why: string;
    let flag = false;
    let reason: string | undefined;
    // The stamp is in silence on the vocal track, and every other signal is at least the lead-in later (two or more).
    const later = cands.filter((c) => c.name !== "stamp");
    const silentStamp = stampLevelDb !== null && stampLevelDb < thresholdDb && later.length >= 2 && later.every((c) => c.ms - l.start_ms >= reviewMs);
    if (s.firstWordMs !== null && s.firstWordMs >= LONG_FIRST_WORD_MS && heard && Math.abs(heard.ms - s.duration) <= WORDS_NEAR_MS) {
      // A first word of seconds (stretched back into the music) and the recognised words near its estimate.
      const voiceToo = s.voice !== null && Math.abs(s.voice - heard.ms) <= AGREE_MS;
      target = voiceToo ? s.voice! : heard.ms;
      agree = voiceToo ? ["voice", "words", "word durations"] : ["words", "word durations"];
      why = `the first word lasts ${(s.firstWordMs / 1000).toFixed(1)} s and the recognised words are within ${(Math.max(0.1, Math.round(Math.abs(heard.ms - s.duration) / 100) / 10)).toFixed(1)} s of the word-duration estimate`;
    } else if (
      s.firstWordMs !== null && s.firstWordMs >= LONG_WORD_MS && s.i < lines.length - 1 && heard && s.voice !== null &&
      Math.abs(s.voice - heard.ms) <= PAIR_NEAR_MS && Math.min(s.voice, heard.ms) > l.start_ms + MOVE_MS
    ) {
      // A long first word (a strong sign it was stretched back) and voice + words agreeing it starts later.
      target = heard.ms;
      agree = ["voice", "words"];
      why = `the first word lasts ${(s.firstWordMs / 1000).toFixed(1)} s and voice and words agree within ${(Math.abs(s.voice - heard.ms) / 1000).toFixed(1)} s that it starts later (moved to the recognised words)`;
    } else if (best.length >= 2) {
      agree = best.map((c) => c.name);
      // The most precise of the agreeing signals: the stamp (when it is one of them), the voice onset, the
      // singing-level energy of a stretched first word, then the recognised word (rougher times).
      target = (best.find((c) => c.name === "stamp") ?? best.find((c) => c.name === "voice") ?? best.find((c) => c.name === "word durations") ?? best[0]).ms;
      why = `${agree.join(", ")} agree`;
    } else if (silentStamp) {
      // The stamp is in silence and every signal is later: they all say the stamp is wrong, even if they differ.
      const voiceMs = later.find((c) => c.name === "voice")?.ms;
      const durMs = later.find((c) => c.name === "word durations")?.ms;
      const nearWords = heard && ((voiceMs !== undefined && Math.abs(voiceMs - heard.ms) <= WORDS_NEAR_MS) || (durMs !== undefined && Math.abs(durMs - heard.ms) <= WORDS_NEAR_MS));
      target = nearWords ? heard!.ms : Math.min(...later.map((c) => c.ms));
      agree = later.map((c) => c.name);
      const signals = agree.join(", ");
      reason = `stamp in silence; ${signals} all later`;
      why = `stamp in silence; ${signals} all later (moved to ${nearWords ? "the recognised words" : "the earliest"})`;
    } else {
      // No two signals agree: the stamp stays. A signal that disagrees with it is flagged for review.
      const others = cands.filter((c) => c.name !== "stamp" && Math.abs(c.ms - l.start_ms) > AGREE_MS);
      // A difference smaller than the lead-in (the line is on screen that long before it is sung) is not visible.
      const visible = others.filter((c) => Math.abs(c.ms - l.start_ms) >= reviewMs);
      flag = visible.length > 0 || cands.length === 1;
      why = others.length && !visible.length
        ? `only ${others.map((c) => `${c.name} ${at(c.ms)} (${by(c.ms)})`).join(", only ")}; less than the ${(reviewMs / 1000).toFixed(1)} s lead-in, not visible`
        : others.length
        ? `only ${others.map((c) => `${c.name} ${at(c.ms)} (${by(c.ms)})`).join(", only ")}; no second signal agrees${heldNote && others.some((c) => c.name === "word durations") ? `; the long first word (${(s.firstWordMs! / 1000).toFixed(1)} s) may be a held note (${l.isHook ? "a hook" : "the last line"})` : ""}`
        : cands.length === 1
          ? "no voice and no recognised words to compare with"
          : "no two signals agree";
    }
    if (flag) {
      checks.push({ ...base, targetMs: l.start_ms, agree, why, result: "flagged for review" });
    } else if (Math.abs(target - l.start_ms) <= MOVE_MS) {
      checks.push({ ...base, targetMs: l.start_ms, agree, why, result: "in time" });
    } else if (target > l.start_ms && s.i > 0 && target <= prevEnd && target < nextStart - NEXT_MARGIN_MS && target > (prev.words?.at(-1)?.start_ms ?? prev.start_ms) + MOVE_MS) {
      // Two signals agree it starts later, inside the previous line: that line's last note was held too
      // long (its end is too late), so it ends where this one starts.
      moves.push({ index: s.i, fromMs: l.start_ms, toMs: target, shortensPrevious: true, ...(reason ? { reason } : {}) });
      checks.push({ ...base, targetMs: target, agree, why: `${why}; line ${s.i} now ends there (its end was too long)`, result: "moved" });
    } else if (target >= nextStart - NEXT_MARGIN_MS || (s.i > 0 && target <= prevEnd)) {
      checks.push({ ...base, targetMs: l.start_ms, agree, why: `${why}, but ${target >= nextStart - NEXT_MARGIN_MS ? "that is past the next line" : "that is inside the previous line"}`, result: "flagged for review" });
    } else {
      moves.push({ index: s.i, fromMs: l.start_ms, toMs: target, ...(reason ? { reason } : {}) });
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
  for (const m of moves) {
    out[m.index] = moveLineStart(out[m.index], m.toMs, out[m.index + 1]?.start_ms ?? null);
    const prev = out[m.index - 1];
    if (m.shortensPrevious && prev) out[m.index - 1] = { ...prev, end_ms: Math.min(prev.end_ms, m.toMs), ...(prev.sung_end_ms !== undefined ? { sung_end_ms: Math.min(prev.sung_end_ms, m.toMs - 50) } : {}) };
  }
  return out;
}
