// Effect names, intensities and easings, and the checks for brand.json / platforms.json / the
// command line. No Remotion import here, so settings can be checked anywhere (the studio's server
// too); the effect modules themselves are in ./index.ts (their names must match EFFECT_NAMES, tested).
export type Intensity = "subtle" | "balanced" | "expressive";
export const INTENSITIES: readonly Intensity[] = ["subtle", "balanced", "expressive"];
export type EasingName = "ease-in-out" | "ease-out" | "ease-in" | "linear";
export const EASING_NAMES: readonly EasingName[] = ["ease-in-out", "ease-out", "ease-in", "linear"];

// What the user picks (brand.json motion, platforms.json motion, --line-effect / --hook-effect).
export type EffectChoice = { name: string; intensity: Intensity; durationMs?: number; easing?: EasingName };

export const EFFECT_NAMES = ["glide", "cinematic-fade", "soft-blur", "dreamy-glow", "word-reveal", "karaoke-highlight", "floating", "typewriter"] as const;

// What each effect is best for, shown next to its name in every list ("glide · verses").
export const EFFECT_HINTS: Record<(typeof EFFECT_NAMES)[number], string> = {
  glide: "verses",
  "cinematic-fade": "verses, slow songs",
  "soft-blur": "verses, intimate",
  "dreamy-glow": "hooks, ballads",
  "word-reveal": "hooks, fast lyrics",
  "karaoke-highlight": "hooks",
  floating: "intros, calm verses",
  typewriter: "spoken or rapid lines",
};

// "glide · verses", with " · brand default" when it is the artist's default for that kind of line.
export function effectOptionLabel(name: string, brandDefault?: string): string {
  const hint = EFFECT_HINTS[name as keyof typeof EFFECT_HINTS];
  return `${name}${hint ? ` · ${hint}` : ""}${brandDefault && brandDefault.split(":")[0] === name ? " · brand default" : ""}`;
}

export const DEFAULT_VERSE_EFFECT: EffectChoice = { name: "glide", intensity: "balanced" };
export const DEFAULT_HOOK_EFFECT: EffectChoice = { name: "karaoke-highlight", intensity: "balanced" };

// "glide", "glide:expressive", "karaoke-highlight:subtle" -> a checked choice (clear message otherwise).
export function parseEffectChoice(text: string, where = "effect"): EffectChoice {
  const [name, intensity = "balanced", extra] = text.trim().toLowerCase().split(":");
  if (extra !== undefined || !(EFFECT_NAMES as readonly string[]).includes(name)) {
    throw new Error(`${where}: unknown effect "${text}". Known: ${EFFECT_NAMES.join(", ")} (optionally with :subtle, :balanced or :expressive)`);
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
  if (v.easing !== undefined && !(typeof v.easing === "string" && (EASING_NAMES as readonly string[]).includes(v.easing))) throw new Error(`${where}: easing must be ${EASING_NAMES.join(", ")}`);
  return { ...base, ...(v.durationMs !== undefined ? { durationMs: v.durationMs as number } : {}), ...(v.easing !== undefined ? { easing: v.easing as EasingName } : {}) };
}

export function choiceText(c: EffectChoice): string {
  return `${c.name}${c.intensity !== "balanced" ? `:${c.intensity}` : ""}`;
}
