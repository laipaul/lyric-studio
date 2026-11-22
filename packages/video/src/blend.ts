// A dissolve never shows a frozen frame. The previous shot keeps playing `after` frames under the incoming shot (its
// tail), and the incoming shot starts `before` frames early, so both clips need spare frames around the cut. This
// makes them (pure; shared by the preview and the render because composeProps calls it):
//   1. the incoming clip starts earlier in its file (inside the user's part, then, if need be, a little before the
//      user's in point) or simply plays on from its start: its slot on the timeline and the cut stay where they are;
//   2. the previous clip, if it ends at the end of its file, is moved earlier in its file (same slot, same cut) to
//      leave frames after the cut;
//   3. what still cannot be had is cut from the dissolve (down to a hard cut). A shot that already holds its last
//      frame (a clip shorter than its shot) and a singing shot (its frame is computed from the song: never moved) get
//      a hard cut, not a dissolve over a frozen or shifted picture.
import { dissolveFrames } from "./anchors";
import { VIDEO } from "./config";
import type { ShotProps } from "./props";

export type BlendNote =
  | { shot: number; src: string; kind: "shortened"; seconds: number; side: "ends" | "starts" } // the transition into `shot` is now `seconds` long (0: a hard cut); `src` is the clip that ran out of frames
  | { shot: number; src: string; kind: "earlier"; seconds: number; into: "next" | "previous" }; // `src` starts `seconds` earlier in its file than set, to blend with the next / previous clip

const round1 = (s: number) => Math.round(s * 10) / 10;

// Frames the shot's clip still has after what the shot plays (its dissolve-in frames, its length), at its own speed.
function framesLeft(s: ShotProps, clipStart: number = s.clipStartFrame): number {
  if (s.kind === "photo") return Infinity;
  return Math.floor((s.clipDurationFrames - 1 - clipStart) / s.playbackRate) - (s.dissolve?.before ?? 0) - s.duration - (s.tail ?? 0);
}

export function blendInto(
  shots: ShotProps[],
  index: number,
  o: { bar: number; floor: number; locked: boolean; prevLocked: boolean },
): BlendNote[] {
  const shot = shots[index];
  const prev = shots[index - 1];
  const notes: BlendNote[] = [];
  const ideal = dissolveFrames(o.bar, prev.duration, shot.duration, Infinity);
  const idealTotal = ideal.before + ideal.after;
  if (!idealTotal) return notes;
  const video = (s: ShotProps) => s.kind !== "photo";

  // Singing shot in: a hard cut (its frame is the song's). A previous shot that already holds its last frame: a hard cut.
  if (o.locked) return notes;
  const prevHeld = video(prev) && prev.holdLastFrame;

  // The outgoing clip: frames after the cut, if need be by moving it earlier in its file.
  let after = prevHeld ? 0 : ideal.after;
  let shiftPrev = 0;
  if (after > 0 && video(prev)) {
    const left = framesLeft(prev);
    if (left < after) {
      if (!o.prevLocked && prev.clipStartFrame > 0) {
        shiftPrev = Math.min(prev.clipStartFrame, Math.ceil((after - left) * prev.playbackRate));
        // Whole frames of the shot, so the shift is exact at its speed.
        while (shiftPrev > 0 && framesLeft(prev, prev.clipStartFrame - shiftPrev + 1) >= after) shiftPrev--;
      }
      after = Math.max(0, Math.min(after, framesLeft(prev, prev.clipStartFrame - shiftPrev)));
    }
  }

  // The incoming clip: `before` frames before the cut.
  let before = prevHeld ? 0 : ideal.before;
  let back = 0;
  let early = false;
  if (before > 0 && video(shot)) {
    const r = shot.playbackRate;
    const c0 = shot.clipStartFrame;
    for (; before > 0; before--) {
      const b = Math.round(before * r);
      if (c0 - b >= o.floor) { back = b; break; } // inside the user's part
      if (!shot.holdLastFrame && c0 + Math.ceil((before + shot.duration - 1) * r) <= shot.clipDurationFrames - 1) break; // plays on from its start
      if (c0 - b >= 0) { back = b; early = true; break; } // a little before the user's in point
    }
  }

  const total = before + after;
  if (!total) {
    if (idealTotal) notes.push({ shot: index, src: prevHeld || after < ideal.after ? prev.src : shot.src, kind: "shortened", seconds: 0, side: prevHeld || after < ideal.after ? "ends" : "starts" });
    return notes;
  }
  if (!after) shiftPrev = 0;
  shots[index] = { ...shot, dissolve: { before, after }, ...(back > 0 ? { clipStartFrame: shot.clipStartFrame - back } : {}) };
  shots[index - 1] = { ...prev, tail: after, ...(shiftPrev > 0 ? { clipStartFrame: prev.clipStartFrame - shiftPrev } : {}) };
  if (total < idealTotal) {
    const outLimited = after < ideal.after;
    notes.push({ shot: index, src: outLimited ? prev.src : shot.src, kind: "shortened", seconds: round1(total / VIDEO.fps), side: outLimited ? "ends" : "starts" });
  }
  if (shiftPrev > 0) notes.push({ shot: index, src: prev.src, kind: "earlier", seconds: round1(shiftPrev / VIDEO.fps), into: "next" });
  if (early) notes.push({ shot: index, src: shot.src, kind: "earlier", seconds: round1(Math.max(0, o.floor - (shot.clipStartFrame - back)) / VIDEO.fps), into: "previous" });
  return notes;
}
