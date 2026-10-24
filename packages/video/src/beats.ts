// Beats as produced by the audio analysis (services/audio).
export type Beat = {
  time_ms: number;
  strength: number;
  is_downbeat: boolean;
};

export const BEATS_PER_BAR = 4;

// Index of the first beat that starts a bar, or 0 if no downbeats are marked.
export function downbeatPhase(beats: readonly Beat[]): number {
  const first = beats.findIndex((b) => b.is_downbeat);
  return first < 0 ? 0 : first % BEATS_PER_BAR;
}

// Shifts which beat counts as bar 1: offset N (0-3) means bars start N beats later than detected.
export function applyDownbeatOffset(beats: readonly Beat[], offset: number): Beat[] {
  if (!Number.isInteger(offset) || offset < 0 || offset > 3) {
    throw new Error(`downbeat offset must be 0, 1, 2 or 3 (got ${offset})`);
  }
  const phase = (downbeatPhase(beats) + offset) % BEATS_PER_BAR;
  return beats.map((b, i) => ({ ...b, is_downbeat: i >= phase && (i - phase) % BEATS_PER_BAR === 0 }));
}

// Bar number (1-based, counted from the first downbeat of the song; 0 = pickup before bar 1)
// and position in the bar (1-4).
export function barPosition(beats: readonly Beat[], index: number): { bar: number; beatInBar: number } {
  const phase = downbeatPhase(beats);
  const fromBar1 = index - phase;
  if (fromBar1 < 0) return { bar: 0, beatInBar: BEATS_PER_BAR + fromBar1 + 1 };
  return { bar: Math.floor(fromBar1 / BEATS_PER_BAR) + 1, beatInBar: (fromBar1 % BEATS_PER_BAR) + 1 };
}
