// Geometry of the YouTube cover layout (shared by the composition and "pnpm make").
import type { Format } from "./platform";

export const COVER_CENTRE_X = 0.235; // the cover's centre, as a fraction of the width
export const COVER_HEIGHT_SHARE = 0.672; // the cover's side, as a fraction of the height (0.6 + 12%)
export const COVER_LYRICS_LEFT = 0.44; // lyrics start right of the cover (also at its largest zoom)
export const COVER_TEXT_SCALE = 1.18; // the active lyric line in the cover layout (+18%)
export const COVER_NEXT_LINE_SCALE = 0.55 * (1.1 / 1.18); // the next line: +10% compared with before
export const COVER_DRIFT = 0.018; // the cover drifts by up to this share of its side over the song
export const PARALLAX = 0.3; // the background moves 30% as much as the cover, the opposite way

export function coverSide(format: Format): number {
  return Math.round(format.height * COVER_HEIGHT_SHARE);
}
