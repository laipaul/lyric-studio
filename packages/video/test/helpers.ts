import type { Beat } from "../src";

// A steady beat grid: `count` beats at `bpm`, starting at `startMs`; the first downbeat is at beat
// index `firstDownbeat` (beats before it are a pickup).
export function grid(bpm: number, count: number, startMs = 500, firstDownbeat = 0): Beat[] {
  const period = 60_000 / bpm;
  return Array.from({ length: count }, (_, i) => ({
    time_ms: Math.round(startMs + i * period),
    strength: i % 4 === firstDownbeat % 4 ? 1 : 0.5,
    is_downbeat: i >= firstDownbeat && (i - firstDownbeat) % 4 === 0,
  }));
}

export const frameOf = (ms: number) => Math.round((ms * 30) / 1000);
