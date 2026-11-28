// Music videos made elsewhere (27 Nov 2026, Paul: WaveSpeed's Music Video Generator made "the same bride singing in
// different scenes and camera angles", in sync with the song). Pure parts, no FFmpeg here:
//   - where the video sits in the song: its sound is the song itself, so the song's samples and the video's line up
//     (cross-correlation: a coarse match on the loudness envelope, then exact to the sample);
//   - its shots: the generator joins its scenes with a very short crossfade, so a cut is two frames in a row that
//     change much more than the frames around them;
//   - which sung lines each shot carries (a line belongs to the shot it shows in).

export type MvShot = { fromMs: number; toMs: number }; // video time
export type MusicVideoRecord = {
  at: string; // when it was checked
  matched: boolean; // its sound is this song
  score: number; // how well its sound matches the song (0-1; above MATCH_MIN = the same recording)
  offsetMs: number; // the song time of the video's first frame
  driftMs: number; // how far apart the match is along the video (a steady video: 0)
  durationMs: number;
  width: number | null;
  height: number | null;
  usd: number | null; // what it cost on WaveSpeed (per second of song, by its resolution), as an estimate
  shots: MvShot[];
};
export type MvShotView = MvShot & { i: number; songFromMs: number; songToMs: number; first: number | null; last: number | null; text: string | null; take: number | null; inUse: boolean; sent: string | null; hd: "running" | "done" | "interrupted" | null }; // hd: its 1080p final (Make final)
export type MvView = Omit<MusicVideoRecord, "shots"> & { shots: MvShotView[]; singing: number };

export const MATCH_MIN = 0.8; // the same recording correlates at about 0.99
export const DRIFT_MAX_MS = 25; // under one frame
export const MIN_SHOT_MS = 1000;
export const CUT_MERGE_MS = 500;
export const EDGE_TRIM_MS = 80; // two frames at each cut left out (the crossfade's blend)
export const LINE_LEAD_MS = 500; // a line shown up to this much before a cut still belongs to the shot after it
// WaveSpeed's Music Video Generator price (its model page, 27 Nov 2026): per second of the song sent.
export const MV_USD_PER_SECOND: Record<"480p" | "720p", number> = { "480p": 0.03, "720p": 0.06 };
export const MV_MODEL = "WaveSpeed Music Video Generator";

// ---------------------------------------------------------------- shots

// Scene-change scores per frame (FFmpeg's scene score, 0-1): a cut where two frames in a row together change at least
// `pairMin` and many times more than the frames around them (`ratio` × their median, within ±1 s). Cuts closer than
// CUT_MERGE_MS are one cut. Returns the cut times in ms (the first frame of the new shot is about there).
export function detectCuts(frames: readonly { t: number; score: number }[], o: { pairMin?: number; ratio?: number } = {}): number[] {
  const pairMin = o.pairMin ?? 0.02;
  const ratio = o.ratio ?? 12;
  const cuts: number[] = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i + 1 < frames.length; i++) {
    const t = frames[i].t;
    while (frames[lo].t < t - 1) lo++;
    while (hi < frames.length && frames[hi].t <= t + 1) hi++;
    const pair = frames[i].score + frames[i + 1].score;
    if (pair < pairMin || frames[i].score < 0.3 * pair) continue; // the cut's own frame carries its share (not the frame before)
    const around: number[] = [];
    for (let j = lo; j < hi; j++) if (j !== i && j !== i + 1) around.push(frames[j].score);
    around.sort((a, b) => a - b);
    const median = around.length ? around[Math.floor(around.length / 2)] : 0;
    if (pair < ratio * Math.max(median, 0.0005)) continue;
    const ms = Math.round(t * 1000);
    if (cuts.length && ms - cuts[cuts.length - 1] < CUT_MERGE_MS) continue;
    cuts.push(ms);
  }
  return cuts;
}

// The shots between the cuts; a shot shorter than MIN_SHOT_MS joins the one before it.
export function shotsFromCuts(cutsMs: readonly number[], durationMs: number): MvShot[] {
  const edges = [0, ...cutsMs.filter((c) => c > 0 && c < durationMs), durationMs];
  const shots: MvShot[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const s = { fromMs: edges[i], toMs: edges[i + 1] };
    if (shots.length && s.toMs - s.fromMs < MIN_SHOT_MS) shots[shots.length - 1].toMs = s.toMs;
    else shots.push(s);
  }
  if (shots.length > 1 && shots[0].toMs - shots[0].fromMs < MIN_SHOT_MS) {
    shots[1].fromMs = 0;
    shots.shift();
  }
  return shots;
}

// The sung lines a shot carries: the lines that show while it is on screen (shown time, with LINE_LEAD_MS of grace
// for a line that shows just before the cut). null: no sung line (a look, an instrumental moment).
export function linesOfShot(shot: MvShot, offsetMs: number, lines: readonly { number: number; shownMs: number }[]): { first: number; last: number } | null {
  const from = shot.fromMs + offsetMs;
  const to = shot.toMs + offsetMs;
  const inShot = lines.filter((l) => l.shownMs + LINE_LEAD_MS >= from && l.shownMs + LINE_LEAD_MS < to).map((l) => l.number);
  return inShot.length ? { first: Math.min(...inShot), last: Math.max(...inShot) } : null;
}

// (V2 → V1 change, tracks.ts: the frames before a shot belong to another shot of the generator, so a music-video shot has no
// breath in to keep: it is cut exactly at the generator's own change, and the planner (anchors.ts) never shows its first 2 frames
// (V2_V1_CHANGE.skipFrames, as the clip's in-point) and says "no breath to show": the B-roll fade alone softens the entry.)
// The piece of the video a shot becomes (video ms): its crossfade frames left out, and on to the end of its last line
// when the generator cut before that line was sung to its end (its own cut then plays, still in time).
export function shotPiece(shot: MvShot, offsetMs: number, durationMs: number, lastSungEndMs: number | null): { fromMs: number; toMs: number } {
  const fromMs = shot.fromMs === 0 ? 0 : shot.fromMs + EDGE_TRIM_MS;
  let toMs = shot.toMs >= durationMs ? durationMs : shot.toMs - EDGE_TRIM_MS;
  if (lastSungEndMs !== null) toMs = Math.max(toMs, Math.min(durationMs, lastSungEndMs - offsetMs + 300));
  return { fromMs, toMs: Math.max(fromMs + 200, toMs) };
}

export const mvResolution = (height: number | null, width: number | null): "480p" | "720p" => (Math.min(height ?? 0, width ?? 0) >= 700 ? "720p" : "480p");
export const mvUsd = (durationMs: number, height: number | null, width: number | null) => Math.round(Math.max(3, Math.ceil(durationMs / 1000)) * MV_USD_PER_SECOND[mvResolution(height, width)] * 100) / 100;

// ---------------------------------------------------------------- where in the song

// In-place radix-2 FFT (re, im of a power-of-two length); inverse = true for the inverse (not scaled).
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
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
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// The loudness envelope: the RMS of each `hop` samples, its mean taken away.
export function envelope(samples: Float32Array, hop: number): Float64Array {
  const n = Math.floor(samples.length / hop);
  const out = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) e += samples[j] * samples[j];
    out[i] = Math.sqrt(e / hop);
    sum += out[i];
  }
  const mean = n ? sum / n : 0;
  for (let i = 0; i < n; i++) out[i] -= mean;
  return out;
}

// The lag (in elements) that lines `video` up with `song`: song[i + lag] ≈ video[i]. Full cross-correlation by FFT.
export function bestLag(video: Float64Array, song: Float64Array): number {
  let n = 1;
  while (n < video.length + song.length) n <<= 1;
  const vr = new Float64Array(n);
  const vi = new Float64Array(n);
  const sr = new Float64Array(n);
  const si = new Float64Array(n);
  vr.set(video);
  sr.set(song);
  fft(vr, vi);
  fft(sr, si);
  // song × conj(video)
  for (let k = 0; k < n; k++) {
    const r = sr[k] * vr[k] + si[k] * vi[k];
    const i = si[k] * vr[k] - sr[k] * vi[k];
    sr[k] = r;
    si[k] = i;
  }
  fft(sr, si, true);
  let best = 0;
  let bestV = -Infinity;
  for (let k = 0; k < n; k++) {
    const lag = k < n / 2 ? k : k - n;
    if (lag <= -video.length || lag >= song.length) continue;
    if (sr[k] > bestV) {
      bestV = sr[k];
      best = lag;
    }
  }
  return best;
}

// The exact lag near `around` (± `search` samples) for the video's samples [from, from + len): the largest plain
// correlation. Returns null when that stretch is outside the song.
export function refineLag(video: Float32Array, song: Float32Array, around: number, from: number, len: number, search: number): number | null {
  let best: number | null = null;
  let bestV = -Infinity;
  for (let lag = around - search; lag <= around + search; lag++) {
    if (from + lag < 0 || from + len + lag > song.length || from + len > video.length) continue;
    let s = 0;
    for (let j = from; j < from + len; j++) s += video[j] * song[j + lag];
    if (s > bestV) {
      bestV = s;
      best = lag;
    }
  }
  return best;
}

// Pearson correlation of the video and the song lined up at `lag`, over their overlap (every `step`-th sample).
export function matchScore(video: Float32Array, song: Float32Array, lag: number, step = 1): number {
  const from = Math.max(0, -lag);
  const to = Math.min(video.length, song.length - lag);
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = from; i < to; i += step) {
    const a = video[i];
    const b = song[i + lag];
    n++;
    sa += a;
    sb += b;
    saa += a * a;
    sbb += b * b;
    sab += a * b;
  }
  if (n < 2) return 0;
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

// Where the video sits in the song, from both as mono samples at `rate`: the offset (song ms of the video's first
// frame), how well they match, and the drift between a few stretches along the video.
export function findInSong(video: Float32Array, song: Float32Array, rate: number): { offsetMs: number; score: number; driftMs: number } {
  const hop = Math.round(rate / 100); // 10 ms
  const coarse = bestLag(envelope(video, hop), envelope(song, hop)) * hop;
  const len = Math.min(5 * rate, video.length);
  const lags: number[] = [];
  const stretches = 5;
  for (let k = 0; k < stretches; k++) {
    const from = Math.floor(((video.length - len) * k) / Math.max(1, stretches - 1));
    const lag = refineLag(video, song, coarse, from, len, 2 * hop);
    if (lag !== null) lags.push(lag);
  }
  if (!lags.length) return { offsetMs: Math.round((coarse / rate) * 1000), score: 0, driftMs: 0 };
  const sorted = [...lags].sort((a, b) => a - b);
  const lag = sorted[Math.floor(sorted.length / 2)];
  return {
    offsetMs: Math.round((lag / rate) * 1000 * 10) / 10,
    score: Math.round(matchScore(video, song, lag, 4) * 1000) / 1000,
    driftMs: Math.round(((sorted[sorted.length - 1] - sorted[0]) / rate) * 1000),
  };
}

// ---------------------------------------------------------------- making one (WaveSpeed's Music Video Generator)

export const MV_GENERATOR_PATH = "wavespeed-ai/music-video-generator";
export const MV_MAX_MS = 600_000; // the generator takes up to 10 minutes of song
export const MV_MIN_MS = 3_000;
export const MV_MAX_PICTURES = 3;
// Always added to the words: one person, no stage (Paul's first test showed a microphone stand even in the garden).
export const MV_PROMPT_RULES = "The same person in every shot, same face and hair; she sings to herself, with no microphone and no stage.";
export const MV_DEFAULT_WORDS = "The person in the photos sings this song with real feeling.";
export type MvSectionChoice = { kind: "whole" } | { kind: "latest"; fromMs: number; toMs: number } | { kind: "lines"; first: number; last: number };

// The prompt sent: Paul's words (or a plain default), the rules, the song's Film look.
export function mvPrompt(words: string, look?: string | null): string {
  const w = words.trim().replace(/\s+/g, " ") || MV_DEFAULT_WORDS;
  return [w.replace(/([^.!?])$/, "$1."), MV_PROMPT_RULES, look ? `${look.trim().replace(/([^.!?])$/, "$1.")}` : ""].filter(Boolean).join(" ");
}

// The stretch of the song sent (ms), always on musical boundaries: lines a-b run from the downbeat before line a shows
// (a little lead) to one bar after line b is sung, on a downbeat; the whole song is 0 to its end; the latest Reel's
// section is used as it was made.
export function mvSection(choice: MvSectionChoice, lines: readonly { number: number; shownMs: number; sungEndMs: number }[], downbeats: readonly number[], durationMs: number): { fromMs: number; toMs: number } {
  if (choice.kind === "whole") return { fromMs: 0, toMs: durationMs };
  if (choice.kind === "latest") return { fromMs: Math.max(0, choice.fromMs), toMs: Math.min(durationMs, choice.toMs) };
  const a = lines.find((l) => l.number === choice.first);
  const b = lines.find((l) => l.number === choice.last);
  if (!a || !b || b.number < a.number) throw new Error("Choose a first and a last sung line (the last one after the first).");
  const gaps = downbeats.slice(1).map((d, i) => d - downbeats[i]).sort((x, y) => x - y);
  const bar = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2000;
  const before = downbeats.filter((d) => d <= a.shownMs - 300).at(-1);
  const after = downbeats.find((d) => d >= b.sungEndMs + bar * 0.75);
  return { fromMs: Math.max(0, before ?? a.shownMs - 1500), toMs: Math.min(durationMs, after ?? b.sungEndMs + bar) };
}

// ---------------------------------------------------------------- next to the planned shots (27 Nov 2026)
// Paul: "once I loaded the music video, I should see each video next to each shot planned". A music-video shot belongs
// next to a planned shot (Production) when:
//   - it carries sung lines: the planned shot is on one of those lines (her lips match only there), or the planned shot
//     has no line and they share at least half of the planned shot's time;
//   - it has no sung line: they share at least half of the shorter of the two.
// Best overlap first. Pure.
export type PlannedShot = { line: number | null; span?: { startMs: number; endMs: number } | null };
export type MvShotLike = { songFromMs: number; songToMs: number; first: number | null; last: number | null };
export function mvShotsForPlanned<T extends MvShotLike>(planned: PlannedShot, shots: readonly T[]): T[] {
  const span = planned.span ?? null;
  const overlap = (s: MvShotLike) => (span ? Math.max(0, Math.min(span.endMs, s.songToMs) - Math.max(span.startMs, s.songFromMs)) : 0);
  const fits = (s: MvShotLike) => {
    if (s.first !== null) {
      if (planned.line !== null) return planned.line >= s.first && planned.line <= (s.last ?? s.first);
      return !!span && overlap(s) >= 0.5 * (span.endMs - span.startMs);
    }
    if (!span) return false;
    return overlap(s) >= 0.5 * Math.min(span.endMs - span.startMs, s.songToMs - s.songFromMs);
  };
  return shots.filter(fits).sort((a, b) => overlap(b) - overlap(a));
}
