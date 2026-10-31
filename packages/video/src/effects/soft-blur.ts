// The line comes into focus from a soft blur (at most ~4 px) and goes out of focus again.
import type { LyricEffect } from "./types";

// 31 Oct 2026: 4 px was not seen at all in the viewer ("Blur in doesn't work"): now a real focus pull.
export const SOFT_BLUR_MAX_PX = 12;
export const softBlurPx = (a: number) => Math.min(SOFT_BLUR_MAX_PX, 9 * a); // subtle 5.4, balanced 9, expressive 12

export const softBlur: LyricEffect = {
  name: "soft-blur",
  label: "Soft blur",
  description: "comes into focus from a soft blur (max 4 px) and blurs away",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 700, easing: "ease-out" },
  enter: (p, a) => ({ opacity: p, blur: softBlurPx(a) * (1 - p), scale: 1 + 0.03 * a * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, blur: softBlurPx(a) * q }),
};
