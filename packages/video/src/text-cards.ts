// How a title / byline / tagline card looks at a frame: without an effect it is on screen from its
// start and fades out over the last second (the YouTube title as before the textboard); with one, it
// comes in and goes like that lyric effect. Pure (the composition and the tests use it).
import { GLIDE_LIFT_PX, motionOf, resolveEffect } from "./effects";
import { clamp01, REST, type LineLook } from "./effects/types";
import { typedShare } from "./effects/typing";
import type { TextCardProps } from "./props";

export const CARD_FADE_FRAMES = 30;

// A typewriter card types its text letter by letter at a calm pace (done at the latest a second before it
// ends); "typewriter-erase" erases it over its exit. Spread opens the letters up (spacing).
export function textCardLook(card: Pick<TextCardProps, "startFrame" | "endFrame" | "effect"> & { text?: string }, frame: number, fps: number): LineLook | null {
  if (frame < card.startFrame || frame >= card.endFrame) return null;
  if (!card.effect) {
    const opacity = clamp01((card.endFrame - frame) / CARD_FADE_FRAMES);
    return opacity > 0 ? { ...REST, opacity } : null;
  }
  const own = resolveEffect(card.effect, fps);
  const m = motionOf(own, own, fps);
  const D = Math.min(m.frames, Math.max(1, Math.floor((card.endFrame - card.startFrame) / 2)));
  const p = m.ease(clamp01((frame - card.startFrame) / D));
  const q = m.ease(clamp01((frame - (card.endFrame - D)) / D));
  const enter = m.effect.enter?.(p, m.amount) ?? (m.effect.transition === "glide" ? { opacity: p, y: GLIDE_LIFT_PX * m.amount * (1 - p) } : { opacity: p });
  const exit = q > 0 ? (m.effect.exit?.(q, m.amount) ?? { opacity: 1 - q }) : {};
  const hold = m.effect.hold?.(frame, m.amount, 1.3, fps) ?? {};
  const typing = own.effect.typing;
  const letters = card.text ? [...card.text].filter((c) => c.trim()).length : 0;
  const chars = typing ? typedShare(card.startFrame, letters, frame, fps, Math.max(card.startFrame + 1, card.endFrame - fps), own.amount) * (typing.exit === "erase" ? 1 - q : 1) : undefined;
  const spacing = (enter.spacing ?? 0) + (exit.spacing ?? 0);
  // Ink: uncovered left to right at the calm pace (a little quicker), done a second before it ends.
  const reveal = own.effect.reveal ? typedShare(card.startFrame, letters, frame, fps, Math.max(card.startFrame + 1, card.endFrame - fps), own.amount * 1.3) : undefined;
  return {
    ...(reveal !== undefined && reveal < 1 ? { reveal } : {}),
    ...(enter.wave !== undefined && enter.wave < 1 && q <= 0 ? { wave: enter.wave } : {}),
    ...(chars !== undefined ? { chars } : {}),
    ...(spacing ? { spacing } : {}),
    opacity: (enter.opacity ?? 1) * (exit.opacity ?? 1),
    x: (enter.x ?? 0) + (exit.x ?? 0) + (hold.x ?? 0),
    y: (enter.y ?? 0) + (exit.y ?? 0) + (hold.y ?? 0),
    scale: (enter.scale ?? 1) * (exit.scale ?? 1) * (hold.scale ?? 1),
    blur: (enter.blur ?? 0) + (exit.blur ?? 0) + (hold.blur ?? 0),
    glow: clamp01((enter.glow ?? 0) + (exit.glow ?? 0) + (hold.glow ?? 0)),
  };
}

export * from "./card-layout";
