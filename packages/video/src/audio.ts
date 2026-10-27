// What happens to the music in a video. Rule: Lyric Studio never alters the music. The song file is
// only read; a video carries the song's own audio, cut to the section, with nothing applied to it but
// a short fade where the music is cut (never at the song's own start or end), encoded as AAC 320 kbps
// at the master's own sample rate (no resampling; a platform may ask for 48 kHz in platforms.json).
// No volume change, loudness normalisation, EQ, compression or limiting. Pure (pnpm make and QA use it).

export const AUDIO_BITRATE = "320k";
export const AUDIO_CODEC = "AAC";
const FADE_EDGE_MS = 50; // a section this close to the song's start / end keeps the song's own start / end

export type AudioPlan = {
  fadeInS: number; // 0 when the section starts at the song's start
  fadeOutS: number; // 0 when the section ends at the song's end
  sampleRate: number; // Hz of the video's audio
  resampled: boolean; // the master's own rate is changed (only when a platform asks for one)
  bitrate: string;
  note: string; // printed by pnpm make
};

export function audioPlan(o: {
  startMs: number;
  endMs: number;
  songMs: number;
  fadeInSeconds: number; // the platform's (platforms.json fadeInSeconds)
  fadeOutSeconds: number; // the platform's (platforms.json fadeOutSeconds)
  sourceRate: number | null; // the master's sample rate (null: unknown)
  sampleRate: number | "source"; // platforms.json audioSampleRate
}): AudioPlan {
  const atStart = o.startMs <= FADE_EDGE_MS;
  const atEnd = o.endMs >= o.songMs - FADE_EDGE_MS;
  const fadeInS = atStart ? 0 : o.fadeInSeconds;
  const fadeOutS = atEnd ? 0 : o.fadeOutSeconds;
  const source = o.sourceRate && o.sourceRate >= 8_000 && o.sourceRate <= 96_000 ? o.sourceRate : 48_000;
  const sampleRate = o.sampleRate === "source" ? source : o.sampleRate;
  const fades = [fadeInS ? `${fadeInS} s fade-in` : atStart ? "the song's own start" : "no fade-in", fadeOutS ? `${fadeOutS} s fade-out` : atEnd ? "the song's own end" : "no fade-out"];
  return {
    fadeInS,
    fadeOutS,
    sampleRate,
    resampled: !!o.sourceRate && sampleRate !== o.sourceRate,
    bitrate: AUDIO_BITRATE,
    note: `audio: the song itself, ${fades.join(", ")}; ${AUDIO_CODEC} ${AUDIO_BITRATE.replace("k", " kbps")}, ${sampleRate / 1000} kHz${o.sourceRate && sampleRate !== o.sourceRate ? ` (the master is ${o.sourceRate / 1000} kHz: resampled as platforms.json asks)` : " (the master's own rate)"}; no volume, loudness, EQ, compression or limiting`,
  };
}

// The QA comparison of a video's audio with the same section of the song (levels in dB).
export type AudioMatch = { expectedS: number; actualS: number; levelDiffDb: number; envelopeDiffDb: number };
export const AUDIO_LENGTH_TOLERANCE_S = 0.1;
export const AUDIO_LEVEL_TOLERANCE_DB = 0.5;
export const AUDIO_ENVELOPE_TOLERANCE_DB = 1;

const BLOCK = 0.5; // s, for the loudness curve
const MARGIN = 0.25; // s kept away from the fades
const SILENT_DB = -60;
const db = (meanSquare: number) => 10 * Math.log10(Math.max(meanSquare, 1e-12));

// Both signals mono at the same rate, from the start of the section. The level is compared outside the
// fades; the loudness curve (every 0.5 s) shows a wrong section or an offset.
export function compareSignals(rendered: Float32Array, source: Float32Array, rate: number, fadeInS: number, fadeOutS: number): AudioMatch {
  const n = Math.min(rendered.length, source.length);
  const from = Math.min(n, Math.round((fadeInS + MARGIN) * rate));
  const to = Math.max(from, n - Math.round((fadeOutS + MARGIN) * rate));
  const meanSquare = (x: Float32Array, a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    return b > a ? s / (b - a) : 0;
  };
  const levelDiffDb = to > from ? db(meanSquare(rendered, from, to)) - db(meanSquare(source, from, to)) : 0;
  const block = Math.round(BLOCK * rate);
  let total = 0;
  let count = 0;
  for (let a = from; a + block <= to; a += block) {
    const r = db(meanSquare(rendered, a, a + block));
    const s = db(meanSquare(source, a, a + block));
    if (r < SILENT_DB && s < SILENT_DB) continue;
    total += Math.abs(r - s);
    count++;
  }
  return { expectedS: source.length / rate, actualS: rendered.length / rate, levelDiffDb, envelopeDiffDb: count ? total / count : 0 };
}
