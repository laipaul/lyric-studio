// Slow film-title fade: the old line fades away, then the new one fades in while settling from a
// slightly larger size.
import type { LyricEffect } from "./types";

export const cinematicFade: LyricEffect = {
  name: "cinematic-fade",
  label: "Cinematic fade",
  description: "slow fade out, then a slow fade in settling from slightly larger",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 1100, easing: "ease-in-out" },
  // Clearly seen (31 Oct 2026: "it doesn't work" at 4%): settles from 12% larger with its letters drawing
  // together, and leaves growing gently.
  enter: (p, a) => ({ opacity: p, scale: 1 + 0.12 * a * (1 - p), spacing: 0.06 * a * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, scale: 1 + 0.05 * a * q }),
};
