// Letters gathered close together open up to their normal spacing as the line fades in (Canva's
// "Spread"); on the way out they gather again as the line fades. Spacing only ever tightens (never
// wider than the laid-out line), so a line stays inside its area and the safe zones.
import type { LyricEffect } from "./types";

export const SPREAD_FROM_EM = -0.12; // letter spacing at the start (balanced); the line opens to 0

export const spread: LyricEffect = {
  name: "spread",
  label: "Spread",
  description: "letters open up to their spacing as the line fades in",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 700, easing: "ease-out" },
  enter: (p, amount) => ({ opacity: Math.min(1, p * 1.4), spacing: SPREAD_FROM_EM * Math.min(1.25, amount) * (1 - p) }),
  exit: (q, amount) => ({ opacity: 1 - q, spacing: SPREAD_FROM_EM * 0.4 * Math.min(1.25, amount) * q }),
};
