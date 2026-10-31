// Effect names, intensities and easings, and the checks for brand.json / platforms.json / the
// command line. No Remotion import here, so settings can be checked anywhere (the studio's server
// too); the effect modules themselves are in ./index.ts (their names must match EFFECT_NAMES, tested).
export type Intensity = "subtle" | "balanced" | "expressive";
export const INTENSITIES: readonly Intensity[] = ["subtle", "balanced", "expressive"];
export type EasingName = "ease-in-out" | "ease-out" | "ease-in" | "linear";
export const EASING_NAMES: readonly EasingName[] = ["ease-in-out", "ease-out", "ease-in", "linear"];

// What the user picks (brand.json motion, platforms.json motion, --line-effect / --hook-effect).
// strength: the Strength slider, 0-100 % (saved as "glide:70"); instead of the named intensity when set.
export type EffectChoice = { name: string; intensity: Intensity; strength?: number; durationMs?: number; easing?: EasingName };

export const EFFECT_NAMES = ["glide", "cinematic-fade", "soft-blur", "dreamy-glow", "word-reveal", "karaoke-highlight", "floating", "typewriter", "spread", "typewriter-erase", "typewriter-words", "clarify", "ascend", "ink", "word-pop", "highlight-sweep", "mask-reveal", "tilt-3d", "glitch", "wave", "echo-stack", "slice", "kinetic-stack", "neon", "word-rise", "slide-left", "slide-right", "slide-down", "dissolve"] as const;

// What each effect is best for, shown next to its name in every list ("glide · verses").
export const EFFECT_HINTS: Record<(typeof EFFECT_NAMES)[number], string> = {
  glide: "verses",
  "cinematic-fade": "verses, slow songs",
  "soft-blur": "verses, intimate",
  "dreamy-glow": "hooks, ballads",
  "word-reveal": "hooks, fast lyrics",
  "karaoke-highlight": "hooks",
  floating: "intros, calm verses",
  typewriter: "letter by letter, story lines",
  spread: "verses, titles",
  "typewriter-erase": "story lines, intros",
  "typewriter-words": "spoken or rapid lines",
  clarify: "verses, slow songs",
  ascend: "titles, short hooks",
  ink: "script fonts, titles",
  "word-pop": "hooks, upbeat songs",
  "highlight-sweep": "hooks, sing-along lines",
  "kinetic-stack": "short punchy lines",
  "mask-reveal": "verses, clean modern look",
  "tilt-3d": "hooks, dreamy songs",
  glitch: "edgy or electronic tracks",
  neon: "night, city or synth tracks",
  "word-rise": "verses, building lines",
  "slide-left": "verses, story lines",
  "slide-right": "verses, answers to a line",
  "slide-down": "hooks, heavy drops",
  dissolve: "endings, soft or sad lines",
  wave: "playful lines, summer songs",
  "echo-stack": "hooks, repeated lines",
  slice: "intros, drops, strong lines",
};

// The name shown in the studio (the stored name stays the code name above).
export const EFFECT_TITLES: Record<(typeof EFFECT_NAMES)[number], string> = {
  glide: "Glide",
  "cinematic-fade": "Cinematic fade",
  "soft-blur": "Blur in",
  "dreamy-glow": "Dreamy glow",
  "word-reveal": "Word by word",
  "karaoke-highlight": "Karaoke",
  floating: "Float",
  typewriter: "Typewriter",
  spread: "Spread",
  "typewriter-erase": "Type and erase",
  "typewriter-words": "Type by word",
  clarify: "Focus pull",
  ascend: "Rise",
  ink: "Handwriting",
  "word-pop": "Word pop",
  "highlight-sweep": "Highlight sweep",
  "kinetic-stack": "Kinetic stack",
  "mask-reveal": "Mask reveal",
  "tilt-3d": "3D tilt",
  glitch: "Glitch",
  wave: "Wave",
  "echo-stack": "Echo stack",
  slice: "Slice",
  neon: "Neon",
  "word-rise": "Word rise",
  "slide-left": "Slide in from left",
  "slide-right": "Slide in from right",
  "slide-down": "Slide down",
  dissolve: "Dissolve",
};

// The Motion gallery's filter chips: each effect under one or more kinds.
export const EFFECT_KINDS = ["Word", "Calm", "Slide", "Bounce", "Wave", "3D", "Glitch", "Glow", "Type"] as const;
export const EFFECT_CATEGORIES: Record<(typeof EFFECT_NAMES)[number], readonly (typeof EFFECT_KINDS)[number][]> = {
  glide: ["Slide", "Calm"],
  "cinematic-fade": ["Calm"],
  "soft-blur": ["Calm"],
  "dreamy-glow": ["Calm", "Glow"],
  "word-reveal": ["Word", "Slide"],
  "karaoke-highlight": ["Word"],
  floating: ["Calm", "Wave"],
  typewriter: ["Type"],
  spread: ["Calm"],
  "typewriter-erase": ["Type"],
  "typewriter-words": ["Type", "Word"],
  clarify: ["Word", "Calm"],
  ascend: ["Wave", "Slide"],
  ink: ["Type"],
  "word-pop": ["Word", "Bounce"],
  "highlight-sweep": ["Word"],
  "kinetic-stack": ["Word", "Bounce"],
  "mask-reveal": ["Slide"],
  "tilt-3d": ["3D"],
  glitch: ["Glitch"],
  wave: ["Wave"],
  "echo-stack": ["3D", "Glitch"],
  slice: ["Glitch", "Slide"],
  neon: ["Glow", "Glitch"],
  "word-rise": ["Word", "Slide"],
  "slide-left": ["Slide"],
  "slide-right": ["Slide"],
  "slide-down": ["Slide"],
  dissolve: ["Calm", "Glow"],
};
export const effectTitle = (name: string): string => EFFECT_TITLES[name as keyof typeof EFFECT_TITLES] ?? name;

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
    throw new Error(`${where}: unknown effect "${text}". Known: ${EFFECT_NAMES.join(", ")} (optionally with :subtle, :balanced, :expressive or a strength :0-100)`);
  }
  if (/^\d{1,3}$/.test(intensity) && Number(intensity) <= 100) return { name, intensity: "balanced", strength: Number(intensity) };
  if (!INTENSITIES.includes(intensity as Intensity)) throw new Error(`${where}: intensity must be subtle, balanced or expressive, or a strength 0-100 (found "${intensity}")`);
  return { name, intensity: intensity as Intensity };
}

// Checks a choice from a JSON file ({ name, intensity?, durationMs?, easing? } or "name[:intensity]").
export function checkEffectChoice(value: unknown, where: string): EffectChoice {
  if (typeof value === "string") return parseEffectChoice(value, where);
  if (!value || typeof value !== "object") throw new Error(`${where}: must be an effect name like "glide" or { "name": "glide", "intensity": "subtle" }`);
  const v = value as Record<string, unknown>;
  const base = parseEffectChoice(`${String(v.name)}:${v.strength !== undefined ? String(v.strength) : String(v.intensity ?? "balanced")}`, where);
  if (v.durationMs !== undefined && !(typeof v.durationMs === "number" && v.durationMs >= 100 && v.durationMs <= 2000)) throw new Error(`${where}: durationMs must be 100-2000`);
  if (v.easing !== undefined && !(typeof v.easing === "string" && (EASING_NAMES as readonly string[]).includes(v.easing))) throw new Error(`${where}: easing must be ${EASING_NAMES.join(", ")}`);
  return { ...base, ...(v.durationMs !== undefined ? { durationMs: v.durationMs as number } : {}), ...(v.easing !== undefined ? { easing: v.easing as EasingName } : {}) };
}

export function choiceText(c: EffectChoice): string {
  return `${c.name}${c.strength !== undefined ? `:${c.strength}` : c.intensity !== "balanced" ? `:${c.intensity}` : ""}`;
}
