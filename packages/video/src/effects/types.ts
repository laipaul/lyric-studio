// Lyric effects: how lyric lines (and their words) come in, stay and go. Each effect is a module
// registered in ./index.ts. Everything is a pure function of the frame number (Remotion's
// interpolate / Easing, no timers), so preview, render and tests give identical results.
import { Easing } from "remotion";

export type Intensity = "subtle" | "balanced" | "expressive";
export const INTENSITIES: readonly Intensity[] = ["subtle", "balanced", "expressive"];
// How strongly an effect moves, blurs or glows: subtle = 0.6x, balanced = 1x, expressive = 1.5x.
export const AMOUNT: Record<Intensity, number> = { subtle: 0.6, balanced: 1, expressive: 1.5 };

export type EasingName = "ease-in-out" | "ease-out" | "ease-in" | "linear";
export const EASINGS: Record<EasingName, (t: number) => number> = {
  "ease-in-out": Easing.bezier(0.42, 0, 0.58, 1), // CSS ease-in-out
  "ease-out": Easing.bezier(0, 0, 0.58, 1),
  "ease-in": Easing.bezier(0.42, 0, 1, 1),
  linear: (t) => t,
};

// What the user picks (brand.json motion, platforms.json motion, --line-effect / --hook-effect).
export type EffectChoice = { name: string; intensity: Intensity; durationMs?: number; easing?: EasingName };

// The look of a whole line. y / x in px (added to its resting place), blur in px, glow 0-1.
export type LineLook = { opacity: number; x: number; y: number; scale: number; blur: number; glow: number };
export const REST: LineLook = { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, glow: 0 };

// The look of one word: chars = share of its letters shown (typewriter), accent = 0-1 mix towards
// the brand accent colour (karaoke).
export type WordLook = { opacity: number; y: number; blur: number; accent: number; scale: number; chars: number };
export const WORD_REST: WordLook = { opacity: 1, y: 0, blur: 0, accent: 0, scale: 1, chars: 1 };

// A word's sung time in composition frames (from the aligned LRC, or spread over the line).
export type WordTiming = { startFrame: number; endFrame: number };

// "glide": lines scroll (the next line waits small underneath and rises into place); "swap": the old
// line goes, then the new one comes in the same place; "inherit": a word effect that moves its lines
// like the verse effect does.
export type Transition = "glide" | "swap" | "inherit";

export type LyricEffect = {
  name: string;
  label: string;
  description: string;
  unit: "line" | "word";
  transition: Transition;
  defaults: { durationMs: number; easing: EasingName };
  // p goes 0 -> 1 (eased) while the line comes in; q 0 -> 1 while it goes. Return the line's look.
  enter?: (p: number, amount: number) => Partial<LineLook>;
  exit?: (q: number, amount: number) => Partial<LineLook>;
  // Added on every visible frame (a continuous function of the frame, so it never jumps).
  hold?: (frame: number, amount: number, seed: number, fps: number) => Partial<LineLook>;
  word?: (frame: number, word: WordTiming, amount: number, fps: number) => Partial<WordLook>;
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
