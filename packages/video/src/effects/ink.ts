// The line flows in from left to right behind a soft-edged reveal, like ink being written, in time with
// the singing (the typewriter's pace: every word uncovered by the time it is sung), row after row; it
// fades out. Made for script fonts, where letters typed one by one look odd.
import type { LyricEffect } from "./types";

export const INK_EDGE_EM = 1.2; // the soft edge of the reveal

export const ink: LyricEffect = {
  name: "ink",
  label: "Ink",
  description: "flows in left to right like ink, in time with the singing",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 300, easing: "linear" },
  enter: (p) => ({ opacity: p }),
  exit: (q) => ({ opacity: 1 - q }),
  reveal: true,
};

// A CSS mask uncovering `share` (0-1) of a row of text, left to right, with a soft edge.
export function inkMask(share: number): string | undefined {
  if (share >= 1) return undefined;
  const edge = 12; // % of the row
  const at = share * (100 + edge);
  return `linear-gradient(90deg, #000 ${(at - edge).toFixed(2)}%, transparent ${at.toFixed(2)}%)`;
}
