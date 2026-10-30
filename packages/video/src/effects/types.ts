// Lyric effects: how lyric lines (and their words) come in, stay and go. Each effect is a module
// registered in ./index.ts. Everything is a pure function of the frame number (Remotion's
// interpolate / Easing, no timers), so preview, render and tests give identical results.
import { Easing } from "remotion";

import type { EasingName, EffectChoice, Intensity } from "./names";

export type { EasingName, EffectChoice, Intensity };
// How strongly an effect moves, blurs or glows: subtle = 0.6x, balanced = 1x, expressive = 1.5x.
export const AMOUNT: Record<Intensity, number> = { subtle: 0.6, balanced: 1, expressive: 1.5 };

export const EASINGS: Record<EasingName, (t: number) => number> = {
  "ease-in-out": Easing.bezier(0.42, 0, 0.58, 1), // CSS ease-in-out
  "ease-out": Easing.bezier(0, 0, 0.58, 1),
  "ease-in": Easing.bezier(0.42, 0, 1, 1),
  linear: (t) => t,
};


// The look of a whole line. y / x in px (added to its resting place), blur in px, glow 0-1, spacing =
// letter spacing in em added to the font's own (spread), chars = share of its letters shown (title cards
// typed in; lyric lines type per word, see WordLook).
// wave = ascend's letter wave (0 -> 1: letters rise into place one after another), reveal = ink's reveal
// (share of the line's letters uncovered, left to right, with a soft edge).
export type LineLook = { opacity: number; x: number; y: number; scale: number; blur: number; glow: number; spacing?: number; chars?: number; wave?: number; reveal?: number };
export const REST: LineLook = { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, glow: 0 };

// The look of one word: chars = share of its letters shown (typewriter), accent = 0-1 mix towards
// the brand accent colour (karaoke), cursor = the typing cursor after this word's shown letters (0-1).
export type WordLook = { opacity: number; y: number; blur: number; accent: number; scale: number; chars: number; cursor?: number };
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
  // A typewriter that types the whole line letter by letter (src/effects/typing.ts) instead of word():
  // exit "fade" (the line fades out) or "erase" (letters removed right to left).
  typing?: { exit: "fade" | "erase" };
  // Ink (src/effects/ink.ts): the line is uncovered left to right in time with the singing (like the typewriter's pace).
  reveal?: true;
  // How far the effect moves parts of a line beyond its enter / exit / hold looks (px, x the amount), for QA.
  reach?: (amount: number) => { up?: number; down?: number };
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
