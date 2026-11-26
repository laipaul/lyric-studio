// Lip-sync readiness of a clip (26 Nov 2026, Nextgen sprint step 2; Paul: "lip-sync models fail on side profiles,
// small or shadowed faces, covered mouths and fast camera moves. I want to know which clips can carry singing BEFORE
// spending credits"). The face engine measures sampled frames (face.py lipsync_measure, about 3 a second); this file
// judges them, with every threshold in LIPSYNC_LIMITS so a calibration on real clips changes numbers, not rules.
// Verdict: good (✅ Good for lip sync) / risky (⚠️) / bad (❌ Not suitable), plain reasons with the time they start,
// and the best usable window inside the clip. Pure.

export type LipFrame = {
  t: number; // seconds into the clip
  face: boolean;
  face_frac?: number; // face height / frame height
  yaw?: number | null; // head turn in degrees (0 = facing the camera)
  mouth_light?: number | null; // mean grey of the mouth region, 0-255
  mouth_covered?: boolean; // a hand over the mouth
  sharp?: number; // the face's sharpness (variance of the Laplacian at 256 px)
  center?: [number, number]; // face centre, as fractions of the frame
};
export type LipMeasure = { duration: number; frames: LipFrame[] };
export type LipVerdict = "good" | "risky" | "bad";
export type LipCheck = {
  verdict: LipVerdict;
  reasons: string[]; // plain words, the problems first
  window: { from: number; to: number } | null; // the best usable window (seconds), good frames first, else risky ones
  turn: string; // "front", "3/4", "near profile", "no face"
  faceShare: number | null; // the median face height share (0-1)
  goodShare: number; // share of the clip that is good
};

// The limits (to calibrate on Paul's clips: pnpm lipsync:check <folder>).
export const LIPSYNC_LIMITS = {
  faceBad: 0.12, // a face smaller than 12 % of the frame height: a wide shot, the mouth too small to sync
  faceRisky: 0.2, // under 20 %: usable but small (a medium close-up or tighter is ideal)
  yawRisky: 35, // a stronger turn than 35°: a strong 3/4
  yawBad: 55, // beyond 55°: near profile, one side of the mouth hidden
  shadowBad: 20, // mouth region darker than this (0-255): in deep shadow
  shadowRisky: 40,
  sharpBad: 15, // the face blurred
  sharpRisky: 40,
  moveRisky: 0.35, // face centre moving more than 35 % of the frame per second: fast camera or head move
  moveBad: 0.7,
  goodShare: 0.8, // good for at least 80 % of the clip …
  goodWindow: 3, // … with a good window of at least 3 s: ✅
  usableWindow: 2, // else a good-or-risky window of at least 2 s: ⚠️
} as const;

type Issue = { level: "risky" | "bad"; key: string; text: (t: number) => string };

function frameIssues(f: LipFrame, move: number | null, L = LIPSYNC_LIMITS): Issue[] {
  const out: Issue[] = [];
  const at = (t: number) => (t > 0.05 ? ` from ${t.toFixed(1)} s` : "");
  if (!f.face) return [{ level: "bad", key: "noface", text: (t) => `no face${at(t)}` }];
  const share = f.face_frac ?? 0;
  if (share < L.faceBad) out.push({ level: "bad", key: "small", text: () => `face too small (${Math.round(share * 100)} % of the frame height; a medium close-up or tighter is best)` });
  else if (share < L.faceRisky) out.push({ level: "risky", key: "smallish", text: () => `face rather small (${Math.round(share * 100)} % of the frame height)` });
  const yaw = f.yaw == null ? null : Math.abs(f.yaw);
  if (yaw !== null && yaw > L.yawBad) out.push({ level: "bad", key: "profile", text: (t) => `side profile${at(t)}` });
  else if (yaw !== null && yaw > L.yawRisky) out.push({ level: "risky", key: "turned", text: (t) => `head turned strongly (about ${Math.round(yaw)}°)${at(t)}` });
  if (f.mouth_covered) out.push({ level: "bad", key: "covered", text: (t) => `mouth covered${at(t)}` });
  if (f.mouth_light != null && f.mouth_light < L.shadowBad) out.push({ level: "bad", key: "shadow", text: (t) => `mouth in deep shadow${at(t)}` });
  else if (f.mouth_light != null && f.mouth_light < L.shadowRisky) out.push({ level: "risky", key: "dark", text: (t) => `mouth rather dark${at(t)}` });
  if (f.sharp != null && f.sharp < L.sharpBad) out.push({ level: "bad", key: "blur", text: (t) => `face blurred${at(t)}` });
  else if (f.sharp != null && f.sharp < L.sharpRisky) out.push({ level: "risky", key: "soft", text: (t) => `face a little soft${at(t)}` });
  if (move != null && move > L.moveBad) out.push({ level: "bad", key: "fast", text: (t) => `fast face or camera movement${at(t)}` });
  else if (move != null && move > L.moveRisky) out.push({ level: "risky", key: "moving", text: (t) => `the face moves quite fast${at(t)}` });
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// The longest run of frames whose level is at most `max` ("good" or "risky"), as a window in seconds.
function longestRun(frames: LipFrame[], levels: LipVerdict[], max: LipVerdict, duration: number): { from: number; to: number } | null {
  const ok = (l: LipVerdict) => (max === "good" ? l === "good" : l !== "bad");
  const half = frames.length > 1 ? (frames[1].t - frames[0].t) / 2 : duration / 2;
  let best: { from: number; to: number } | null = null;
  for (let i = 0; i < frames.length; ) {
    if (!ok(levels[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < frames.length && ok(levels[j + 1])) j++;
    const from = Math.max(0, frames[i].t - (i === 0 ? frames[i].t : half));
    const to = Math.min(duration, j === frames.length - 1 ? duration : frames[j].t + half);
    if (!best || to - from > best.to - best.from) best = { from: Math.round(from * 10) / 10, to: Math.round(to * 10) / 10 };
    i = j + 1;
  }
  return best;
}

export function judgeLipsync(m: LipMeasure, L = LIPSYNC_LIMITS): LipCheck {
  const frames = [...m.frames].sort((a, b) => a.t - b.t);
  const duration = m.duration || (frames.at(-1)?.t ?? 0);
  if (!frames.length) return { verdict: "bad", reasons: ["no frames could be read"], window: null, turn: "no face", faceShare: null, goodShare: 0 };
  const issues = frames.map((f, i) => {
    const prev = frames[i - 1];
    const move = prev?.center && f.center && f.t > prev.t ? Math.hypot(f.center[0] - prev.center[0], f.center[1] - prev.center[1]) / (f.t - prev.t) : null;
    return frameIssues(f, move, L);
  });
  const levels: LipVerdict[] = issues.map((x) => (x.some((i) => i.level === "bad") ? "bad" : x.length ? "risky" : "good"));
  const goodShare = levels.filter((l) => l === "good").length / frames.length;
  const goodWin = longestRun(frames, levels, "good", duration);
  const usableWin = longestRun(frames, levels, "risky", duration);
  const len = (w: { from: number; to: number } | null) => (w ? w.to - w.from : 0);
  const verdict: LipVerdict = goodShare >= L.goodShare && len(goodWin) >= Math.min(L.goodWindow, duration - 0.05) ? "good" : len(usableWin) >= Math.min(L.usableWindow, duration - 0.05) ? "risky" : "bad";
  // The reasons: each problem once, at its first frame (the bad ones first).
  const seen = new Map<string, { level: string; text: string }>();
  issues.forEach((list, i) => list.forEach((x) => !seen.has(x.key) && seen.set(x.key, { level: x.level, text: x.text(frames[i].t) })));
  const problems = [...seen.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1)).map((x) => x.text);
  const noFace = levels.length ? frames.filter((f) => !f.face).length / frames.length : 1;
  if (noFace > 0 && noFace < 1) {
    const i = problems.findIndex((p) => p.startsWith("no face"));
    if (i >= 0) problems[i] = `no face in ${Math.round(noFace * 100)} % of the clip`;
  }
  const yaws = frames.flatMap((f) => (f.face && f.yaw != null ? [Math.abs(f.yaw)] : []));
  const typicalYaw = median(yaws);
  const turn = !frames.some((f) => f.face) ? "no face" : typicalYaw == null ? "unknown" : typicalYaw > L.yawBad ? "near profile" : typicalYaw > 20 ? "3/4" : "front";
  const faceShare = median(frames.flatMap((f) => (f.face && f.face_frac != null ? [f.face_frac] : [])));
  const reasons = verdict === "good" && !problems.length ? [`${turn === "front" ? "front" : "3/4"} face, ${faceShare != null && faceShare >= 0.35 ? "close-up" : "medium close-up"}, mouth clear`] : problems;
  const window = verdict === "bad" ? null : verdict === "good" ? goodWin : (goodWin && len(goodWin) >= L.usableWindow ? goodWin : usableWin);
  return { verdict, reasons, window, turn, faceShare: faceShare == null ? null : Math.round(faceShare * 100) / 100, goodShare: Math.round(goodShare * 100) / 100 };
}

export const LIPSYNC_LABEL: Record<LipVerdict, string> = { good: "Good for lip sync", risky: "Risky for lip sync", bad: "Not suitable for lip sync" };
