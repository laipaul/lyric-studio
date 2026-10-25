// Geometry of the YouTube cover layout (shared by the composition and "pnpm make").
import type { Format } from "./platform";

export const COVER_CENTRE_X = 0.22; // the cover's centre, as a fraction of the width
export const COVER_HEIGHT_SHARE = 0.6; // the cover's side, as a fraction of the height
export const COVER_LYRICS_LEFT = 0.43; // lyrics start right of the cover

export function coverSide(format: Format): number {
  return Math.round(format.height * COVER_HEIGHT_SHARE);
}
