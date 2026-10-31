// The viewer's transport bar (Shape page): where "back one bar" / "forward one bar" land. Steps go from
// bar line to bar line, so every stop is a place where a cut can fall. Pure, so the studio and the tests
// share it.

// While playing, a press just after a bar line (within this many frames) goes to the bar before it, like a
// player's "previous track"; paused, back always goes to the bar line just passed.
export const BACK_GRACE_FRAMES = 3;

// The frame to jump to from `frame`: the next bar line after it (forward) or the one before it (back);
// past the last bar line, forward goes to the video's last frame; before the first, back goes to 0.
export function stepToBar(o: { frame: number; barFrames: number[]; durationInFrames: number; dir: 1 | -1; playing?: boolean }): number {
  const last = Math.max(0, o.durationInFrames - 1);
  const bars = [...new Set(o.barFrames.map((b) => Math.round(b)))].filter((b) => b >= 0 && b <= last).sort((a, b) => a - b);
  if (o.dir === 1) return bars.find((b) => b > o.frame) ?? last;
  const before = bars.filter((b) => b < o.frame - (o.playing ? BACK_GRACE_FRAMES : 0));
  return before.length ? before[before.length - 1] : 0;
}

// One frame back or forward, inside the video.
export function stepFrame(frame: number, durationInFrames: number, dir: 1 | -1): number {
  return Math.max(0, Math.min(Math.max(0, durationInFrames - 1), frame + dir));
}
