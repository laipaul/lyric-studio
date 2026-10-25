// The line comes into focus from a soft blur (at most ~4 px) and goes out of focus again.
import type { LyricEffect } from "./types";

export const SOFT_BLUR_MAX_PX = 4;
export const softBlurPx = (a: number) => Math.min(SOFT_BLUR_MAX_PX, 3 * a); // subtle 1.8, balanced 3, expressive 4

export const softBlur: LyricEffect = {
  name: "soft-blur",
  label: "Soft blur",
  description: "comes into focus from a soft blur (max 4 px) and blurs away",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 700, easing: "ease-out" },
  enter: (p, a) => ({ opacity: p, blur: softBlurPx(a) * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, blur: softBlurPx(a) * q }),
};
