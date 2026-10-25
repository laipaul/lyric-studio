// Word by word on the voice: each word rises in and brightens just before it is sung (settled on
// its word time); words still to come wait faintly (subtle) or are hidden (expressive).
import { clamp01, EASINGS, type LyricEffect } from "./types";

export const REVEAL_FRAMES = 6; // 0.2 s
export const waitingOpacity = (a: number) => clamp01(0.45 - 0.3 * a); // subtle 0.27, balanced 0.15, expressive 0

export const wordReveal: LyricEffect = {
  name: "word-reveal",
  label: "Word reveal",
  description: "each word rises in on the voice (word timings from pnpm align)",
  unit: "word",
  transition: "inherit",
  defaults: { durationMs: 500, easing: "ease-out" },
  word: (frame, w, a) => {
    const p = EASINGS["ease-out"](clamp01((frame - (w.startFrame - REVEAL_FRAMES)) / REVEAL_FRAMES));
    const from = waitingOpacity(a);
    return { opacity: from + (1 - from) * p, y: 14 * a * (1 - p), blur: 1.5 * a * (1 - p) };
  },
};
