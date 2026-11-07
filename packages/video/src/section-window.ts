// The Shape page's soundtrack window (7 Nov 2026, asked by the user: "keep the whole song untouched, pick when the
// soundtrack starts", like trimming the music in Canva): the whole song as a track, the video as a window on it.
// Drag the window to move it, its edges to set where it starts and ends. The start snaps to a bar; the end to a
// clean end (the first bar after a line has been sung: a musical ending beats an exact length), else a bar.
// Saved as the platform's section in song.json ("0:36.10-1:20.00"), the same as Make → "Part of the song".
// Pure, so the studio and the tests share it.

export type WindowLine = { startMs: number; sungEndMs: number | null };

export const MIN_WINDOW_MS = 3000;
const CLEAN_REACH_MS = 1500; // an end this close to a clean end snaps to it

// Clean ends: for each line, the first bar after its singing ends (a cut there never cuts a sung word).
export function cleanEnds(lines: readonly WindowLine[], downbeats: readonly number[]): number[] {
  const out = new Set<number>();
  for (const l of lines) {
    const end = l.sungEndMs ?? null;
    if (end === null) continue;
    const bar = downbeats.find((d) => d >= end);
    // ...and before the next line starts singing (else that line would be cut at its start).
    const next = lines.find((x) => x.startMs > l.startMs)?.startMs ?? Infinity;
    if (bar !== undefined && bar <= next) out.add(bar);
  }
  return [...out].sort((a, b) => a - b);
}

const nearest = (list: readonly number[], ms: number) => (list.length ? list.reduce((a, b) => (Math.abs(b - ms) < Math.abs(a - ms) ? b : a), list[0]) : ms);

// A dragged window put on the music: start on the nearest bar, end on a clean end within reach (else the
// nearest bar). free (Alt): exactly where it was let go. Never shorter than MIN_WINDOW_MS, inside the song.
export function snapWindow(
  w: { startMs: number; endMs: number },
  music: { durationMs: number; downbeats: readonly number[]; cleanEnds: readonly number[] },
  free = false,
): { startMs: number; endMs: number; clean: boolean } {
  let startMs = Math.max(0, w.startMs);
  let endMs = Math.min(music.durationMs, w.endMs);
  let clean = false;
  if (!free) {
    startMs = Math.max(0, nearest(music.downbeats, startMs));
    const c = nearest(music.cleanEnds, endMs);
    if (music.cleanEnds.length && Math.abs(c - endMs) <= CLEAN_REACH_MS) {
      endMs = c;
      clean = true;
    } else endMs = nearest(music.downbeats, endMs);
  }
  if (endMs - startMs < MIN_WINDOW_MS) endMs = Math.min(music.durationMs, startMs + MIN_WINDOW_MS);
  return { startMs: Math.round(startMs), endMs: Math.round(Math.min(music.durationMs, endMs)), clean };
}

// "0:36.10-1:20.00": the section as song.json and Make's "Part of the song" read it.
export function sectionText(startMs: number, endMs: number): string {
  const t = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, "0")}`;
  return `${t(startMs)}-${t(endMs)}`;
}

// The sung lines a window cuts (its start or end falls while the line is sung), for the warning while dragging.
export function linesCut(lines: readonly (WindowLine & { number: number })[], startMs: number, endMs: number): number[] {
  return lines.filter((l) => l.sungEndMs !== null && ((l.startMs < startMs && l.sungEndMs > startMs) || (l.startMs < endMs && l.sungEndMs > endMs))).map((l) => l.number);
}
