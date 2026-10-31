// The letter-by-letter typewriter: a line is typed one letter at a time at a steady pace, from the moment
// it appears, never behind the singer (each word fully typed by the moment it is sung). The cursor is
// still computed (after the last typed letter, blinking softly once the line is complete) but not drawn. Pure: the composition
// draws exactly what the tests check. Titles (not sung) type at the calm base pace.
import { AMOUNT, clamp01, type WordTiming } from "./types";

export const TYPE_BASE_CPS = 14; // letters per second when there is time (a calm, readable typing pace)
export const TYPE_MAX_CPS = 90; // never faster (a word sung right away is then typed as fast as it reads)
export const CURSOR_BLINK_S = 1.1; // one soft blink once the line is typed

// The typing pace from the effect's amount (Strength / intensity): 0 % calm (~8 letters/s), 50 % normal
// (~15), 100 % quick (~22). Never 0: at 0 % it still types visibly letter by letter (31 Oct 2026: with the
// stronger amounts the pace had run away to a near-instant line at 50 %, which read as a glide).
export function typingPace(amount: number): number {
  return 0.55 + 0.5 * Math.min(2, Math.max(0, amount / AMOUNT.balanced));
}

export type TypingPlan = { startFrame: number; perFrame: number; letters: number[]; total: number };

// letters: each word's letter count as laid out; words: when each word is sung (frames).
// pace: the effect's intensity amount (0.6 calm, 1 normal, 1.5 quick) times the base pace.
export function typingPlan(startFrame: number, words: readonly WordTiming[], letters: readonly number[], fps: number, pace = 1): TypingPlan {
  const total = letters.reduce((a, b) => a + b, 0);
  let perFrame = (TYPE_BASE_CPS * pace) / fps;
  let done = 0;
  for (let j = 0; j < letters.length; j++) {
    done += letters[j];
    const sungAt = words[j]?.startFrame ?? Infinity;
    const room = sungAt - startFrame;
    if (Number.isFinite(room)) perFrame = Math.max(perFrame, done / Math.max(1, room));
  }
  return { startFrame, perFrame: Math.min(perFrame, TYPE_MAX_CPS / fps), letters: [...letters], total };
}

// How many letters are typed at frame f (erase: the share 0-1 of the exit window gone by).
export function typedLetters(plan: TypingPlan, frame: number, erase = 0): number {
  const typed = Math.min(plan.total, Math.max(0, (frame - plan.startFrame) * plan.perFrame));
  return Math.min(typed, plan.total * (1 - clamp01(erase)));
}

// Per word: the share of its letters shown, and the cursor (after the word being typed; once the line is
// complete, after the last word, blinking softly; while erasing, after the last letter left).
export function typingWords(plan: TypingPlan, frame: number, fps: number, erase = 0): { chars: number; cursor: number }[] {
  const n = typedLetters(plan, frame, erase);
  let before = 0;
  const out = plan.letters.map((len) => {
    const chars = len ? clamp01((n - before) / len) : 1;
    before += len;
    return { chars, cursor: 0 };
  });
  if (!out.length) return out;
  const complete = n >= plan.total - 1e-6 && erase <= 0;
  // The word the cursor follows: the last one with any letter shown (else the first).
  let at = 0;
  for (let j = 0; j < out.length; j++) if (out[j].chars > 0) at = j;
  if (complete) {
    const doneFrame = plan.startFrame + plan.total / plan.perFrame;
    const phase = ((frame - doneFrame) / (CURSOR_BLINK_S * fps)) % 1;
    out[at].cursor = 0.5 + 0.5 * Math.cos(2 * Math.PI * phase); // on, softly off, on again
  } else out[at].cursor = n > 0 || erase > 0 ? 1 : 0;
  return out;
}

// A title card typed in: the share of its letters shown (base pace; done before `byFrame`, if given).
export function typedShare(startFrame: number, letters: number, frame: number, fps: number, byFrame?: number, pace = 1): number {
  if (letters <= 0) return 1;
  let perFrame = (TYPE_BASE_CPS * pace) / fps;
  if (byFrame !== undefined && byFrame > startFrame) perFrame = Math.max(perFrame, letters / (byFrame - startFrame));
  return clamp01(((frame - startFrame) * perFrame) / letters);
}
