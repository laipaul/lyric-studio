// The registry of lyric effects. Add a module here to make it selectable everywhere
// (brand.json, platforms.json, --line-effect / --hook-effect, pnpm effects:preview).
import { cinematicFade } from "./cinematic-fade";
import { dreamyGlow } from "./dreamy-glow";
import { floating } from "./floating";
import { glide } from "./glide";
import { karaokeHighlight } from "./karaoke-highlight";
import { softBlur } from "./soft-blur";
import { typewriter } from "./typewriter";
import { AMOUNT, EASINGS, INTENSITIES, type EasingName, type EffectChoice, type Intensity, type LyricEffect } from "./types";
import { wordReveal } from "./word-reveal";

export * from "./types";
export { GLIDE_LIFT_PX } from "./glide";
export { SOFT_BLUR_MAX_PX } from "./soft-blur";

export const EFFECTS: readonly LyricEffect[] = [glide, cinematicFade, softBlur, dreamyGlow, wordReveal, karaokeHighlight, floating, typewriter];
const BY_NAME = new Map(EFFECTS.map((e) => [e.name, e]));

export const DEFAULT_VERSE_EFFECT: EffectChoice = { name: "glide", intensity: "balanced" };
export const DEFAULT_HOOK_EFFECT: EffectChoice = { name: "karaoke-highlight", intensity: "balanced" };

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

// "glide", "glide:expressive", "karaoke-highlight:subtle" -> a checked choice (clear message otherwise).
export function parseEffectChoice(text: string, where = "effect"): EffectChoice {
  const [name, intensity = "balanced", extra] = text.trim().toLowerCase().split(":");
  if (extra !== undefined || !BY_NAME.has(name)) {
    throw new Error(`${where}: unknown effect "${text}". Known: ${EFFECTS.map((e) => e.name).join(", ")} (optionally with :subtle, :balanced or :expressive)`);
  }
  if (!INTENSITIES.includes(intensity as Intensity)) throw new Error(`${where}: intensity must be subtle, balanced or expressive (found "${intensity}")`);
  return { name, intensity: intensity as Intensity };
}

// Checks a choice from a JSON file ({ name, intensity?, durationMs?, easing? } or "name[:intensity]").
export function checkEffectChoice(value: unknown, where: string): EffectChoice {
  if (typeof value === "string") return parseEffectChoice(value, where);
  if (!value || typeof value !== "object") throw new Error(`${where}: must be an effect name like "glide" or { "name": "glide", "intensity": "subtle" }`);
  const v = value as Record<string, unknown>;
  const base = parseEffectChoice(`${String(v.name)}:${String(v.intensity ?? "balanced")}`, where);
  if (v.durationMs !== undefined && !(typeof v.durationMs === "number" && v.durationMs >= 100 && v.durationMs <= 2000)) throw new Error(`${where}: durationMs must be 100-2000`);
  if (v.easing !== undefined && !(typeof v.easing === "string" && v.easing in EASINGS)) throw new Error(`${where}: easing must be ${Object.keys(EASINGS).join(", ")}`);
  return { ...base, ...(v.durationMs !== undefined ? { durationMs: v.durationMs as number } : {}), ...(v.easing !== undefined ? { easing: v.easing as EasingName } : {}) };
}

export function choiceText(c: EffectChoice): string {
  return `${c.name}${c.intensity !== "balanced" ? `:${c.intensity}` : ""}`;
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
