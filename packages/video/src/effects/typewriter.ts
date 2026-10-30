// Typewriters. The intensity is the typing pace: subtle = calm (~8 letters/s), balanced (~14), expressive =
// quick (~21); never behind the singer. "typewriter": the line is typed letter by letter at a steady pace, in time with the song
// (every word fully typed when it is sung; src/effects/typing.ts), with a thin cursor; it fades out.
// "typewriter-erase": the same, leaving by erasing its letters right to left. "typewriter-words": each
// word typed in quickly just before it is sung (the first typewriter).
import { clamp01, type LyricEffect } from "./types";

export const TYPE_FRAMES = 6; // typewriter-words: a word takes 0.2 s to type (less if the words come faster)

export const typewriter: LyricEffect = {
  name: "typewriter",
  label: "Typewriter",
  description: "typed letter by letter in time with the singing, with a cursor",
  unit: "word",
  transition: "swap",
  defaults: { durationMs: 300, easing: "linear" },
  enter: (p) => ({ opacity: p }), // the cursor fades in; the letters appear as they are typed
  exit: (q) => ({ opacity: 1 - q }),
  typing: { exit: "fade" },
};

export const typewriterErase: LyricEffect = {
  ...typewriter,
  name: "typewriter-erase",
  label: "Typewriter (erase)",
  description: "typed letter by letter, then erased right to left",
  exit: (q) => ({ opacity: 1 - q }), // the letters go as they are erased while the line dims
  typing: { exit: "erase" },
};

export const typewriterWords: LyricEffect = {
  name: "typewriter-words",
  label: "Typewriter (per word)",
  description: "each word typed in just before it is sung",
  unit: "word",
  transition: "swap",
  defaults: { durationMs: 300, easing: "linear" },
  enter: (p) => ({ opacity: p }),
  exit: (q) => ({ opacity: 1 - q }),
  word: (frame, w) => ({ chars: clamp01((frame - (w.startFrame - TYPE_FRAMES)) / TYPE_FRAMES) }),
};
