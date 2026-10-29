// How a title / byline / tagline card looks at a frame: without an effect it is on screen from its
// start and fades out over the last second (the YouTube title as before the textboard); with one, it
// comes in and goes like that lyric effect. Pure (the composition and the tests use it).
import { GLIDE_LIFT_PX, motionOf, resolveEffect } from "./effects";
import { clamp01, REST, type LineLook } from "./effects/types";
import type { TextCardProps } from "./props";

export const CARD_FADE_FRAMES = 30;

export function textCardLook(card: Pick<TextCardProps, "startFrame" | "endFrame" | "effect">, frame: number, fps: number): LineLook | null {
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
  return {
    opacity: (enter.opacity ?? 1) * (exit.opacity ?? 1),
    x: (enter.x ?? 0) + (exit.x ?? 0) + (hold.x ?? 0),
    y: (enter.y ?? 0) + (exit.y ?? 0) + (hold.y ?? 0),
    scale: (enter.scale ?? 1) * (exit.scale ?? 1) * (hold.scale ?? 1),
    blur: (enter.blur ?? 0) + (exit.blur ?? 0) + (hold.blur ?? 0),
    glow: clamp01((enter.glow ?? 0) + (exit.glow ?? 0) + (hold.glow ?? 0)),
  };
}

// Where the title / byline / tagline blocks sit on the frame (for QA and the cover): each root card with
// the cards stacked under it, as the composition draws them (full-width blocks, centred text that wraps
// at the frame's width). `measure` gives a card's one-line width in px (letter spacing included).
export const CARD_LINE_HEIGHT = 1.2;
export function cardBlocks(
  cards: readonly Pick<TextCardProps, "id" | "type" | "text" | "size" | "stackOn" | "top" | "centerY" | "letterSpacing" | "upper" | "startFrame" | "endFrame">[],
  format: { width: number; height: number },
  measure: (card: { text: string; size: number; letterSpacing: number; upper: boolean }) => number,
): { ids: string[]; text: string; box: { left: number; top: number; right: number; bottom: number }; endFrame: number }[] {
  const shown = new Set(cards.map((c) => c.id));
  const roots = cards.filter((c) => !c.stackOn || !shown.has(c.stackOn));
  return roots.map((root) => {
    const parts = [root, ...cards.filter((c) => c.stackOn === root.id)];
    let height = 0;
    let widest = 0;
    parts.forEach((c, i) => {
      const w = measure({ text: c.text, size: c.size, letterSpacing: c.letterSpacing, upper: c.upper });
      const lines = Math.max(1, Math.ceil(w / format.width));
      widest = Math.max(widest, Math.min(w, format.width));
      height += lines * c.size * CARD_LINE_HEIGHT + (i > 0 ? root.size * 0.25 : 0);
    });
    const top = root.top ?? (root.centerY ?? format.height / 2) - height / 2;
    const left = (format.width - widest) / 2;
    return { ids: parts.map((p) => p.id), text: parts.map((p) => p.text).join(" / "), box: { left, top, right: left + widest, bottom: top + height }, endFrame: Math.max(...parts.map((p) => p.endFrame)) };
  });
}

// The 3:4 area of a 9:16 frame that Instagram shows on the profile grid (centred).
export function gridCrop(format: { width: number; height: number }): { top: number; bottom: number } {
  const h = Math.min(format.height, Math.round((format.width * 4) / 3));
  const top = Math.round((format.height - h) / 2);
  return { top, bottom: top + h };
}
