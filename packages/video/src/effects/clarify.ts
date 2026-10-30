// Each word pulls into focus as it is sung, like a camera finding focus: words still to come wait softly
// blurred and dim, and sharpen in the 0.27 s before their word time (settled when sung).
import { clamp01, EASINGS, type LyricEffect } from "./types";

export const CLARIFY_FRAMES = 8;
export const CLARIFY_BLUR_PX = 4; // x the amount, at most 5 px

export const clarify: LyricEffect = {
  name: "clarify",
  label: "Clarify",
  description: "each word pulls into focus (blur to sharp) as it is sung",
  unit: "word",
  transition: "inherit",
  defaults: { durationMs: 600, easing: "ease-out" },
  word: (frame, w, a) => {
    const p = EASINGS["ease-out"](clamp01((frame - (w.startFrame - CLARIFY_FRAMES)) / CLARIFY_FRAMES));
    return { opacity: 0.35 + 0.65 * p, blur: Math.min(5, CLARIFY_BLUR_PX * a) * (1 - p) };
  },
};
