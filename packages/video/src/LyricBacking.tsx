// Lyric readability: the soft dark band behind the lyric area (fading out above and below). Drawn by the
// video (readability "strong", or "auto" when the clips are bright behind the lyrics) and by the Style
// tab's Look preview when the render would add it.
import type { LyricArea } from "./platform";

export function LyricBacking({ area, height }: { area: LyricArea; height: number }) {
  const half = Math.max(area.bottom - area.top, height * 0.12) * 0.75;
  const top = Math.max(0, area.centerY - half);
  const bottom = Math.min(height, area.centerY + half);
  return (
    <div
      data-lyric-backing
      style={{ position: "absolute", left: 0, right: 0, top, height: bottom - top, background: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.42) 35%, rgba(0,0,0,0.42) 65%, rgba(0,0,0,0) 100%)" }}
    />
  );
}
