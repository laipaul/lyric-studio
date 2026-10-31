// Canva's "Spread" (31 Oct 2026, asked by the user: "really spread the words like floating in the air and
// expand"): the letters float in from wide apart, drawing together as the line settles (from a little
// below, out of a soft blur); while it is on screen it floats gently; on the way out the letters drift
// apart again and float up as the line fades. The wide spacing only happens while the line is faint
// (it is at most a quarter of its widest when the line is half visible), so at rest the line keeps its
// laid-out width inside the safe zones.
import type { LyricEffect } from "./types";

export const SPREAD_FROM_EM = 0.32; // extra letter spacing (em) at the start and the end (balanced)

export const spread: LyricEffect = {
  name: "spread",
  label: "Spread",
  description: "letters float in from wide apart and drift apart again as the line leaves",
  unit: "line",
  transition: "swap",
  exitLed: true,
  defaults: { durationMs: 1200, easing: "ease-out" },
  enter: (p, amount) => ({ opacity: p, spacing: SPREAD_FROM_EM * Math.min(1.25, amount) * (1 - p) ** 2, y: 18 * amount * (1 - p), blur: 2.5 * amount * (1 - p) }),
  exit: (q, amount) => ({ opacity: 1 - q, spacing: SPREAD_FROM_EM * Math.min(1.25, amount) * q ** 2, y: -22 * amount * q, blur: 2.5 * amount * q }),
  hold: (frame, amount, seed, fps) => ({ y: 4 * amount * Math.sin((frame / fps) * 1.1 + seed) }),
};
