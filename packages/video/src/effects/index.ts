// The registry of lyric effects. Add a module here to make it selectable everywhere
// (brand.json, platforms.json, --line-effect / --hook-effect, pnpm effects:preview).
import { cinematicFade } from "./cinematic-fade";
import { dreamyGlow } from "./dreamy-glow";
import { floating } from "./floating";
import { glide } from "./glide";
import { karaokeHighlight } from "./karaoke-highlight";
import { softBlur } from "./soft-blur";
import { typewriter, typewriterErase, typewriterWords } from "./typewriter";
import { spread } from "./spread";
import { clarify } from "./clarify";
import { ascend } from "./ascend";
import { ink } from "./ink";
import { DEFAULT_VERSE_EFFECT } from "./names";
import { AMOUNT, EASINGS, type EffectChoice, type LyricEffect } from "./types";
import { wordReveal } from "./word-reveal";
import { TRENDING } from "./trending";
import { SLIDES } from "./slides";

export * from "./types";
export * from "./names";
export { GLIDE_LIFT_PX } from "./glide";
export { SOFT_BLUR_MAX_PX } from "./soft-blur";
export * from "./typing";
export * from "./breathe";
export { ascendLetter, ASCEND_LIFT_PX } from "./ascend";
export { inkMask } from "./ink";
export * from "./accents";
export { kineticAt, kineticGroups, POP_FRAMES } from "./trending";

export const EFFECTS: readonly LyricEffect[] = [glide, cinematicFade, softBlur, dreamyGlow, wordReveal, karaokeHighlight, floating, typewriter, spread, typewriterErase, typewriterWords, clarify, ascend, ink, ...TRENDING, ...SLIDES];
const BY_NAME = new Map(EFFECTS.map((e) => [e.name, e]));

// A plain fade, used to move lines when both verse and hook effects are word effects.
const FADE: LyricEffect = {
  name: "fade",
  label: "Fade",
  description: "plain fade",
  unit: "line",
  transition: "swap",
  defaults: { durationMs: 600, easing: "ease-in-out" },
  enter: (p) => ({ opacity: p }),
  exit: (q) => ({ opacity: 1 - q }),
};

export function lyricEffect(name: string): LyricEffect | undefined {
  return BY_NAME.get(name);
}

// An effect with its parameters filled in.
export type ResolvedEffect = { effect: LyricEffect; amount: number; frames: number; ease: (t: number) => number };

export function resolveEffect(choice: EffectChoice, fps: number): ResolvedEffect {
  const effect = BY_NAME.get(choice.name) ?? BY_NAME.get(DEFAULT_VERSE_EFFECT.name)!;
  return {
    effect,
    amount: AMOUNT[choice.intensity] ?? 1,
    frames: Math.max(4, Math.round(((choice.durationMs ?? effect.defaults.durationMs) * fps) / 1000)),
    ease: EASINGS[choice.easing ?? effect.defaults.easing],
  };
}

// How a line moves: its own effect, or, for a word effect that inherits, the verse effect (and a
// plain fade if that is a word effect too).
export function motionOf(own: ResolvedEffect, verse: ResolvedEffect, fps: number): ResolvedEffect {
  if (own.effect.transition !== "inherit") return own;
  if (verse.effect.transition !== "inherit") return verse;
  return { effect: FADE, amount: 1, frames: Math.round((FADE.defaults.durationMs * fps) / 1000), ease: EASINGS["ease-in-out"] };
}
