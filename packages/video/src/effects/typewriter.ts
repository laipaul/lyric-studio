// Letters typed in word by word, each word complete when it is sung.
import { clamp01, type LyricEffect } from "./types";

export const TYPE_FRAMES = 6; // a word takes 0.2 s to type (less if the words come faster)

export const typewriter: LyricEffect = {
  name: "typewriter",
  label: "Typewriter",
  description: "letters typed in, each word complete when it is sung",
  unit: "word",
  transition: "swap",
  defaults: { durationMs: 300, easing: "linear" },
  enter: (p) => ({ opacity: p }),
  exit: (q) => ({ opacity: 1 - q }),
  word: (frame, w) => ({ chars: clamp01((frame - (w.startFrame - TYPE_FRAMES)) / TYPE_FRAMES) }),
};
