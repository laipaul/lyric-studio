// The Shape page's one viewer plays the planned video (LyricVideo, the storyboard's props). A look change
// (fonts, effects, Breathe, add-ons, accent) is saved to song.json at once and the video is planned again;
// until the new plan arrives (and while a font pairing is only pointed at) the viewer shows the change by
// patching the planned props here, so it reacts at once. Per-line textboard looks (a card's own font or
// effect) stay as they are: they win over the song's look, as in the render.
import type { Intensity, EffectChoice } from "./effects/names";
import type { FontFileRef } from "./font-files";
import type { LyricVideoProps } from "./props";
import type { PictureProps, TitleStyle } from "./picture";

export type PatchFace = { family: string; weight: number; italic: boolean; files: FontFileRef[] };
export type LookPatch = {
  verse?: PatchFace;
  hook?: PatchFace;
  verseEffect?: string; // as saved: "glide" or "typewriter:subtle"
  hookEffect?: string;
  breathe?: "off" | "gentle" | "beat";
  heldGlow?: boolean;
  chorusLift?: boolean;
  shine?: boolean;
  emphasis?: boolean;
  accent?: string;
  colour?: string; // the theme's text colour
  picture?: Omit<PictureProps, "coverSrc">; // the theme's grade, vignette, behind the words, background without a clip
  cards?: { hook: boolean; hookStyle: TitleStyle; end: boolean; endStyle: TitleStyle }; // the theme's hook / end card on or off and their style
};

const INTENSITY: readonly Intensity[] = ["subtle", "balanced", "expressive"];

// "typewriter:subtle" -> { name, intensity }, keeping the planned timing when the effect is the same.
export function patchChoice(saved: string, before: EffectChoice | undefined): EffectChoice {
  const [name, raw = "balanced"] = saved.split(":");
  const strength = /^\d{1,3}$/.test(raw) ? Math.min(100, Number(raw)) : undefined; // the Strength slider
  const intensity = (INTENSITY as readonly string[]).includes(raw) ? (raw as Intensity) : "balanced";
  if (before && before.name === name) {
    const { strength: _s, ...rest } = before;
    return { ...rest, intensity, ...(strength !== undefined ? { strength } : {}) };
  }
  return { name, intensity, ...(strength !== undefined ? { strength } : {}) };
}

// The planned props with the look patched in. `barFrames`: the video's bars as frames (for Breathe "beat"
// and Shine when the plan had neither). Returns the same object when there is nothing to patch.
export function patchLook(props: LyricVideoProps, patch: LookPatch | null, barFrames: number[] = []): LyricVideoProps {
  if (!patch || !Object.keys(patch).length) return props;
  let next: LyricVideoProps = { ...props };
  const extra: FontFileRef[] = [];
  if (patch.verse) {
    next.style = { ...props.style, font: patch.verse.family, weight: patch.verse.weight, italic: patch.verse.italic };
    extra.push(...patch.verse.files);
  }
  if (patch.hook) {
    next.hookFont = { font: patch.hook.family, weight: patch.hook.weight, italic: patch.hook.italic };
    extra.push(...patch.hook.files);
  }
  if (extra.length) {
    const all = [...props.fonts, ...extra];
    next.fonts = all.filter((f, i) => all.findIndex((g) => g.src === f.src && g.family === f.family && g.weight === f.weight && g.style === f.style) === i);
  }
  if (patch.colour) next.colour = patch.colour;
  if (patch.picture) next.picture = { ...patch.picture, ...(props.picture?.coverSrc ? { coverSrc: props.picture.coverSrc } : {}) };
  if (patch.cards && props.textCards?.length) {
    // The planned hook / end card (always planned on Reels, TikTok, Shorts): on or off, and its style.
    const c = patch.cards;
    next.textCards = props.textCards.map((t) => {
      if (t.type !== "hook" && t.type !== "end") return t;
      const on = t.type === "hook" ? c.hook : c.end;
      const style = t.type === "hook" ? c.hookStyle : c.endStyle;
      const { off: _o, cardStyle: _s, ...rest } = t;
      return { ...rest, ...(style !== "plain" ? { cardStyle: style } : {}), ...(on ? {} : { off: true }) };
    });
  }
  const fx = props.lyricEffects;
  if (fx) {
    const e = { ...fx };
    if (patch.verseEffect) e.verse = patchChoice(patch.verseEffect, fx.verse);
    if (patch.hookEffect) e.hook = patchChoice(patch.hookEffect, fx.hook);
    if (patch.accent) e.accent = patch.accent;
    const bars = fx.downbeats ?? fx.breathe?.downbeats ?? barFrames;
    if (patch.breathe) {
      if (patch.breathe === "off") delete e.breathe;
      else e.breathe = patch.breathe === "beat" ? { mode: "beat", downbeats: bars } : { mode: "gentle" };
    }
    for (const k of ["heldGlow", "chorusLift", "shine", "emphasis"] as const) {
      if (patch[k] === undefined) continue;
      if (patch[k]) e[k] = true;
      else delete e[k];
    }
    if (e.shine && !e.downbeats) e.downbeats = bars;
    next = { ...next, lyricEffects: e };
  }
  return next;
}
