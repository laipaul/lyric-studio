// Takes QA (26 Nov 2026, Paul: "Aiko take 2 at ~0:09: the face turns into a flat white mask"): the frames of a returned
// singing take, measured locally against the picture it was made from (services/audio face.py takecheck: about 5 a
// second: a face or not, its SFace similarity, sharpness, texture, brightness), judged here. A frame is bad when the
// face is lost after it was seen, its similarity drops sharply below the take's own level, or its texture / sharpness
// collapses (a flat, smeared or white face). Bad frames in a row for at least MIN_BAD_S make a segment. Pure.

export type TakeFrame = { t: number; face: boolean; sim?: number; sharp?: number; texture?: number; bright?: number };
export type QaKind = "face collapse" | "face drift" | "face lost";
export type QaSegment = { fromS: number; toS: number; kind: QaKind };
export type TakeQa = { checked_at: string; segments: QaSegment[]; good: { fromS: number; toS: number } | null; duration: number; note?: string };

export const QA_LIMITS = {
  simDrop: 0.18, // below the take's median similarity by this much
  simFloor: 0.3, // and never "fine" below this (SFace cosine: the same person is usually above 0.36)
  textureRatio: 0.45, // texture under this share of the take's median: the skin has gone flat
  sharpRatio: 0.3, // sharpness under this share of the median: smeared
  minBadS: 0.4, // a segment lasts at least this long
  mergeGapS: 0.3, // two bad stretches this close are one
};

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function judgeTake(frames: readonly TakeFrame[], duration: number, at = new Date().toISOString()): TakeQa {
  const withFace = frames.filter((f) => f.face && typeof f.sim === "number");
  if (!frames.length || !withFace.length) return { checked_at: at, segments: [], good: null, duration, note: frames.length ? "no face found in the take" : "no frames could be read" };
  const sims = withFace.map((f) => f.sim!);
  const tex = withFace.filter((f) => typeof f.texture === "number").map((f) => f.texture!);
  const sharp = withFace.filter((f) => typeof f.sharp === "number").map((f) => f.sharp!);
  const mSim = median(sims);
  const mTex = median(tex);
  const mSharp = median(sharp);
  const L = QA_LIMITS;
  const firstFace = frames.findIndex((f) => f.face);
  const kindOf = (f: TakeFrame, i: number): QaKind | null => {
    if (!f.face) return i > firstFace ? "face lost" : null;
    if ((typeof f.texture === "number" && f.texture < mTex * L.textureRatio) || (typeof f.sharp === "number" && f.sharp < mSharp * L.sharpRatio)) return "face collapse";
    if (typeof f.sim === "number" && (f.sim < mSim - L.simDrop || f.sim < L.simFloor)) return "face drift";
    return null;
  };
  const step = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 0.2;
  const raw: QaSegment[] = [];
  frames.forEach((f, i) => {
    const k = kindOf(f, i);
    if (!k) return;
    const last = raw[raw.length - 1];
    if (last && f.t - last.toS <= L.mergeGapS + step) {
      last.toS = f.t + step;
      if (k === "face collapse" || (k === "face lost" && last.kind === "face drift")) last.kind = k; // the worst wins
    } else raw.push({ fromS: f.t, toS: f.t + step, kind: k });
  });
  const segments = raw
    .map((s) => ({ ...s, fromS: Math.round(s.fromS * 10) / 10, toS: Math.round(Math.min(duration || s.toS, s.toS) * 10) / 10 }))
    .filter((s) => s.toS - s.fromS >= L.minBadS);
  // The longest good stretch (what "Trim to good part" keeps).
  let good: TakeQa["good"] = null;
  let start = 0;
  for (const s of [...segments, { fromS: duration, toS: duration, kind: "face lost" as QaKind }]) {
    if (s.fromS - start > (good ? good.toS - good.fromS : 0)) good = { fromS: start, toS: s.fromS };
    start = Math.max(start, s.toS);
  }
  return { checked_at: at, segments, good: segments.length ? good : { fromS: 0, toS: duration }, duration };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// "face collapse from 0:09" (the first segment), for the take's badge.
export function qaWords(q: TakeQa | null | undefined): string | null {
  if (!q?.segments.length) return null;
  const s = q.segments[0];
  return `${s.kind} from ${clock(s.fromS)}${q.segments.length > 1 ? ` (+${q.segments.length - 1} more)` : ""}`;
}
