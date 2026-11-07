// The Shape page's timeline clock (7 Nov 2026, asked by the user): a time ruler in minutes:seconds, a time
// bubble on the playhead, and the time in the song next to the time in the video, so a moment in the preview
// can be compared with the Lyrics tab and `pnpm lyrics:check-start` (which use song times). Pure, so the
// studio and the tests share it.

// "1:02.6": minutes, seconds and tenths (floored, so the clock never runs ahead of the frame shown).
export function clockTenths(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100)); // tenths of a second
  const s = Math.floor(t / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${t % 10}`;
}

// "1:02" (whole seconds), or "1:02.5" for a tick between seconds.
export function clockTick(ms: number): string {
  const whole = ms % 1000 === 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}${whole ? "" : `.${Math.floor((ms % 1000) / 100)}`}`;
}

// The video's audio is the song cut to the section, so a moment in the video is the section's start plus it.
export function songTimeMs(videoMs: number, sectionStartMs: number): number {
  return Math.max(0, sectionStartMs) + Math.max(0, videoMs);
}

export type TimeTick = { ms: number; label: string | null };

// The ruler's ticks for a timeline of `durationMs` at `pxPerSecond`: a label at least ~70 px apart (every 2 s at
// 40 px/s, every second at 80, every half second at 160) and an unlabelled tick in between.
export function timeTicks(durationMs: number, pxPerSecond: number): TimeTick[] {
  const labelEveryMs = [500, 1000, 2000, 5000, 10_000].find((ms) => (ms / 1000) * pxPerSecond >= 70) ?? 10_000;
  const tickMs = labelEveryMs / 2;
  const out: TimeTick[] = [];
  for (let ms = 0; ms <= durationMs; ms += tickMs) out.push({ ms, label: ms % labelEveryMs === 0 ? clockTick(ms) : null });
  return out;
}

// The playhead's bubble: "0:28.4 · song 1:02.6" (the song part left out when the video starts at the song's start).
export function playheadLabel(videoMs: number, sectionStartMs: number): { video: string; song: string | null } {
  return { video: clockTenths(videoMs), song: sectionStartMs > 0 ? clockTenths(songTimeMs(videoMs, sectionStartMs)) : null };
}

// The Lyrics tab's "part of the song" (7 Nov 2026): which lines a planned video shows and when, from that
// video's own plan (the storyboard's lines carry the Lyrics tab's numbers). `first`: the first line it shows.
export function linesInVideo(lines: readonly { number: number | null; startMs: number }[]): { at: Map<number, number>; first: number | null } {
  const at = new Map<number, number>();
  for (const l of lines) if (l.number !== null && !at.has(l.number)) at.set(l.number, l.startMs);
  const first = at.size ? Math.min(...at.keys()) : null;
  return { at, first };
}
