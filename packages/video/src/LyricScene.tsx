// Draws the lyric scene (src/effects/scene.ts) for the current frame: up to three lines (leaving,
// active, waiting next), each with its effect's look, words as separate spans for word effects.
import { measureText } from "@remotion/layout-utils";
import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

import { lyricScene, sceneTimeline } from "./effects/scene";
import { applyTextCase, layoutLyric, type LyricLayout } from "./lyrics";
import type { LyricArea } from "./platform";
import type { LyricEffectsProps, LyricLineProps, StyleProps } from "./props";

type Font = { family: string; weight: number };

const BASE_SHADOW = "0 2px 12px rgba(0,0,0,0.55)";
const SHADOWS: Record<string, string> = { none: BASE_SHADOW, shadow: "0 6px 0 rgba(0,0,0,0.35), 0 0 28px rgba(0,0,0,0.65)" };

// "#ffffff" + "#E8A3B5" at t -> "rgb(...)"
export function mixColour(a: string, b: string, t: number): string {
  const rgb = (h: string) => {
    const n = Number.parseInt(h.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [x, y] = [rgb(a), rgb(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

const rgba = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(3)})`;
};

export function LyricScene(props: {
  lyrics: readonly LyricLineProps[];
  effects: LyricEffectsProps;
  style: StyleProps;
  hookFont: { font: string; weight: number } | null;
  textSize: number;
  colour: string;
  ready: boolean;
  areaFor: (line: LyricLineProps) => LyricArea;
  glow?: string; // beat-pulsed glow (stills layout)
  showNext: boolean;
  nextScale: number;
}) {
  const { lyrics, effects, style, textSize, colour, ready, areaFor } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fontOf = (l: LyricLineProps): Font => (l.isHook && props.hookFont ? { family: props.hookFont.font, weight: props.hookFont.weight } : { family: style.font, weight: style.weight });

  const layouts = useMemo(
    () =>
      ready
        ? lyrics.map((l): LyricLayout => {
            const area = areaFor(l);
            const font = l.isHook && props.hookFont ? { family: props.hookFont.font, weight: props.hookFont.weight } : { family: style.font, weight: style.weight };
            return layoutLyric(
              applyTextCase(l.text, style.textCase),
              textSize,
              area.right - area.left,
              (t, size) => measureText({ text: t, fontFamily: font.family, fontWeight: font.weight, fontSize: size }).width,
              area.minScale,
            );
          })
        : null,
    // areaFor depends only on the props it closes over (lyric area / end screen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, lyrics, style, props.hookFont, textSize],
  );
  const timeline = useMemo(
    () =>
      layouts
        ? sceneTimeline(lyrics, {
            fps,
            durationInFrames,
            verse: effects.verse,
            hook: effects.hook,
            showNext: props.showNext,
            nextScale: props.nextScale,
            gapPx: textSize * 0.35,
            height: (i) => layouts[i].lines.length * layouts[i].fontSize * areaFor(lyrics[i]).lineHeight,
            wordCount: (i) => layouts[i].lines.join(" ").split(" ").length,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layouts, lyrics, fps, durationInFrames, effects, props.showNext, props.nextScale, textSize],
  );
  if (!layouts || !timeline) return null;

  return (
    <>
      {lyricScene(timeline, frame).map((item) => {
        const line = lyrics[item.index];
        const layout = layouts[item.index];
        // A waiting line sits under the line before it (in that line's area).
        const area = areaFor(item.role === "next" ? lyrics[item.index - 1] : line);
        const font = fontOf(line);
        const { look } = item;
        const shadows = [SHADOWS[style.effect] ?? BASE_SHADOW];
        if (look.glow > 0.001) shadows.push(`0 0 ${Math.round(16 + 34 * look.glow)}px ${rgba(effects.accent, 0.85 * look.glow)}`, `0 0 ${Math.round(6 + 10 * look.glow)}px ${rgba("#ffffff", 0.6 * look.glow)}`);
        if (props.glow) shadows.push(props.glow);
        let w = 0;
        return (
          <div
            key={`${line.startFrame}-${item.index}`}
            data-lyric={line.text}
            data-role={item.role}
            style={{
              position: "absolute",
              left: area.left,
              width: area.right - area.left,
              top: area.centerY + look.y,
              transform: `translate(${look.x.toFixed(2)}px, -50%) scale(${look.scale.toFixed(4)})`,
              textAlign: "center",
              color: colour,
              fontFamily: `"${font.family}", sans-serif`,
              fontWeight: font.weight,
              fontSize: layout.fontSize,
              lineHeight: area.lineHeight,
              textShadow: shadows.join(", "),
              opacity: look.opacity,
              filter: look.blur > 0.01 ? `blur(${look.blur.toFixed(2)}px)` : undefined,
            }}
          >
            {layout.lines.map((text, r) => (
              <div key={r} style={{ whiteSpace: "nowrap" }}>
                {item.words
                  ? text.split(" ").map((word, k) => {
                      const wl = item.words![w++] ?? item.words![item.words!.length - 1];
                      const shown = Math.round(word.length * wl.chars);
                      return (
                        <span key={k}>
                          {k > 0 ? " " : null}
                          <span
                            data-word={word}
                            style={{
                              display: "inline-block",
                              opacity: wl.opacity,
                              transform: wl.y || wl.scale !== 1 ? `translateY(${wl.y.toFixed(2)}px) scale(${wl.scale.toFixed(4)})` : undefined,
                              filter: wl.blur > 0.01 ? `blur(${wl.blur.toFixed(2)}px)` : undefined,
                              color: wl.accent > 0.001 ? mixColour(colour, effects.accent, wl.accent) : undefined,
                            }}
                          >
                            {word.slice(0, shown)}
                            {shown < word.length ? <span style={{ opacity: 0 }}>{word.slice(shown)}</span> : null}
                          </span>
                        </span>
                      );
                    })
                  : text}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
