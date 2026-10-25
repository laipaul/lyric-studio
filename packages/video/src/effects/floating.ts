// The line drifts in from below and then floats gently (a slow seeded sway, never the same on two
// lines, always the same on the same line).
import type { LyricEffect } from "./types";

const PERIOD_SECONDS = 4.5;
export const floatAmplitudePx = (a: number) => 7 * a;

export const floating: LyricEffect = {
  name: "floating",
  label: "Floating",
  description: "drifts in from below, then floats gently",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 700, easing: "ease-out" },
  enter: (p, a) => ({ opacity: p, y: 26 * a * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, y: -18 * a * q }),
  hold: (frame, a, seed, fps) => {
    const t = (2 * Math.PI * frame) / (PERIOD_SECONDS * fps);
    return { y: floatAmplitudePx(a) * Math.sin(t + seed), x: floatAmplitudePx(a) * 0.5 * Math.sin(0.7 * t + seed * 1.7) };
  },
};
