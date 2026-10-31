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
  // 31 Oct 2026: stronger haze and glow ("Dreamy glow doesn't work": 1.5 px and a faint glow were not seen).
  enter: (p, a) => ({ opacity: p, blur: 6 * a * (1 - p), glow: Math.min(1, 0.5 + 0.5 * (1 - p)) }),
  exit: (q, a) => ({ opacity: 1 - q, blur: 6 * a * q, glow: Math.min(1, 0.5 + 0.5 * q) }),
  hold: (frame, a, seed, fps) => ({ glow: Math.min(1, 0.55 * a * (0.6 + 0.4 * Math.sin((2 * Math.PI * frame) / (BREATH_SECONDS * fps) + seed))) }),
};
