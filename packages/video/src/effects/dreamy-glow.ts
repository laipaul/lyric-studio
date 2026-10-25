// A soft bloom: the line glows up out of a light haze, then keeps a gentle breathing glow.
import type { LyricEffect } from "./types";

const BREATH_SECONDS = 3.2;

export const dreamyGlow: LyricEffect = {
  name: "dreamy-glow",
  label: "Dreamy glow",
  description: "glows up out of a soft haze, then breathes gently",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 900, easing: "ease-in-out" },
  enter: (p, a) => ({ opacity: p, blur: 1.5 * a * (1 - p), glow: 0.6 * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, blur: 1.5 * a * q, glow: 0.6 * q }),
  hold: (frame, a, seed, fps) => ({ glow: 0.25 * a * (0.6 + 0.4 * Math.sin((2 * Math.PI * frame) / (BREATH_SECONDS * fps) + seed)) }),
};
