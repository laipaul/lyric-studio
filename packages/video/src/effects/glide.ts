// Apple Music / Spotify style scroll: the active line moves up and fades out, the next line (waiting
// small underneath) rises into place while growing to full size and brightness, the line after it
// fades in below. The geometry is done by the scene (../scene.ts); this module only sets the timing.
import type { LyricEffect } from "./types";

export const GLIDE_LIFT_PX = 40; // how far the old line moves up (balanced)

export const glide: LyricEffect = {
  name: "glide",
  label: "Glide",
  description: "lines scroll up like Apple Music / Spotify: the next line rises into place",
  unit: "line",
  transition: "glide",
  defaults: { durationMs: 500, easing: "ease-in-out" },
  // Before a pause (nothing follows straight away): fade out while drifting up a little.
  exit: (q, a) => ({ opacity: 1 - q, y: -GLIDE_LIFT_PX * 0.5 * a * q }),
};
