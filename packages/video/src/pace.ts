// Automatic pacing (recipe shotLength "auto", the default): how long the shots are, chosen by the app
// from the song and the clips (guiding principle: a technical decision, never the user's).
//   The song's feel, from how densely it is sung (words per second over the sung stretches; the tempo
//   alone misleads: a ballad is often tracked at 130+ BPM):
//     calm    (< 2.2 words/s): long shots, ~6 s on verses, ~3.5 s on hooks
//     medium  (< 3.2 words/s): ~3.5 s on verses, ~2 s on hooks
//     driving (>= 3.2 words/s): ~2 s on verses, ~1.5 s on hooks
//   The clips: a shot is never longer than the typical clip (the median usable length) can fill at
//   0.8x, so the app never plans choppy slow motion (the Storyboard warns below 0.75x).
//   Whole bars always (cuts on the downbeat); 2 and 4 bars (the phrase) are preferred, 3 is allowed when it
//   fits the clips much better (5.3 s instead of a 7.1 s shot slowed to 0.73x).
// Pure: the cut plan uses it like "story" (hook / verse bars, never a short last shot).

export type Feel = "calm" | "medium" | "driving";
export type Pace = {
  feel: Feel;
  wordsPerS: number;
  verseBars: number;
  hookBars: number;
  minShotMs: number; // a shot is lengthened by whole bars until it reaches this
  barMs: number;
  clipMs: number | null; // the typical usable clip length (median), null: photos only / no clips
  text: string; // plain words, for the Storyboard header and pnpm make
};

export const FEEL_WORDS_PER_S = { calm: 2.2, driving: 3.2 } as const; // ballads ~1.5-2.2, pop ~2.5-3.2, faster above
const TARGET_S: Record<Feel, { verse: number; hook: number }> = {
  calm: { verse: 6, hook: 3.5 },
  medium: { verse: 3.5, hook: 2 },
  driving: { verse: 2, hook: 1.5 },
};
export const PACE_MIN_RATE = 0.8; // a planned shot never needs a clip slower than this
const ODD_PENALTY = 0.15; // 3, 5, 7 bars break the 2 / 4-bar phrase: chosen only when clearly better
const MAX_BARS = 8;

export type PaceLine = { text: string; sungStartMs: number; sungEndMs: number; words?: number };

// Words per second over the sung stretches (each line from its first to its last sung word).
export function songFeel(lines: readonly PaceLine[]): { feel: Feel; wordsPerS: number } {
  let words = 0;
  let ms = 0;
  for (const l of lines) {
    const d = l.sungEndMs - l.sungStartMs;
    if (!(d > 0)) continue;
    words += l.words ?? l.text.split(/\s+/).filter(Boolean).length;
    ms += d;
  }
  const wordsPerS = ms > 0 ? Math.round((words / (ms / 1000)) * 100) / 100 : 0;
  const feel: Feel = !ms ? "medium" : wordsPerS < FEEL_WORDS_PER_S.calm ? "calm" : wordsPerS < FEEL_WORDS_PER_S.driving ? "medium" : "driving";
  return { feel, wordsPerS };
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

// The bars nearest a target length that the clips can fill (at least one bar).
function barsFor(targetMs: number, barMs: number, limitMs: number, maxBars = MAX_BARS): number {
  let best = 1;
  let bestScore = Infinity;
  for (let bars = 1; bars <= maxBars; bars++) {
    const ms = bars * barMs;
    if (bars > 1 && ms > limitMs) break;
    const score = Math.abs(Math.log(ms / targetMs)) + (bars > 2 && bars % 2 === 1 ? ODD_PENALTY : 0);
    if (score < bestScore) [best, bestScore] = [bars, score];
  }
  return best;
}

export function choosePace(o: {
  lines: readonly PaceLine[]; // the song's sung lines (song time)
  barMs: number; // the typical bar (median of the detected bars)
  clipMs: readonly number[]; // each video clip's usable length (in / out, speed applied); photos left out
}): Pace {
  const { feel, wordsPerS } = songFeel(o.lines);
  const target = TARGET_S[feel];
  const clipMs = median(o.clipMs);
  const limitMs = clipMs === null ? Infinity : clipMs / PACE_MIN_RATE;
  const verseBars = barsFor(target.verse * 1000, o.barMs, limitMs);
  const hookBars = Math.min(verseBars, barsFor(target.hook * 1000, o.barMs, limitMs));
  const minShotMs = Math.max(800, Math.round(0.75 * hookBars * o.barMs));
  const s = (bars: number) => `${bars} bar${bars > 1 ? "s" : ""} (${((bars * o.barMs) / 1000).toFixed(1)} s)`;
  const feelText = feel === "calm" ? "a calm song" : feel === "driving" ? "a driving song" : "a mid-paced song";
  const clipText = clipMs === null ? "" : ` and clips of about ${(clipMs / 1000).toFixed(1)} s`;
  const text =
    verseBars === hookBars
      ? `Pacing: ${feelText} (${wordsPerS.toFixed(1)} words/s)${clipText} → ${s(verseBars)} per shot.`
      : `Pacing: ${feelText} (${wordsPerS.toFixed(1)} words/s)${clipText} → ${s(verseBars)} on verses, ${s(hookBars)} on hooks.`;
  return { feel, wordsPerS, verseBars, hookBars, minShotMs, barMs: o.barMs, clipMs, text };
}
