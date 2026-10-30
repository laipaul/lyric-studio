// The letters rise into place one after another, a soft wave across the line (Canva's "Ascend"), as the
// line comes in; it fades out. The composition draws each letter at ascendLetter(); the line is settled
// (every letter in place) at its usual time.
import { clamp01, EASINGS, type LyricEffect } from "./types";

export const ASCEND_LIFT_PX = 28; // how far below its place a letter starts (x the amount)
export const ASCEND_SPREAD = 5; // letters moving at the same time

export const ascend: LyricEffect = {
  name: "ascend",
  label: "Ascend",
  description: "the letters rise into place one after another",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 900, easing: "linear" },
  enter: (p) => ({ opacity: Math.min(1, p * 1.5), wave: p }),
  exit: (q) => ({ opacity: 1 - q }),
  reach: (a) => ({ down: ASCEND_LIFT_PX * a }),
};

// Letter j of n at wave w (0-1): its rise (0 = in place) and opacity.
export function ascendLetter(j: number, n: number, wave: number, amount: number): { y: number; opacity: number } {
  const t = clamp01((wave * (n + ASCEND_SPREAD) - j) / ASCEND_SPREAD);
  const e = EASINGS["ease-out"](t);
  return { y: ASCEND_LIFT_PX * amount * (1 - e), opacity: t };
}
