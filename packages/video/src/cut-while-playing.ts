// "Cut while it plays" (27 Nov 2026, Paul: "build it now", after asking how pros work): like a music-video editor's
// multicam, the song plays and only the current moment's options show under it; a click puts one in. Two passes:
// Singer (each sung line: singing takes and music-video shots, in time) and Story (each planned shot: its takes).
// Pure: the moments of a pass, the moment at a song time, and where a clip should be at that song time.

export type Moment = { key: string; fromMs: number; toMs: number; label: string; text: string | null; line: number | null; slot: string | null };

const TAIL_MS = 2000; // the last moment runs this long past its end when the song length is not known

// Singer pass: one moment per timed sung line, from its start to the next line's start.
export function singerMoments(lines: readonly { number: number; text: string; startMs: number | null; sungEndMs: number | null }[], songMs: number | null): Moment[] {
  const timed = lines.filter((l): l is typeof l & { startMs: number } => typeof l.startMs === "number").sort((a, b) => a.startMs - b.startMs);
  return timed.map((l, i) => ({
    key: `line-${l.number}`,
    fromMs: l.startMs,
    toMs: timed[i + 1]?.startMs ?? songMs ?? (l.sungEndMs ?? l.startMs) + TAIL_MS,
    label: `Line ${l.number}`,
    text: l.text,
    line: l.number,
    slot: null,
  }));
}

// Story pass: one moment per planned shot with its time on the song.
export function storyMoments(shots: readonly { id: string; number: number; line: number | null; lineText: string | null; span?: { startMs: number; endMs: number } | null }[]): Moment[] {
  return shots
    .filter((s): s is typeof s & { span: { startMs: number; endMs: number } } => !!s.span && s.span.endMs > s.span.startMs)
    .sort((a, b) => a.span.startMs - b.span.startMs)
    .map((s) => ({ key: `shot-${s.id}`, fromMs: s.span.startMs, toMs: s.span.endMs, label: `Shot ${s.number}`, text: s.lineText, line: s.line, slot: s.id }));
}

// The moment playing at a song time: the last one started by then (the first before it starts); -1 when none.
export function momentAt(moments: readonly Moment[], ms: number): number {
  if (!moments.length) return -1;
  let lo = 0;
  let hi = moments.length - 1;
  if (ms < moments[0].fromMs) return 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (moments[mid].fromMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Where a clip should be (seconds into it) at a song time. A clip locked to the song (a singing take, a music video:
// startSongMs = the song time of its first frame) follows the song exactly; any other clip plays from the moment's
// start and loops over its own length.
export function clipTimeAt(songMs: number, startSongMs: number | null, momentFromMs: number, durationS: number | null): number {
  if (startSongMs !== null) return Math.max(0, (songMs - startSongMs) / 1000);
  const t = Math.max(0, (songMs - momentFromMs) / 1000);
  return durationS && durationS > 0 ? t % durationS : t;
}
