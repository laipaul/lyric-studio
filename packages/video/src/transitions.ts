// Automatic transitions between shots (recipe "transitions": auto by default), chosen by the app from the
// music (guiding principle: a technical decision; the user's creative choice is per clip, in the clip
// editor: "comes in with cut / dissolve").
//   cut       a hard cut on the beat: hooks (choruses), driving songs, sung passages of mid-paced songs;
//   dissolve  a soft cross-fade of about 1.5 s in whole beats (compose.ts autoDissolveFrames), centred on the cut: the verses, intros and
//             instrumental passages of calm songs, and instrumental passages of mid-paced songs;
//   dip       a short dip to black (about half a bar, the cut at its darkest) where a verse opens into a
//             chorus: the "big moment" (calm and mid-paced songs; driving songs cut).
// Styles: "crisp" = cuts only, "flowing" = dissolves everywhere outside the hooks (dips into choruses).
// Anchored shots keep their own transition; a clip's own choice (clips.json "transition") wins over auto.
// Pure.
import type { Feel } from "./pace";

export const TRANSITION_STYLES = ["auto", "crisp", "flowing"] as const;
export type TransitionStyle = (typeof TRANSITION_STYLES)[number];
export type TransitionKind = "cut" | "dissolve" | "dip";

export type TransitionCut = {
  shot: number; // the shot that comes in (1-based in the video: shot 0 has no transition in)
  songMs: number; // where the cut is in the song
  fixed?: "cut" | "dissolve"; // the clip's own choice (clips.json) or an anchor's
};

export function planTransitions(o: {
  style: TransitionStyle;
  feel: Feel;
  cuts: readonly TransitionCut[];
  hooks: readonly { start_ms: number; end_ms: number }[]; // song time: on screen to sung end
  sung: readonly { start_ms: number; end_ms: number }[]; // song time: each line's sung stretch
  barMs: number;
}): { kinds: Map<number, TransitionKind>; text: string } {
  const inHook = (t: number) => o.hooks.some((h) => t >= h.start_ms && t < h.end_ms);
  const singing = (t: number) => o.sung.some((s) => t > s.start_ms - 250 && t < s.end_ms);
  const kinds = new Map<number, TransitionKind>();
  for (const c of o.cuts) {
    if (c.fixed) {
      kinds.set(c.shot, c.fixed);
      continue;
    }
    const hook = inHook(c.songMs + 50);
    const intoHook = hook && !inHook(c.songMs - o.barMs / 2);
    let kind: TransitionKind;
    if (o.style === "crisp") kind = "cut";
    else if (intoHook) kind = o.feel === "driving" && o.style === "auto" ? "cut" : "dip";
    else if (hook) kind = "cut";
    else if (o.style === "flowing" || o.feel === "calm") kind = "dissolve";
    else if (o.feel === "medium") kind = singing(c.songMs) ? "cut" : "dissolve";
    else kind = "cut";
    kinds.set(c.shot, kind);
  }
  return { kinds, text: transitionsText(o.style, o.feel, [...kinds.values()]) };
}

function transitionsText(style: TransitionStyle, feel: Feel, kinds: TransitionKind[]): string {
  const n = (k: TransitionKind) => kinds.filter((x) => x === k).length;
  if (!kinds.length) return "Transitions: one shot, no transitions.";
  if (style === "crisp") return "Transitions: hard cuts on the beat (crisp, as set in the recipe).";
  const parts: string[] = [];
  if (n("dissolve")) parts.push(feel === "calm" || style === "flowing" ? "soft dissolves in the verses and quiet passages" : "soft dissolves in the instrumental passages");
  if (n("cut")) parts.push(n("dissolve") ? "cuts on the beat elsewhere" : "cuts on the beat");
  if (n("dip")) parts.push(`a dip to black into ${n("dip") > 1 ? "each chorus" : "the chorus"}`);
  const why = style === "flowing" ? " (flowing, as set in the recipe)" : feel === "calm" ? " (a calm song)" : feel === "driving" ? " (a driving song)" : "";
  return `Transitions: ${parts.join(", ")}${why}.`;
}

// A dip to black: `frames` frames centred on the cut, darkest on the cut (opacity 0 -> 1 -> 0).
export function dipOpacity(frame: number, dips: readonly { frame: number; frames: number }[]): number {
  let o = 0;
  for (const d of dips) {
    const half = Math.max(1, d.frames / 2);
    o = Math.max(o, 1 - Math.abs(frame - d.frame) / half);
  }
  return Math.max(0, Math.min(1, o));
}

// The lights-dim ending: over the last `frames` frames the picture goes to black, slowly at first (the studio light
// lingers, then goes), fully dark on the last frame.
export function endDimOpacity(frame: number, durationInFrames: number, frames: number): number {
  if (frames <= 0) return 0;
  const q = Math.max(0, Math.min(1, (frame - (durationInFrames - frames) + 1) / frames));
  return q * q * (3 - 2 * q);
}
