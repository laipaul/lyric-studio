// The lyric scene at one frame: which lines are on screen and how each one (and each word) looks.
// Pure, so the composition draws exactly what the tests check.
//
// Timing (frames of the composition):
//   line.startFrame   the line is settled (fully readable) here: 0.25 s (the lead) before its stamp;
//   enter             the D frames before startFrame (D = the effect's duration, shorter when lines
//                     come fast, so a line is never still moving at its own stamp);
//   exit              while the next line comes in, or, before a pause, over the last 0.4 s before
//                     line.endFrame (compose ends a line 1 s after its last word when a pause follows).
// "glide" lines scroll: the next line waits small underneath (showNext) and rises into place; the
// old line moves up and fades. "swap" lines: the old line goes in the first half of D, the new one
// comes in the second half, in the same place.
import { clamp01, REST, WORD_REST, type EffectChoice, type LineLook, type WordLook, type WordTiming } from "./types";
import { GLIDE_LIFT_PX } from "./glide";
import { motionOf, resolveEffect, type ResolvedEffect } from "./index";

export const NEXT_OPACITY = 0.45; // the waiting next line
export const GAP_FADE_FRAMES = 12; // 0.4 s fade before a pause
export const FALLBACK_WORD_FRAMES = 18; // without word timings: words spread from the stamp, at most 0.6 s each

export type SceneLine = {
  startFrame: number;
  endFrame: number;
  isHook?: boolean;
  stampFrame?: number; // when it is sung (no lead); default startFrame + 8
  sungEndFrame?: number; // its last word ends here
  words?: { text: string; startFrame: number; endFrame: number }[];
};

export type SceneOptions = {
  fps: number;
  durationInFrames: number;
  verse: EffectChoice;
  hook: EffectChoice;
  showNext: boolean;
  nextScale: number;
  gapPx: number; // space between the active line and the waiting next line
  height: (index: number) => number; // a line's text block height at full size, px
  wordCount: (index: number) => number; // words as laid out (for word effects)
};

export type SceneItem = { index: number; role: "active" | "leaving" | "next"; look: LineLook; words: WordLook[] | null };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lineSeed = (i: number) => ((((i + 1) * 2654435761) >>> 0) % 6283) / 1000; // 0 - 2pi, fixed per line

// Everything that depends only on the lines (not on the frame), computed once per lyric list.
export function sceneTimeline(lines: readonly SceneLine[], o: SceneOptions) {
  const n = lines.length;
  const verse = resolveEffect(o.verse, o.fps);
  const hook = resolveEffect(o.hook, o.fps);
  const own: ResolvedEffect[] = lines.map((l) => (l.isHook ? hook : verse));
  const motion = own.map((r) => motionOf(r, verse, o.fps));
  const kind = (i: number) => motion[i].effect.transition;
  const stamp = (i: number) => lines[i].stampFrame ?? lines[i].startFrame + 8;
  // The previous line is still on screen when this one starts to come in.
  const connected = (a: number) => a >= 0 && a + 1 < n && lines[a].endFrame >= lines[a + 1].startFrame - motion[a + 1].frames;
  const D = lines.map((l, i) => {
    const full = motion[i].frames;
    if (!connected(i - 1)) return full;
    const spacing = l.startFrame - lines[i - 1].startFrame;
    const lead = stamp(i - 1) - lines[i - 1].startFrame;
    return Math.max(3, Math.min(full, Math.round(spacing * 0.6), spacing - lead - 2));
  });
  const enterStart = lines.map((l, i) => l.startFrame - D[i]);
  // Glide pairs: line i rises from under line i-1 (where it waited if showNext).
  const stacked = (i: number) => connected(i - 1) && kind(i) === "glide" && kind(i - 1) === "glide";
  const waits = (i: number) => o.showNext && stacked(i);
  const exitWindow = lines.map((l, i) => {
    if (connected(i)) {
      const s = enterStart[i + 1];
      return kind(i + 1) === "glide" ? { start: s, end: lines[i + 1].startFrame, by: "glide" as const } : { start: s, end: s + Math.max(1, Math.round(D[i + 1] / 2)), by: "own" as const };
    }
    if (l.endFrame >= o.durationInFrames) return null; // stays to the very end
    return { start: Math.max(l.startFrame, l.endFrame - GAP_FADE_FRAMES), end: l.endFrame, by: "own" as const };
  });
  return { lines, o, own, motion, kind, stamp, connected, D, enterStart, stacked, waits, exitWindow };
}
export type SceneTimeline = ReturnType<typeof sceneTimeline>;

// Geometry and fades of line i (without the effect's continuous "hold" part), or null if not shown.
function baseLook(t: SceneTimeline, i: number, f: number): { role: SceneItem["role"]; look: LineLook } | null {
  const { lines, o, motion, D, enterStart } = t;
  const l = lines[i];
  const m = motion[i];
  const H = o.height;
  if (f < enterStart[i]) {
    // Waiting small under the previous line (it fades in while that line comes in).
    if (!t.waits(i) || f < enterStart[i - 1]) return null;
    const prev = baseLook(t, i - 1, f);
    if (!prev) return null;
    const a = f >= lines[i - 1].startFrame ? 1 : motion[i - 1].ease(clamp01((f - enterStart[i - 1]) / D[i - 1]));
    const y = prev.look.y + (prev.look.scale * H(i - 1)) / 2 + o.gapPx + (o.nextScale * H(i)) / 2;
    return { role: "next", look: { ...REST, opacity: NEXT_OPACITY * a, y, scale: o.nextScale } };
  }
  if (f < l.startFrame) {
    if (t.kind(i) === "glide") {
      const p = m.ease(clamp01((f - enterStart[i]) / D[i]));
      const from = t.stacked(i)
        ? { y: H(i - 1) / 2 + o.gapPx + (o.nextScale * H(i)) / 2, scale: o.nextScale, opacity: t.waits(i) ? NEXT_OPACITY : 0 }
        : { y: GLIDE_LIFT_PX * m.amount, scale: 0.92, opacity: 0 }; // after a pause: rises in on its own
      return { role: "active", look: { ...REST, y: lerp(from.y, 0, p), scale: lerp(from.scale, 1, p), opacity: lerp(from.opacity, 1, p) } };
    }
    // Swap: after the previous line has gone (first half), this one comes in.
    const half = t.connected(i - 1) ? Math.max(1, Math.round(D[i] / 2)) : 0;
    const p = m.ease(clamp01((f - enterStart[i] - half) / Math.max(1, D[i] - half)));
    return { role: "active", look: { ...REST, ...(m.effect.enter?.(p, m.amount) ?? { opacity: p }) } };
  }
  const w = t.exitWindow[i];
  if (!w || f < w.start) return { role: "active", look: { ...REST } };
  if (f >= w.end) return null;
  if (w.by === "glide") {
    const next = motion[i + 1];
    const q = next.ease(clamp01((f - w.start) / (w.end - w.start)));
    return { role: "leaving", look: { ...REST, opacity: 1 - clamp01(q * 1.6), y: -GLIDE_LIFT_PX * next.amount * q, scale: 1 - 0.04 * q } };
  }
  const q = m.ease(clamp01((f - w.start) / (w.end - w.start)));
  return { role: "leaving", look: { ...REST, ...(m.effect.exit?.(q, m.amount) ?? { opacity: 1 - q }) } };
}

// Word timings for line i: the aligned ones, or spread from its stamp when there are none (or when
// they do not match the words on screen).
export function wordTimings(t: SceneTimeline, i: number): WordTiming[] {
  const l = t.lines[i];
  const count = Math.max(1, t.o.wordCount(i));
  if (l.words?.length === count) return l.words.map((w) => ({ startFrame: w.startFrame, endFrame: w.endFrame }));
  const start = l.words?.length ? l.words[0].startFrame : t.stamp(i);
  const end = l.sungEndFrame ?? (l.words?.length ? l.words[l.words.length - 1].endFrame : Math.min(l.endFrame, start + count * FALLBACK_WORD_FRAMES));
  const step = Math.max(1, end - start) / count;
  return Array.from({ length: count }, (_, k) => ({ startFrame: Math.round(start + k * step), endFrame: Math.round(start + (k + 1) * step) }));
}

export function lyricScene(t: SceneTimeline, frame: number): SceneItem[] {
  const out: SceneItem[] = [];
  for (let i = 0; i < t.lines.length; i++) {
    if ((t.exitWindow[i]?.end ?? Infinity) <= frame) continue; // already gone
    const base = baseLook(t, i, frame);
    if (!base || base.look.opacity <= 0.001) continue;
    const m = t.motion[i];
    const hold = m.effect.hold?.(frame, m.amount, lineSeed(i), t.o.fps) ?? {};
    const look: LineLook = {
      opacity: base.look.opacity,
      x: base.look.x + (hold.x ?? 0),
      y: base.look.y + (hold.y ?? 0),
      scale: base.look.scale * (hold.scale ?? 1),
      blur: base.look.blur + (hold.blur ?? 0),
      glow: clamp01(base.look.glow + (hold.glow ?? 0)),
    };
    const own = t.own[i];
    const words = own.effect.word ? wordTimings(t, i).map((w) => ({ ...WORD_REST, ...own.effect.word!(frame, w, own.amount, t.o.fps) })) : null;
    out.push({ index: i, role: base.role, look, words });
  }
  return out;
}

// How far an effect can move a line from its place (px) and its largest scale: for the QA
// safe-zone check. Sampled from the effect's own functions, so new effects are covered too.
export function effectExtents(choice: EffectChoice, verse: EffectChoice, fps: number): { up: number; down: number; side: number; maxScale: number } {
  const m = motionOf(resolveEffect(choice, fps), resolveEffect(verse, fps), fps);
  const own = resolveEffect(choice, fps);
  const looks: Partial<LineLook>[] = [];
  for (let k = 0; k <= 20; k++) {
    const p = k / 20;
    if (m.effect.enter) looks.push(m.effect.enter(p, m.amount));
    if (m.effect.exit) looks.push(m.effect.exit(p, m.amount));
  }
  const holds: Partial<LineLook>[] = [];
  for (let f = 0; f < fps * 10; f++) holds.push(m.effect.hold?.(f, m.amount, 0, fps) ?? {});
  const range = (ls: Partial<LineLook>[], key: "x" | "y") => ls.reduce((r, l) => [Math.min(r[0], l[key] ?? 0), Math.max(r[1], l[key] ?? 0)], [0, 0]);
  const [y0, y1] = range(looks, "y");
  const [h0, h1] = range(holds, "y");
  const [, x1] = range(holds, "x");
  let up = -(y0 + h0);
  let down = y1 + h1;
  if (m.effect.transition === "glide") {
    up += GLIDE_LIFT_PX * m.amount;
    down += GLIDE_LIFT_PX * m.amount;
  }
  let wordUp = 0;
  let wordDown = 0;
  let wordScale = 1;
  if (own.effect.word) {
    for (let f = -20; f <= 20; f++) {
      const w = own.effect.word(f, { startFrame: 0, endFrame: 10 }, own.amount, fps);
      wordUp = Math.max(wordUp, -(w.y ?? 0));
      wordDown = Math.max(wordDown, w.y ?? 0);
      wordScale = Math.max(wordScale, w.scale ?? 1);
    }
  }
  const maxScale = Math.max(1, ...looks.map((l) => l.scale ?? 1)) * wordScale;
  return { up: up + wordUp, down: down + wordDown, side: x1, maxScale };
}

// "glide" or "swap": how lines with this effect move (word effects take the verse effect's way).
export function motionKind(choice: EffectChoice, verse: EffectChoice, fps = 30): "glide" | "swap" | "inherit" {
  return motionOf(resolveEffect(choice, fps), resolveEffect(verse, fps), fps).effect.transition;
}
