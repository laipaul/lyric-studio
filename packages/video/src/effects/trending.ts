// The trending effects (31 Oct 2026): what Reels, TikTok and lyric videos use now. All pure functions of
// the frame like every effect; the composition (LyricScene) draws the new parts of a look:
//   rise   mask reveal: the share of the line still hidden below its own bottom edge (it slides up into view)
//   tiltX / tiltY   3D: the line's rotation in degrees (with perspective)
//   split  glitch: the red / cyan copies' offset (px), drawn as text shadows
//   echo   echo stack: 0-1, the faint copies stacked under the line (0 = none)
//   ripple wave: the letters' wave phase (radians); rippleAmp its height (px)
//   slice  slice: the line cut in two, the halves pushed apart sideways (px)
import { clamp01, type LyricEffect } from "./types";

// A small deterministic jitter (no Math.random: preview and render must agree).
const jitter = (k: number) => {
  const x = Math.sin(k * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

// Word pop: each word bounces in on the sung word (the CapCut caption look); words still to come wait
// faintly (subtle, balanced) or hidden (expressive).
export const POP_FRAMES = 7;
export const wordPop: LyricEffect = {
  name: "word-pop",
  label: "Word pop",
  description: "each word bounces in as it is sung",
  unit: "word",
  transition: "inherit",
  defaults: { durationMs: 450, easing: "ease-out" },
  word: (frame, w, a) => {
    // Lands on the word: complete (fully readable) by its sung time, the bounce settling just after.
    const s = clamp01((frame - (w.startFrame - 4)) / POP_FRAMES);
    const floor = a >= 1.5 ? 0 : 0.28;
    if (s <= 0) return { opacity: floor, scale: 0.8 };
    return { opacity: floor + (1 - floor) * Math.min(1, s * 2), scale: 0.8 + 0.2 * s + 0.16 * a * Math.sin(Math.PI * s), y: -4 * a * Math.sin(Math.PI * s) };
  },
};

// Highlight sweep: the line waits in the text colour and fills with the accent colour word by word as it is sung; the
// sung words stay lit.
export const highlightSweep: LyricEffect = {
  name: "highlight-sweep",
  label: "Highlight sweep",
  description: "the line fills with the accent colour word by word, and stays lit",
  unit: "word",
  transition: "inherit",
  defaults: { durationMs: 500, easing: "ease-in-out" },
  word: (frame, w, a) => {
    const on = clamp01((frame - (w.startFrame - 1)) / 3);
    return { accent: on, scale: 1 + 0.02 * a * on * clamp01((w.endFrame - frame) / 4) };
  },
};

// Mask reveal: the line slides up from behind an invisible edge (its own bottom) and slides back down.
export const maskReveal: LyricEffect = {
  name: "mask-reveal",
  label: "Mask reveal",
  description: "the line slides up from behind an invisible edge",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 550, easing: "ease-out" },
  enter: (p) => ({ opacity: p, rise: 1 - p }),
  exit: (q) => ({ opacity: 1 - q, rise: q }),
};

// 3D tilt: the line swings in on its horizontal axis, then floats with a slight perspective sway.
export const tilt3d: LyricEffect = {
  name: "tilt-3d",
  label: "3D tilt",
  description: "the words swing in and float with a slight 3D perspective",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 650, easing: "ease-out" },
  enter: (p, a) => ({ opacity: p, tiltX: 55 * a * (1 - p), y: 24 * a * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, tiltX: -45 * a * q, y: -18 * a * q }),
  hold: (frame, a, seed, fps) => ({ tiltY: 7 * a * Math.sin((frame / fps) * 0.9 + seed), tiltX: 3 * a * Math.sin((frame / fps) * 0.6 + seed * 1.7) }),
  reach: (a) => ({ up: 30 * a, down: 30 * a }),
};

// Glitch: the line lands with a short red / cyan split and jitter, and glitches again for a moment
// every few seconds while it is on screen.
export const glitch: LyricEffect = {
  name: "glitch",
  label: "Glitch",
  description: "a quick colour-split jitter as the line lands",
  jumpy: true,
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 400, easing: "linear" },
  enter: (p, a) => ({ opacity: p, split: 16 * a * (1 - p), x: 10 * a * (1 - p) * jitter(Math.round(p * 12)) }),
  exit: (q, a) => ({ opacity: 1 - q, split: 16 * a * q, x: 10 * a * q * jitter(Math.round(q * 12) + 7) }),
  hold: (frame, a, seed, fps) => {
    const period = Math.round(fps * 2.6);
    const k = (frame + Math.round(seed * 10)) % period;
    if (k > 3) return {};
    return { split: 7 * a, x: 5 * a * jitter(frame) };
  },
};

// Wave: the letters ripple gently, a wave running along the line while it is on screen.
export const wave: LyricEffect = {
  name: "wave",
  label: "Wave",
  description: "the letters ripple in a gentle wave",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 500, easing: "ease-in-out" },
  enter: (p) => ({ opacity: p }),
  exit: (q) => ({ opacity: 1 - q }),
  hold: (frame, a, _seed, fps) => ({ ripple: (frame / fps) * 5, rippleAmp: 7 * a }),
  reach: (a) => ({ up: 7 * a, down: 7 * a }),
};

// Echo stack: the line comes in out of faint copies stacked under it, which stay softly while it is on screen.
export const echoStack: LyricEffect = {
  name: "echo-stack",
  label: "Echo stack",
  description: "faint copies of the line stack under it",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 600, easing: "ease-out" },
  enter: (p, a) => ({ opacity: p, echo: Math.min(1, 0.45 * a + (1 - p) * 0.55) }),
  exit: (q, a) => ({ opacity: 1 - q, echo: Math.min(1, 0.45 * a + q * 0.55) }),
  hold: (_f, a) => ({ echo: Math.min(1, 0.45 * a) }),
  reach: (a) => ({ down: 140 * Math.min(1, 0.45 * a + 0.55) }),
};

// Slice: the line arrives cut in two, the halves sliding together; it leaves the same way.
export const slice: LyricEffect = {
  name: "slice",
  label: "Slice",
  description: "the line is cut in two and snaps back together",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 500, easing: "ease-out" },
  enter: (p, a) => ({ opacity: p, slice: 60 * a * (1 - p) }),
  exit: (q, a) => ({ opacity: 1 - q, slice: 60 * a * q }),
};

// Kinetic stack: one or two big words at a time, stacked and sized for emphasis, in time with the voice
// (LyricScene draws the groups; see kineticGroups). Lines move like a plain swap.
export const kineticStack: LyricEffect = {
  name: "kinetic-stack",
  label: "Kinetic stack",
  description: "one or two big words at a time, stacked",
  unit: "word",
  transition: "swap",
  defaults: { durationMs: 500, easing: "ease-out" },
  enter: (p) => ({ opacity: p }),
  exit: (q) => ({ opacity: 1 - q }),
  kinetic: true,
  reach: () => ({ up: 70, down: 70 }), // two big rows instead of the line
};

export const TRENDING = [wordPop, highlightSweep, maskReveal, tilt3d, glitch, wave, echoStack, slice, kineticStack];

// Kinetic stack: the line's words in groups of one or two (a long word stands alone), each group shown
// from its first word's time until the next group's. Returns the group index on screen at `frame`.
export function kineticGroups(words: readonly string[]): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < words.length; ) {
    const a = words[i];
    const b = words[i + 1];
    if (b !== undefined && [...a].length + [...b].length <= 11 && [...a].length <= 7 && [...b].length <= 7) {
      groups.push([i, i + 1]);
      i += 2;
    } else {
      groups.push([i]);
      i += 1;
    }
  }
  return groups;
}
export function kineticAt(groups: readonly number[][], starts: readonly number[], frame: number): { group: number; pop: number } {
  let g = 0;
  for (let k = 0; k < groups.length; k++) if (frame >= (starts[groups[k][0]] ?? 0) - 2) g = k;
  const pop = clamp01((frame - ((starts[groups[g][0]] ?? 0) - 2)) / 6);
  return { group: g, pop };
}
