// Spotify Canvas: a 3-8 s seamless loop of the strongest visual moment, no lyrics, text or audio.
// Pure helpers: the loop length (whole bars at the song's tempo), the loop blend, the photo loop and
// the choice of the strongest clip window from per-frame statistics.

export const CANVAS = { minSeconds: 3, maxSeconds: 8, blendSeconds: 0.5, sampleFps: 10 } as const;

export type CanvasLength = { seconds: number; bars: number | null; beats: number };

// Every loop length that fits in min-max seconds, longest first: whole bars (8 s, then fewer bars,
// as long as the loop is at least `min` long); at very slow tempos (no whole bar fits) whole beats.
export function canvasLengths(bpm: number, min: number = CANVAS.minSeconds, max: number = CANVAS.maxSeconds): CanvasLength[] {
  const beat = 60 / bpm;
  const bar = beat * 4;
  const out: CanvasLength[] = [];
  for (let bars = Math.floor(max / bar); bars >= 1 && bars * bar >= min - 1e-9; bars--) out.push({ seconds: bars * bar, bars, beats: bars * 4 });
  if (out.length) return out;
  for (let beats = Math.max(1, Math.floor(max / beat)); beats >= 1 && (beats * beat >= min - 1e-9 || !out.length); beats--) out.push({ seconds: Math.max(min, beats * beat), bars: null, beats });
  return out;
}

// The longest whole number of bars that fits in 3-8 s; at very slow tempos whole beats instead.
export function canvasLength(bpm: number, min: number = CANVAS.minSeconds, max: number = CANVAS.maxSeconds): CanvasLength {
  return canvasLengths(bpm, min, max)[0];
}

export const lengthText = (l: CanvasLength) =>
  l.bars ? `${l.bars} bar${l.bars > 1 ? "s" : ""} (${l.seconds.toFixed(2)} s)` : `${l.beats} beats (${l.seconds.toFixed(2)} s)`;

export const CANVAS_MIN_RATE = 0.6; // clips may be slowed down to 0.6x to fill a loop

// Which loop a set of clips allows, in this order:
//   "none"       the longest loop, at normal speed;
//   "fewer-bars" a shorter loop (fewer bars, still >= min seconds), at normal speed;
//   "slow"       the shortest loop with clips slowed down (down to 0.6x);
//   "photo"      no clip can make even that: a vertical photo moving out and back;
//   "fail"       nothing usable.
// `needs` = clip frames a loop takes at 1x (the loop plus the blend frames before its start).
export type CanvasFit = {
  fallback: "none" | "fewer-bars" | "slow" | "photo" | "fail";
  length: CanvasLength;
  rates: (number | null)[]; // per clip: its playback rate, or null if it cannot make the loop
};

export function chooseCanvasFit(lengths: readonly CanvasLength[], clipFrames: readonly number[], blendFrames: number, photos: number, fps = 30): CanvasFit {
  const needs = (l: CanvasLength) => Math.round(l.seconds * fps) + blendFrames;
  for (const [k, l] of lengths.entries()) {
    const rates = clipFrames.map((f) => (f >= needs(l) ? 1 : null));
    if (rates.some((r) => r !== null)) return { fallback: k === 0 ? "none" : "fewer-bars", length: l, rates };
  }
  const shortest = lengths[lengths.length - 1];
  // Slowed: the clip plays `rate` frames per video frame; rounded down to 0.01 so it always fits.
  const rates = clipFrames.map((f) => {
    const rate = Math.floor((f / needs(shortest)) * 100) / 100;
    return rate >= CANVAS_MIN_RATE ? rate : null;
  });
  if (rates.some((r) => r !== null)) return { fallback: "slow", length: shortest, rates };
  return { fallback: photos > 0 ? "photo" : "fail", length: lengths[0], rates: clipFrames.map(() => null) };
}

// Opacity of the fading-in copy during the last `blend` frames of a loop of `length` frames: it
// reaches 1 on the very last frame, so frame length-1 shows the frame right before frame 0.
export function loopBlendOpacity(frame: number, length: number, blend: number): number {
  const into = frame - (length - blend);
  if (into < 0) return 0;
  return Math.min(1, (into + 1) / blend);
}

// A photo's move as a loop: out and back (0 -> 1 -> 0), eased by kenBurnsAt.
export function photoLoopProgress(t: number): number {
  return (1 - Math.cos(2 * Math.PI * Math.min(1, Math.max(0, t)))) / 2;
}

export type FrameStats = { ydif: number; sat: number; contrast: number }; // per sampled frame

// The best window of `windowSamples` samples in each clip: lively (motion), colourful and contrasty,
// without a hard scene change inside (it would break the loop). Scores are relative to the best
// values across all clips. Returns windows sorted best first, at most one per clip.
export function strongestWindows(
  clips: readonly { name: string; stats: readonly FrameStats[]; windowSamples?: number }[],
  windowSamples: number,
): { name: string; startSample: number; score: number }[] {
  const all = clips.flatMap((c) => c.stats);
  if (!all.length) return [];
  const maxOf = (k: keyof FrameStats) => Math.max(1e-6, ...all.map((s) => s[k]));
  const max = { ydif: maxOf("ydif"), sat: maxOf("sat"), contrast: maxOf("contrast") };
  const out: { name: string; startSample: number; score: number }[] = [];
  for (const c of clips) {
    const size = c.windowSamples ?? windowSamples; // a slowed clip needs fewer of its own frames
    if (c.stats.length < size) continue;
    // A scene change: one sample's difference far above both neighbours' (steady motion is not one).
    const d = c.stats.map((x) => x.ydif);
    const isCut = d.map((v, i) => v > 4 && v > 3 * Math.max(d[i - 1] ?? 0, d[i + 1] ?? 0, 0.5));
    let best: { startSample: number; score: number } | null = null;
    for (let s = 0; s + size <= c.stats.length; s++) {
      const w = c.stats.slice(s, s + size);
      const mean = (k: keyof FrameStats) => w.reduce((a, x) => a + x[k], 0) / w.length;
      // The first sample's difference belongs to the frame before the window: not counted.
      const sceneChange = isCut.slice(s + 1, s + size).some(Boolean);
      const score = 0.5 * (mean("ydif") / max.ydif) + 0.25 * (mean("sat") / max.sat) + 0.25 * (mean("contrast") / max.contrast) - (sceneChange ? 1 : 0);
      if (!best || score > best.score) best = { startSample: s, score };
    }
    if (best) out.push({ name: c.name, ...best });
  }
  return out.sort((a, b) => b.score - a.score);
}

// FFmpeg signalstats messages (via metadata=mode=print) -> per-frame statistics. Each frame starts
// with a "frame:N" line followed by its values (in any order).
export function parseSignalStats(stderr: string): FrameStats[] {
  const frames: FrameStats[] = [];
  let current: Record<string, number> | null = null;
  const flush = () => {
    if (current) frames.push({ ydif: current.YDIF ?? 0, sat: current.SATAVG ?? 0, contrast: (current.YHIGH ?? 0) - (current.YLOW ?? 0) });
  };
  for (const line of stderr.split(/\r?\n/)) {
    if (/\bframe:\d+/.test(line)) {
      flush();
      current = {};
      continue;
    }
    const m = /lavfi\.signalstats\.(YDIF|SATAVG|YLOW|YHIGH)=([\d.]+)/.exec(line);
    if (m && current) current[m[1]] = Number(m[2]);
  }
  flush();
  return frames;
}
