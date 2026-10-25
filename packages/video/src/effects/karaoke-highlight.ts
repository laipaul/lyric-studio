// The word being sung lights up in the brand accent colour (and lifts a touch); it goes back to the
// lyric colour when the next word starts.
import { clamp01, type LyricEffect } from "./types";

export const KARAOKE_IN_FRAMES = 2;
export const KARAOKE_OUT_FRAMES = 4;

export const karaokeHighlight: LyricEffect = {
  name: "karaoke-highlight",
  label: "Karaoke highlight",
  description: "the word being sung lights up in the brand accent colour",
  unit: "word",
  transition: "inherit",
  defaults: { durationMs: 500, easing: "ease-in-out" },
  word: (frame, w, a) => {
    const on = Math.min(clamp01((frame - (w.startFrame - KARAOKE_IN_FRAMES)) / KARAOKE_IN_FRAMES), clamp01((w.endFrame + KARAOKE_OUT_FRAMES - frame) / KARAOKE_OUT_FRAMES));
    return { accent: on, scale: 1 + 0.04 * a * on, y: -3 * a * on };
  },
};
