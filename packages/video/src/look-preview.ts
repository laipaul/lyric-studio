// The Style tab's Look preview (pure, browser-safe): the song's first lines timed like sung lines, the
// fonts it loads (the exact faces a render uses, nearest weight, never synthetic), what was tried in
// "Set effect" (kept per song in sessionStorage) and whether the render would add the soft backing
// behind the lyrics over the preview's frame (the same rule as the render: lyricBackingFor).
import type { FontFileRef } from "./font-files";
import { INTENSITIES, type Intensity } from "./effects/names";
import type { LyricLineProps } from "./props";
import { isThinFace, lyricBackingFor, type Readability } from "./readability";

export const LOOK_FPS = 30;
export const LOOK_LINE_FRAMES = 84; // a line every 2.8 s
export const LOOK_BAR_FRAMES = 60; // "with the beat": a downbeat every 2 s (120 BPM)

// The song's sample lines (the middle one a hook), each word ~0.35 s apart, the last word held ~1 s.
export function previewLyrics(texts: readonly string[]): LyricLineProps[] {
  return texts.map((text, k) => {
    const startFrame = 15 + k * LOOK_LINE_FRAMES;
    const stamp = startFrame + 8;
    const words = text.split(/\s+/).filter(Boolean);
    const step = Math.min(10, Math.floor(36 / Math.max(1, words.length)));
    const held = 32;
    return {
      text,
      startFrame,
      endFrame: k < texts.length - 1 ? startFrame + LOOK_LINE_FRAMES : startFrame + LOOK_LINE_FRAMES + 30,
      isHook: k === 1,
      stampFrame: stamp,
      sungEndFrame: stamp + step * (words.length - 1) + held,
      words: words.map((w, i) => ({ text: w, startFrame: stamp + step * i, endFrame: i === words.length - 1 ? stamp + step * i + held : stamp + step * (i + 1) })),
    };
  });
}
export const lookPreviewDuration = (lines: number) => Math.max(1, lines) * LOOK_LINE_FRAMES + 45;

// A font family as the Style tab lists it (StyleData.fonts).
export type CatalogFont = { family: string; faces: { weight: number; style: string; srcs: string[]; ranges?: (string | null)[] }[] };
export type PreviewFace = { family: string; weight: number; italic: boolean; files: FontFileRef[] };

// The face a render uses for family / weight / italic (as resolveFont: italic only if the family has
// one, then the nearest weight, the heavier on a tie) and its files; null when the family is unknown.
export function previewFace(fonts: readonly CatalogFont[], family: string, weight: number, italic: boolean): PreviewFace | null {
  const entry = fonts.find((f) => f.family.toLowerCase() === family.toLowerCase());
  if (!entry || !entry.faces.length) return null;
  let pool = entry.faces.filter((f) => f.style === (italic ? "italic" : "normal"));
  if (!pool.length) pool = entry.faces.filter((f) => f.style === "normal");
  if (!pool.length) pool = entry.faces;
  const face = [...pool].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || b.weight - a.weight)[0];
  const style = face.style === "italic" ? "italic" : "normal";
  return {
    family: entry.family,
    weight: face.weight,
    italic: style === "italic",
    files: face.srcs.map((src, i) => ({ family: entry.family, weight: face.weight, style, src, ...(face.ranges?.[i] ? { unicodeRange: face.ranges[i]! } : {}) })),
  };
}

// What "Set effect" tries (not saved until Save to recipe), kept per song in sessionStorage.
export type TriedAddOns = { heldGlow: boolean; chorusLift: boolean; shine: boolean; emphasis?: boolean };
export type TriedBreathe = "off" | "gentle" | "beat";
export type TriedEffect = { name: string; intensity: Intensity; breathe: TriedBreathe; addOns: TriedAddOns };
export const triedKey = (projectId: string) => `lyric-effect-try:${projectId}`;

// A stored value back (null when missing, broken or naming an effect that no longer exists).
export function parseTried(raw: string | null, effectNames: readonly string[]): TriedEffect | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Partial<TriedEffect>;
    const a = (t.addOns ?? {}) as Partial<TriedAddOns>;
    if (typeof t.name !== "string" || !effectNames.includes(t.name)) return null;
    if (!INTENSITIES.includes(t.intensity as Intensity) || !["off", "gentle", "beat"].includes(t.breathe as string)) return null;
    return { name: t.name, intensity: t.intensity as Intensity, breathe: t.breathe as TriedBreathe, addOns: { heldGlow: a.heldGlow === true, chorusLift: a.chorusLift === true, shine: a.shine === true, emphasis: a.emphasis === true } };
  } catch {
    return null;
  }
}

// Would the render add the soft backing behind the lyrics over this frame? The render's own rule
// (lyricBackingFor) for one measured frame: "strong" always, "normal" never, "auto" when the lyric colour
// or the hook accent is too low in contrast there (thin strokes need more).
export function previewBacking(
  mode: Readability | undefined,
  bandLuminance: number | null,
  look: { colour: string; accent: string; verse: { family: string; weight: number }; hook: { family: string; weight: number } },
): boolean {
  return lyricBackingFor(mode, bandLuminance === null ? [] : [bandLuminance], {
    colour: look.colour,
    accent: look.accent,
    verseThin: isThinFace(look.verse.family, look.verse.weight),
    hookThin: isThinFace(look.hook.family, look.hook.weight),
  }).backing;
}
