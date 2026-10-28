// "Loop flows" (Reels, TikTok, Shorts loop on the platform): the wrap-around from the last frame back
// to the first, on five points:
//   beat    - the video is a whole number of bars at the song's BPM (within 50 ms), so the beat stays
//             in time across the loop;
//   phrase  - it ends after a complete line and starts at most one bar before a sung line;
//   sound   - no level jump at the loop point: the music's last 100 ms against its first 100 ms
//             (WARN above 3 dB; the music is the song's own, so it is measured on the song's section);
//   harmony - the chroma of the last bar and of the first bar fit one key (WARN when no key fits both:
//             the loop would sound like a key change);
//   picture - the last shot is not the first shot's clip again (the loop would be visible), unless the
//             last shot continues straight into the first one (the Reels loop ending: the frames just
//             before the first shot's, so the motion carries on).
// Also a score for the auto section's end choice (the end whose last bar flows best into the first).
// Pure: the song's samples are passed in (mono, any rate).

export const LOOP_BEAT_TOLERANCE_MS = 50;
export const LOOP_LEVEL_JUMP_DB = 3;
export const LOOP_EDGE_MS = 100; // the windows compared for the level jump
export const HARMONY_MIN_FIT = 0.15; // below: no key fits both bars, a strong clash (a key change). Ordinary chord changes (I-V, i-V, I-ii) fit at 0.3-0.5
export const BAR_REACH_MS = 150; // a little tolerance on "one bar" (the bar grid of the analysis)
const SILENT_DB = -60;
const BEATS_PER_BAR = 4;

export type LoopAudio = { rate: number; samples: Float32Array }; // the song, mono, from 0:00
export type LoopLine = { number: number; text: string; sungStartMs: number; sungEndMs: number };
export type LoopPointName = "beat" | "phrase" | "sound" | "harmony" | "picture";
export type LoopPoint = { point: LoopPointName; ok: boolean; detail: string };
export type Harmony = { fit: number; lastKey: string; firstKey: string } | null; // null: no clear harmony

export type LoopResult = {
  ok: boolean;
  points: LoopPoint[];
  length_s: number;
  bars: number; // the length in bars (not rounded)
  bar_s: number;
  beat_off_ms: number; // from the nearest whole number of bars
  level_last_db: number | null; // null: not measured
  level_first_db: number | null;
  level_jump_db: number | null;
  harmony: Harmony | undefined; // undefined: not measured
  first_clip: string | null;
  last_clip: string | null;
  continues: boolean; // the last shot continues into the first one (Reels loop ending)
};

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
export const barMsAt = (bpm: number) => (BEATS_PER_BAR * 60_000) / bpm;

// ---------------------------------------------------------------- beat

export function beatOff(lengthMs: number, bpm: number): { bars: number; whole: number; offMs: number; barMs: number } {
  const barMs = barMsAt(bpm);
  const bars = lengthMs / barMs;
  const whole = Math.max(1, Math.round(bars));
  return { bars, whole, offMs: lengthMs - whole * barMs, barMs };
}

function beatPoint(lengthMs: number, bpm: number): LoopPoint {
  const b = beatOff(lengthMs, bpm);
  const ok = Math.abs(b.offMs) <= LOOP_BEAT_TOLERANCE_MS;
  const bpmText = `${Math.round(bpm)} BPM`;
  if (ok) return { point: "beat", ok, detail: `${s1(lengthMs)} = ${b.whole} bars at ${bpmText}` };
  const beats = Math.abs(b.offMs) / (b.barMs / BEATS_PER_BAR);
  return {
    point: "beat",
    ok,
    detail:
      `length ${s1(lengthMs)} is ${Number((Math.abs(b.offMs) / 1000).toFixed(2))} s off a whole bar ` +
      `(${b.bars.toFixed(2)} bars at ${bpmText}, ${beats.toFixed(1)} beat${beats >= 0.95 && beats < 1.05 ? "" : "s"} ${b.offMs > 0 ? "over" : "short"}; ${b.whole} bars would be ${s1(b.whole * b.barMs)}): the beat jumps at the loop`,
  };
}

// ---------------------------------------------------------------- phrase

function phrasePoint(lines: readonly LoopLine[], startMs: number, endMs: number, barMs: number): LoopPoint {
  const problems: string[] = [];
  const name = (l: LoopLine) => `line ${l.number} "${l.text}"`;
  const atEnd = lines.find((l) => l.sungStartMs < endMs && endMs < l.sungEndMs);
  if (atEnd) problems.push(`it ends inside ${name(atEnd)} (sung until ${clock(atEnd.sungEndMs)})`);
  const atStart = lines.find((l) => l.sungStartMs < startMs && startMs < l.sungEndMs);
  const first = lines.filter((l) => l.sungStartMs >= startMs && l.sungStartMs < endMs).sort((a, b) => a.sungStartMs - b.sungStartMs)[0];
  if (atStart) problems.push(`it starts inside ${name(atStart)}`);
  else if (first && first.sungStartMs - startMs > barMs + BAR_REACH_MS) {
    problems.push(`the first sung line (${name(first)}) begins ${s1(first.sungStartMs - startMs)} after the start, more than one bar (${s1(barMs)})`);
  }
  if (problems.length) return { point: "phrase", ok: false, detail: `phrase: ${problems.join("; ")}` };
  const last = lines.filter((l) => l.sungEndMs <= endMs && l.sungStartMs >= startMs).pop();
  const detail = first
    ? `ends after ${last ? name(last) : "a complete line"}, starts ${s1(first.sungStartMs - startMs)} before ${name(first)}`
    : "no sung line inside";
  return { point: "phrase", ok: true, detail };
}

// ---------------------------------------------------------------- sound

export function levelDb(audio: LoopAudio, fromMs: number, toMs: number): number {
  const a = Math.max(0, Math.round((fromMs / 1000) * audio.rate));
  const b = Math.min(audio.samples.length, Math.round((toMs / 1000) * audio.rate));
  let s = 0;
  for (let i = a; i < b; i++) s += audio.samples[i] * audio.samples[i];
  return 10 * Math.log10(Math.max(b > a ? s / (b - a) : 0, 1e-12));
}

// The music's level just before the loop point (the video's end) and just after it (its start).
export function loopLevels(audio: LoopAudio, startMs: number, endMs: number): { last: number; first: number; jump: number } {
  const last = levelDb(audio, endMs - LOOP_EDGE_MS, endMs);
  const first = levelDb(audio, startMs, startMs + LOOP_EDGE_MS);
  const jump = last < SILENT_DB && first < SILENT_DB ? 0 : Math.abs(Math.max(last, SILENT_DB) - Math.max(first, SILENT_DB));
  return { last, first, jump };
}

function soundPoint(levels: { last: number; first: number; jump: number } | null): LoopPoint {
  if (!levels) return { point: "sound", ok: true, detail: "level not measured (the song could not be read)" };
  const ok = levels.jump <= LOOP_LEVEL_JUMP_DB;
  const both = `the last 100 ms ${levels.last.toFixed(1)} dB, the first 100 ms ${levels.first.toFixed(1)} dB`;
  return ok
    ? { point: "sound", ok, detail: `level jump ${levels.jump.toFixed(1)} dB` }
    : { point: "sound", ok, detail: `level jump ${levels.jump.toFixed(1)} dB at the loop point (${both}; allowed ${LOOP_LEVEL_JUMP_DB} dB): the loop is heard as a ${levels.last < levels.first ? "sudden rise" : "sudden drop"}` };
}

// ---------------------------------------------------------------- harmony

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// 12 pitch classes (C = 0) of a stretch of the song: power spectrum (Hann frames of ~0.25 s) from
// 100 Hz to 2 kHz, each frame normalised so loud moments do not dominate. null: silent.
export function chroma(audio: LoopAudio, fromMs: number, toMs: number): number[] | null {
  const size = audio.rate >= 32_000 ? 8192 : 4096;
  const hop = size / 2;
  const a = Math.max(0, Math.round((fromMs / 1000) * audio.rate));
  const b = Math.min(audio.samples.length, Math.round((toMs / 1000) * audio.rate));
  const bins: { k: number; pc: number }[] = [];
  for (let k = 1; k < size / 2; k++) {
    const f = (k * audio.rate) / size;
    if (f < 100 || f > 2000) continue;
    bins.push({ k, pc: (((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12) });
  }
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  const total = new Array<number>(12).fill(0);
  let frames = 0;
  const stop = Math.min(audio.samples.length, Math.max(b, a + size)); // at least one frame
  for (let at = a; at + size <= stop; at += hop) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let energy = 0;
    for (let i = 0; i < size; i++) {
      re[i] = audio.samples[at + i] * window[i];
      energy += re[i] * re[i];
    }
    if (energy / size < 1e-7) continue; // silent frame
    fft(re, im);
    const c = new Array<number>(12).fill(0);
    for (const { k, pc } of bins) c[pc] += re[k] * re[k] + im[k] * im[k];
    const norm = Math.hypot(...c);
    if (norm <= 0) continue;
    c.forEach((v, i) => (total[i] += v / norm));
    frames++;
  }
  return frames ? total.map((v) => v / frames) : null;
}

// Krumhansl-Kessler key profiles (C major, C minor).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const KEYS = [...NOTES.map((n) => `${n} major`), ...NOTES.map((n) => `${n} minor`)];

function pearson(x: readonly number[], y: readonly number[]): number {
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

// How well a chroma fits each of the 24 keys (correlation with the key profile, -1..1).
export function keyFits(c: readonly number[]): number[] {
  return [MAJOR, MINOR].flatMap((profile) => NOTES.map((_, k) => pearson(c, profile.map((_, i) => profile[(i - k + 12) % 12]))));
}

// The best key that fits both bars (the weaker bar's fit), and each bar's own best key.
export function harmonyFit(last: readonly number[] | null, first: readonly number[] | null): Harmony {
  if (!last || !first) return null;
  const a = keyFits(last);
  const b = keyFits(first);
  if (Math.max(...a) < 0.2 || Math.max(...b) < 0.2) return null; // no clear harmony (drums, noise, speech)
  const both = a.map((v, k) => Math.min(v, b[k]));
  const best = (r: number[]) => KEYS[r.indexOf(Math.max(...r))];
  return { fit: Math.max(...both), lastKey: best(a), firstKey: best(b) };
}

export function loopHarmony(audio: LoopAudio, startMs: number, endMs: number, barMs: number): Harmony {
  return harmonyFit(chroma(audio, Math.max(startMs, endMs - barMs), endMs), chroma(audio, startMs, Math.min(endMs, startMs + barMs)));
}

function harmonyPoint(h: Harmony | undefined): LoopPoint {
  if (h === undefined) return { point: "harmony", ok: true, detail: "harmony not measured (the song could not be read)" };
  if (h === null) return { point: "harmony", ok: true, detail: "no clear harmony to compare (drums or no pitched sound)" };
  const ok = h.fit >= HARMONY_MIN_FIT;
  return ok
    ? { point: "harmony", ok, detail: `harmony fits (${h.lastKey === h.firstKey ? h.lastKey : `${h.lastKey} -> ${h.firstKey}`}, ${h.fit.toFixed(2)})` }
    : {
        point: "harmony",
        ok,
        detail: `harmony clash: the last bar (sounds like ${h.lastKey}) and the first bar (${h.firstKey}) fit no common key (best shared fit ${h.fit.toFixed(2)}, below ${HARMONY_MIN_FIT}): the loop sounds like a key change`,
      };
}

// ---------------------------------------------------------------- picture

function picturePoint(firstClip: string | null, lastClip: string | null, shots: number, continues: boolean): LoopPoint {
  if (!firstClip || !lastClip) return { point: "picture", ok: true, detail: "no clips" };
  if (firstClip !== lastClip) return { point: "picture", ok: true, detail: `${lastClip} -> ${firstClip}` };
  if (continues) return { point: "picture", ok: true, detail: `the last shot continues straight into the first (${firstClip}, the frames just before it)` };
  return {
    point: "picture",
    ok: false,
    detail: shots === 1 ? `one shot only (${firstClip}): the clip visibly restarts at the loop` : `the first and the last shot both show ${firstClip}: the loop becomes visible`,
  };
}

// ---------------------------------------------------------------- the check

export function loopFlows(o: {
  lengthMs: number; // the video's length
  bpm: number;
  startMs: number; // the section in the song
  endMs: number;
  lines: readonly LoopLine[];
  audio: LoopAudio | null; // null: the song could not be read
  firstClip: string | null;
  lastClip: string | null;
  shots: number;
  continues: boolean;
}): LoopResult {
  const b = beatOff(o.lengthMs, o.bpm);
  const levels = o.audio ? loopLevels(o.audio, o.startMs, o.endMs) : null;
  const harmony = o.audio ? loopHarmony(o.audio, o.startMs, o.endMs, b.barMs) : undefined;
  const points = [
    beatPoint(o.lengthMs, o.bpm),
    phrasePoint(o.lines, o.startMs, o.endMs, b.barMs),
    soundPoint(levels),
    harmonyPoint(harmony),
    picturePoint(o.firstClip, o.lastClip, o.shots, o.continues),
  ];
  const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    ok: points.every((p) => p.ok),
    points,
    length_s: round(o.lengthMs / 1000, 3),
    bars: round(b.bars, 3),
    bar_s: round(b.barMs / 1000, 3),
    beat_off_ms: Math.round(b.offMs),
    level_last_db: levels ? round(levels.last) : null,
    level_first_db: levels ? round(levels.first) : null,
    level_jump_db: levels ? round(levels.jump) : null,
    harmony: harmony ? { ...harmony, fit: round(harmony.fit, 2) } : harmony,
    first_clip: o.firstClip,
    last_clip: o.lastClip,
    continues: o.continues,
  };
}

// ---------------------------------------------------------------- the auto section's end choice

export type LoopFit = { score: number; ok: boolean; text: string }; // score: lower flows better

// How well an end flows back into the start: beat (whole bars), level jump, harmony. Each failed point
// costs 1, plus a small share of how far it is off, so the best of several good ends still wins.
export function loopFit(audio: LoopAudio | null, bpm: number, startMs: number, endMs: number): LoopFit {
  const b = beatOff(endMs - startMs, bpm);
  const beatOk = Math.abs(b.offMs) <= LOOP_BEAT_TOLERANCE_MS;
  const parts = [beatOk ? "whole bars" : `${(Math.abs(b.offMs) / 1000).toFixed(2)} s off a whole bar`];
  let score = (beatOk ? 0 : 1) + Math.abs(b.offMs) / b.barMs;
  let ok = beatOk;
  if (audio) {
    const lv = loopLevels(audio, startMs, endMs);
    const h = loopHarmony(audio, startMs, endMs, b.barMs);
    const levelOk = lv.jump <= LOOP_LEVEL_JUMP_DB;
    const harmonyOk = !h || h.fit >= HARMONY_MIN_FIT;
    score += (levelOk ? 0 : 1) + lv.jump / 12 + (harmonyOk ? 0 : 1) + (h ? (1 - h.fit) / 2 : 0.25);
    ok = ok && levelOk && harmonyOk;
    parts.push(`level jump ${lv.jump.toFixed(1)} dB`, h ? `harmony ${h.fit.toFixed(2)}${harmonyOk ? "" : " (clash)"}` : "no clear harmony");
  }
  return { score, ok, text: parts.join(", ") };
}

// ---------------------------------------------------------------- better loops (the storyboard's hint)

export type LoopSuggestion = { lengthS: number; endMs: number; line: { number: number; text: string } | null; fit: LoopFit };

// Ends that loop well from this start: bar starts right after a complete sung line (never inside one),
// 0.5-1.5x the target, whose wrap-around passes beat, level and harmony; the nearest to the target first.
export function loopSuggestions(o: {
  audio: LoopAudio | null;
  bpm: number;
  startMs: number;
  downbeats: readonly number[]; // song time
  lines: readonly LoopLine[];
  targetMs: number;
  durationMs: number;
  count?: number;
}): LoopSuggestion[] {
  const singing = (t: number) => o.lines.some((l) => t > l.sungStartMs && t < l.sungEndMs);
  const bars = [...o.downbeats].sort((a, b) => a - b);
  const out: LoopSuggestion[] = [];
  for (let k = 0; k < bars.length; k++) {
    const at = bars[k];
    const length = at - o.startMs;
    if (length < o.targetMs * 0.5 || length > o.targetMs * 1.5 || at > o.durationMs || singing(at)) continue;
    // The first bar after a line has ended (a musical ending, not mid-instrumental).
    const ended = o.lines.filter((l) => l.sungEndMs <= at && l.sungStartMs >= o.startMs);
    const last = ended.reduce<LoopLine | null>((a, l) => (!a || l.sungEndMs > a.sungEndMs ? l : a), null);
    if (!last || (k > 0 && bars[k - 1] >= last.sungEndMs)) continue;
    const fit = loopFit(o.audio, o.bpm, o.startMs, at);
    if (fit.ok) out.push({ lengthS: Math.round(length / 100) / 10, endMs: at, line: { number: last.number, text: last.text }, fit });
  }
  return out.sort((a, b) => Math.abs(a.endMs - o.startMs - o.targetMs) - Math.abs(b.endMs - o.startMs - o.targetMs)).slice(0, o.count ?? 3);
}
