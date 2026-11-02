// Automatic pacing (recipe shotLength "auto", the default): how long the shots are, chosen by the app
// from the song and the clips (guiding principle: a technical decision, never the user's).
//   The song's feel, from how densely it is sung (words per second over the sung stretches; the tempo
//   alone misleads: a ballad is often tracked at 130+ BPM):
//     calm    (< 2.2 words/s): long shots, ~6 s on verses, ~3.5 s on hooks
//     medium  (< 3.2 words/s): ~3.5 s on verses, ~2 s on hooks
//     driving (>= 3.2 words/s): ~2 s on verses, ~1.5 s on hooks
//   The clips: a shot is never longer than the typical clip (the median usable length) can fill at
//   0.8x, so the app never plans choppy slow motion (the Storyboard warns below 0.75x).
//   Normal speed first (2 Nov 2026): a shot longer than the typical clip costs a slow-motion penalty
//   (SLOW_WEIGHT), so 5.2 s clips get 3-bar shots (4.7 s, normal speed) rather than 4-bar shots (6.3 s at
//   0.82x). Slow motion is the user's creative choice (clip editor "speed"), never a side effect of pacing.
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
// A shot longer than the typical clip plays that clip in slow motion. Every ln-unit of slowing costs this
// much in the bar score (the distance to the target length costs 1 per ln-unit), so the app picks shots the
// clips cover at their own speed unless the target is far away. PACE_MIN_RATE stays the hard limit. 2 Nov 2026.
export const SLOW_WEIGHT = 2;
const MAX_BARS = 8;
const SHIFT_MIN_RATE = 0.65; // a user's "calmer" adjustment may slow clips down to this

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

// The bars nearest a target length that the clips can fill (at least one bar), preferring shots the
// clips cover at normal speed (clipMs: the typical usable clip length, null: no slow-motion cost).
function barsFor(targetMs: number, barMs: number, limitMs: number, clipMs: number | null, maxBars = MAX_BARS): number {
  let best = 1;
  let bestScore = Infinity;
  for (let bars = 1; bars <= maxBars; bars++) {
    const ms = bars * barMs;
    if (bars > 1 && ms > limitMs) break;
    const slow = clipMs !== null && ms > clipMs ? SLOW_WEIGHT * Math.log(ms / clipMs) : 0;
    const score = Math.abs(Math.log(ms / targetMs)) + (bars > 2 && bars % 2 === 1 ? ODD_PENALTY : 0) + slow;
    if (score < bestScore) [best, bestScore] = [bars, score];
  }
  return best;
}

export function choosePace(o: {
  lines: readonly PaceLine[]; // the song's sung lines (song time)
  barMs: number; // the typical bar (median of the detected bars)
  clipMs: readonly number[]; // each video clip's usable length (in / out, speed applied); photos left out
  shift?: number; // the user's pace adjustment (recipe paceShift, the reactions): bars added (+) or taken (-)
  instrumental?: boolean; // no singing: paced as a calm piece
}): Pace {
  const { feel, wordsPerS } = o.instrumental ? { feel: "calm" as Feel, wordsPerS: 0 } : songFeel(o.lines);
  const target = TARGET_S[feel];
  const clipMs = median(o.clipMs);
  const limitMs = clipMs === null ? Infinity : clipMs / PACE_MIN_RATE;
  const auto = barsFor(target.verse * 1000, o.barMs, limitMs, clipMs);
  const autoHook = Math.min(auto, barsFor(target.hook * 1000, o.barMs, limitMs, clipMs));
  // The adjustment may go past the comfortable clip length, down to 0.65x (the user asked for it).
  const shift = o.shift ?? 0;
  const maxBars = clipMs === null ? MAX_BARS : Math.max(1, Math.min(MAX_BARS, Math.floor(clipMs / SHIFT_MIN_RATE / o.barMs)));
  const verseBars = Math.max(1, Math.min(Math.max(auto, maxBars), auto + shift));
  const hookBars = Math.max(1, Math.min(verseBars, autoHook + shift));
  const minShotMs = Math.max(800, Math.round(0.75 * hookBars * o.barMs));
  const s = (bars: number) => `${bars} bar${bars > 1 ? "s" : ""} (${((bars * o.barMs) / 1000).toFixed(1)} s)`;
  const feelText = o.instrumental ? "an instrumental, paced as a calm piece" : feel === "calm" ? "a calm song" : feel === "driving" ? "a driving song" : "a mid-paced song";
  const clipText = clipMs === null ? "" : ` and clips of about ${(clipMs / 1000).toFixed(1)} s`;
  const text =
    verseBars === hookBars
      ? `Pacing: ${feelText}${o.instrumental ? "" : ` (${wordsPerS.toFixed(1)} words/s)`}${clipText} → ${s(verseBars)} per shot.`
      : `Pacing: ${feelText}${o.instrumental ? "" : ` (${wordsPerS.toFixed(1)} words/s)`}${clipText} → ${s(verseBars)} on verses, ${s(hookBars)} on hooks.`;
  const adjusted = shift ? ` (your adjustment: ${shift > 0 ? "+" : ""}${shift} bar${Math.abs(shift) > 1 ? "s" : ""})` : "";
  return { feel, wordsPerS, verseBars, hookBars, minShotMs, barMs: o.barMs, clipMs, text: text.replace(/\.$/, `${adjusted}.`) };
}
