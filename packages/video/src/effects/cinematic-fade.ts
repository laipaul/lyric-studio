// Slow film-title fade: the old line fades away, then the new one fades in while settling from a
// slightly larger size.
import type { LyricEffect } from "./types";

export const cinematicFade: LyricEffect = {
  name: "cinematic-fade",
  label: "Cinematic fade",
  description: "slow fade out, then a slow fade in settling from slightly larger",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 900, easing: "ease-in-out" },
  enter: (p, a) => ({ opacity: p, scale: 1 + 0.04 * a * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, scale: 1 - 0.02 * a * q }),
};
