// The music-reactive add-ons (recipe heldGlow / chorusLift / shine "on"), on top of any lyric effect.
// Pure functions of the frame, so preview, render and tests agree.
//   held-note glow  a word sung for 0.8 s or longer brightens in the accent colour while it is held, then
//                   settles over 0.67 s;
//   chorus lift     the first line of each chorus arrives a touch bigger (+5%) with a soft glow, at its
//                   fullest when it is settled, easing back over 1.5 s;
//   shine           one soft light sweep (0.67 s) across each chorus line, on the first downbeat after it is
//                   settled (else half a second after).
import { clamp01, EASINGS } from "./types";

export const HELD_MIN_FRAMES = 24; // 0.8 s at 30 fps
export const HELD_GLOW_MAX = 0.75;
export const HELD_SETTLE_FRAMES = 20;
export const LIFT_SCALE = 0.05;
export const LIFT_GLOW = 0.3;
export const LIFT_EASE_FRAMES = 45;
export const LIFT_MAX_SCALE = 1 + LIFT_SCALE;
export const SHINE_FRAMES = 20;

export type Accents = { heldGlow?: boolean; chorusLift?: boolean; shine?: boolean; downbeats?: readonly number[] };

// A held word's glow at frame f (0 when the word is not held long).
export function heldGlow(frame: number, w: { startFrame: number; endFrame: number }): number {
  const length = w.endFrame - w.startFrame;
  if (length < HELD_MIN_FRAMES || frame < w.startFrame) return 0;
  if (frame <= w.endFrame) return HELD_GLOW_MAX * EASINGS["ease-in-out"](clamp01((frame - w.startFrame) / (length * 0.7)));
  return HELD_GLOW_MAX * (1 - EASINGS["ease-out"](clamp01((frame - w.endFrame) / HELD_SETTLE_FRAMES)));
}

// Chorus lift (0-1): rises while the line comes in (from enterFrame), full at startFrame, then eases back.
export function liftAt(frame: number, enterFrame: number, startFrame: number): number {
  if (frame < enterFrame) return 0;
  if (frame < startFrame) return EASINGS["ease-out"](clamp01((frame - enterFrame) / Math.max(1, startFrame - enterFrame)));
  return 1 - EASINGS["ease-in-out"](clamp01((frame - startFrame) / LIFT_EASE_FRAMES));
}

// Shine: where the sweep is across the line (0-1) at frame f, or undefined when it is not sweeping.
export function shineAt(frame: number, startFrame: number, endFrame: number, downbeats: readonly number[] = []): number | undefined {
  const at = downbeats.find((d) => d >= startFrame && d + SHINE_FRAMES <= endFrame) ?? (endFrame - startFrame > 15 + SHINE_FRAMES ? startFrame + 15 : undefined);
  if (at === undefined || frame < at || frame > at + SHINE_FRAMES) return undefined;
  return EASINGS["ease-in-out"]((frame - at) / SHINE_FRAMES);
}

// Emphasis word (recipe emphasis "on"): the key word of a line, drawn in the hook font, a touch bigger and
// in the accent colour. The word the singer holds longest (with the aligned word times), else the longest
// word; never a small word ("the", "and", "you"...). -1 when the line has no word worth it.
const SMALL = new Set(["the", "and", "you", "your", "for", "but", "are", "was", "with", "that", "this", "from", "into", "onto", "its", "it's", "i'm", "i'll", "she", "her", "him", "his", "they", "them", "our", "not", "all", "can", "will", "just", "when", "what", "who", "how", "then", "than", "there", "here", "have", "has", "had", "been", "were", "a", "an", "to", "of", "in", "on", "at", "is", "be", "me", "my", "we", "us", "so", "oh", "or", "if", "do", "no", "by", "up"]);
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
export function emphasisWord(words: readonly string[], timings?: readonly { startFrame: number; endFrame: number }[] | null): number {
  const ok = words.map((w) => bare(w).length >= 3 && !SMALL.has(bare(w)));
  if (!ok.some(Boolean)) return -1;
  const score = (k: number) => (timings && timings.length === words.length ? timings[k].endFrame - timings[k].startFrame : 0) * 100 + bare(words[k]).length;
  let best = -1;
  for (let k = 0; k < words.length; k++) if (ok[k] && (best < 0 || score(k) > score(best))) best = k;
  return best;
}
export const EMPHASIS_SCALE = 1.12;
