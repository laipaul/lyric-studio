// Directional effects (31 Oct 2026, asked by the user: "word rising, slide right or left or down"):
//   word-rise    each word rises clearly from below into place as it is sung (hidden until then)
//   slide-left   the line slides in from the left and leaves to the right
//   slide-right  the line slides in from the right and leaves to the left
//   slide-down   the line drops in from above and leaves downwards
// The far-off start is only while the line is faint, so it is in place (and readable) by its time.
import { clamp01, EASINGS, type LyricEffect } from "./types";

export const SLIDE_PX = 160; // at 1080 wide (balanced)
export const RISE_WORD_FRAMES = 9; // 0.3 s

export const wordRise: LyricEffect = {
  name: "word-rise",
  label: "Word rise",
  description: "each word rises up into place as it is sung",
  unit: "word",
  transition: "inherit",
  defaults: { durationMs: 500, easing: "ease-out" },
  word: (frame, w, a) => {
    const p = EASINGS["ease-out"](clamp01((frame - (w.startFrame - RISE_WORD_FRAMES)) / RISE_WORD_FRAMES));
    return { opacity: p, y: 46 * a * (1 - p) };
  },
};

const slide = (name: string, label: string, description: string, dx: number, dy: number): LyricEffect => ({
  name,
  label,
  description,
  unit: "line",
  transition: "swap",
  slides: true,
  defaults: { durationMs: 600, easing: "ease-out" },
  enter: (p, a) => ({ opacity: p, x: dx * SLIDE_PX * a * (1 - p), y: dy * 0.5 * SLIDE_PX * a * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, x: -dx * 0.6 * SLIDE_PX * a * q, y: -dy * 0.3 * SLIDE_PX * a * q }),
});

export const slideLeft = slide("slide-left", "Slide in from left", "the line slides in from the left", -1, 0);
export const slideRight = slide("slide-right", "Slide in from right", "the line slides in from the right", 1, 0);
export const slideDown = slide("slide-down", "Slide down", "the line drops in from above", 0, -1);

// Dissolve (asked by the user: "word dissolve like thin air"): the line gathers out of a fine mist as it
// comes in, and when it ends its letters drift apart and upwards, blurring and fading into thin air, left
// to right. Drawn letter by letter by LyricScene (look.dust).
export const dissolve: LyricEffect = {
  name: "dissolve",
  label: "Dissolve",
  description: "the letters dissolve into thin air as the line ends",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 900, easing: "ease-in-out" },
  enter: (p) => ({ opacity: p, dust: 0.35 * (1 - p) }),
  exit: (q) => ({ opacity: 1 - q * q, dust: q }),
  reach: (a) => ({ up: 70 * a }),
};

export const SLIDES = [wordRise, slideLeft, slideRight, slideDown, dissolve];

// One letter of a dissolving line: k of n letters, dust 0-1, x the amount. Letters go one after another
// (left first), each drifting up and sideways by its own deterministic amount, blurring and fading.
export function dustLetter(k: number, n: number, dust: number, a = 1): { x: number; y: number; blur: number; opacity: number } {
  const start = n > 1 ? (k / (n - 1)) * 0.5 : 0; // the first letter starts at once, the last half-way
  const t = clamp01((dust - start) / 0.5);
  if (t <= 0) return { x: 0, y: 0, blur: 0, opacity: 1 };
  const r1 = Math.sin(k * 12.9898 + 4.1) * 43758.5453;
  const r2 = Math.sin(k * 78.233 + 1.7) * 12345.6789;
  const jx = (r1 - Math.floor(r1)) * 2 - 1;
  const jy = r2 - Math.floor(r2);
  const e = t * t;
  return { x: jx * 46 * a * e, y: -(24 + 50 * jy) * a * e, blur: 9 * e, opacity: 1 - t };
}
