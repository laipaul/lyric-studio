// A font pairing as it looks in a video (Style tab cards): a real verse line and a real hook line of the
// song, together, with the video's own text layout (layoutLyric), size, weight, italic, shadow and the
// hook effect's accent colour (karaoke: the sung words), over a frame from the song's clips. The font
// files are the exact ones a render loads (never a synthetic bold or italic).
import { measureText } from "@remotion/layout-utils";
import { useMemo } from "react";
import { AbsoluteFill, Img } from "remotion";

import type { FontFileRef } from "./font-files";
import { useFonts } from "./fonts";
import { layoutLyric } from "./lyrics";
import type { LyricArea } from "./platform";

export type PairFontProps = { family: string; weight: number; italic: boolean };
export type PairPreviewProps = {
  mediaBaseUrl: string; // the font files' base (the Style tab: /api/fonts)
  fonts: FontFileRef[];
  background: string | null; // a URL (a clip frame or the cover)
  verse: { text: string; font: PairFontProps };
  hook: { text: string; font: PairFontProps; highlightWords: number }; // highlightWords: sung so far (karaoke), 0 = none
  textSize: number;
  area: LyricArea; // the platform's lyric area (1080x1920)
  colour: string;
  accent: string;
};

const SHADOW = "0 2px 12px rgba(0,0,0,0.55)"; // the Simple style's (LyricVideo textShadows.none)

function Block({ text, font, size, area, top, colour, accent, highlight, ready }: { text: string; font: PairFontProps; size: number; area: LyricArea; top: number; colour: string; accent: string; highlight: number; ready: boolean }) {
  const width = area.right - area.left;
  const layout = useMemo(
    () => (ready ? layoutLyric(text, size, width, (t, s) => measureText({ text: t, fontFamily: font.family, fontWeight: font.weight, fontSize: s, ...(font.italic ? { additionalStyles: { fontStyle: "italic" } } : {}) }).width, area.minScale) : null),
    [ready, text, size, width, font.family, font.weight, font.italic, area.minScale],
  );
  if (!layout) return null;
  let word = 0;
  return (
    <div
      style={{
        position: "absolute", left: area.left, width, top, transform: "translateY(-50%)", textAlign: "center", color: colour,
        fontFamily: `"${font.family}", sans-serif`, fontWeight: font.weight, fontStyle: font.italic ? "italic" : "normal", fontSynthesis: "none",
        fontSize: layout.fontSize, lineHeight: area.lineHeight, textShadow: SHADOW,
      }}
    >
      {layout.lines.map((line, i) => (
        <div key={i}>
          {line.split(" ").map((w, k) => (
            <span key={k} style={{ color: word++ < highlight ? accent : colour }}>
              {w}
              {k < line.split(" ").length - 1 ? " " : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PairPreview(props: PairPreviewProps) {
  const ready = useFonts(props.mediaBaseUrl, props.fonts);
  const { area } = props;
  const gap = props.textSize * area.lineHeight * 1.6; // the verse line above the centre, the hook below it
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {props.background ? <Img src={props.background} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      <Block text={props.verse.text} font={props.verse.font} size={props.textSize} area={area} top={area.centerY - gap / 2} colour={props.colour} accent={props.accent} highlight={0} ready={ready} />
      <Block text={props.hook.text} font={props.hook.font} size={props.textSize} area={area} top={area.centerY + gap / 2} colour={props.colour} accent={props.accent} highlight={props.hook.highlightWords} ready={ready} />
    </AbsoluteFill>
  );
}
