// The Style tab's Look preview: the song's first lines (the middle one a chorus) drawn by the video's own
// LyricScene (effects, Breathe, add-ons, accent), in the song's verse and hook fonts (the exact files),
// at the video's text size and lyric area, over a frame of the song's clips, with the video's soft
// backing when the render would add it. Nothing here is drawn differently from the video.
import { useMemo } from "react";
import { AbsoluteFill, Img } from "remotion";

import type { EffectChoice } from "./effects/names";
import type { FontFileRef } from "./font-files";
import { useFonts } from "./fonts";
import { LOOK_BAR_FRAMES, type TriedAddOns, type TriedBreathe } from "./look-preview";
import { LyricBacking } from "./LyricBacking";
import { LyricScene } from "./LyricScene";
import { fallbackBackground, gradeLook, vignetteBackground, type PictureProps } from "./picture";
import { DEFAULT_LYRIC_AREA, type LyricArea } from "./platform";
import type { LyricLineProps } from "./props";

export type LookFace = { family: string; weight: number; italic: boolean };
export type LookPreviewProps = {
  mediaBaseUrl: string; // the font files' base (the Style tab: /api/fonts)
  fonts: FontFileRef[];
  background: string | null; // a URL (a frame of the song's clips or the cover); null: a dark gradient
  lyrics: LyricLineProps[];
  effect: EffectChoice;
  breathe: TriedBreathe;
  addOns: TriedAddOns;
  verse: LookFace;
  hook: LookFace;
  accent: string;
  colour: string;
  textSize: number;
  area: LyricArea | null; // the platform's lyric area (1080x1920); null: the default
  backing: boolean; // the render's soft backing behind the lyrics (readability)
  picture?: PictureProps | null; // the theme's grade, vignette, behind the words and background without a clip
};

export function LookPreview(p: LookPreviewProps) {
  const ready = useFonts(p.mediaBaseUrl, p.fonts);
  const downbeats = useMemo(() => Array.from({ length: 12 }, (_, k) => k * LOOK_BAR_FRAMES), []);
  const area = p.area ?? DEFAULT_LYRIC_AREA;
  const grade = gradeLook(p.picture?.grade);
  const vignette = vignetteBackground(p.picture?.vignette);
  const hookFont = useMemo(() => ({ font: p.hook.family, weight: p.hook.weight, italic: p.hook.italic }), [p.hook.family, p.hook.weight, p.hook.italic]);
  const style = useMemo(
    () => ({ name: "Simple", font: p.verse.family, weight: p.verse.weight, italic: p.verse.italic, textCase: "none" as const, effect: "none" as const, animation: "none" as const }),
    [p.verse.family, p.verse.weight, p.verse.italic],
  );
  return (
    <AbsoluteFill style={{ background: p.background ? "#000" : p.picture ? fallbackBackground(p.picture) : "radial-gradient(ellipse at 50% 40%, #3a2630 0%, #141417 60%, #0b0b0d 100%)" }}>
      {p.background ? <Img src={p.background} style={{ width: "100%", height: "100%", objectFit: "cover", filter: grade.filter }} /> : null}
      {p.background && grade.veil ? <AbsoluteFill data-grade={p.picture?.grade} style={{ backgroundColor: grade.veil.colour, mixBlendMode: grade.veil.blend }} /> : null}
      {vignette ? <AbsoluteFill data-vignette={p.picture?.vignette} style={{ background: vignette }} /> : null}
      {p.backing || p.picture?.backing === "band" ? <LyricBacking area={area} height={1920} /> : null}
      <LyricScene
        lyrics={p.lyrics}
        effects={{
          verse: p.effect,
          hook: p.effect,
          accent: p.accent,
          ...(p.breathe !== "off" ? { breathe: p.breathe === "beat" ? { mode: "beat", downbeats } : { mode: "gentle" } } : {}),
          heldGlow: p.addOns.heldGlow,
          chorusLift: p.addOns.chorusLift,
          shine: p.addOns.shine,
          downbeats,
        }}
        style={style}
        hookFont={hookFont}
        textSize={p.textSize}
        colour={p.colour}
        ready={ready}
        areaFor={() => area}
        showNext={false}
        nextScale={0.55}
        backing={p.picture?.backing}
      />
    </AbsoluteFill>
  );
}
