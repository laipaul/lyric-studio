// Draws the lyric scene (src/effects/scene.ts) for the current frame: up to three lines (leaving,
// active, waiting next), each with its effect's look, words as separate spans for word effects.
import { measureText } from "@remotion/layout-utils";
import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

import { lyricScene, sceneTimeline } from "./effects/scene";
import { ascendLetter } from "./effects/ascend";
import { inkMask } from "./effects/ink";
import { AMOUNT } from "./effects/types";
import { applyTextCase, layoutLyric, type LyricLayout } from "./lyrics";
import type { LyricArea } from "./platform";
import type { LyricEffectsProps, LyricLineProps, StyleProps } from "./props";

type Font = { family: string; weight: number; italic?: boolean };

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
  hookFont: { font: string; weight: number; italic?: boolean } | null;
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
  // A textboard card may set the line's own font, size and place.
  const fontOf = (l: LyricLineProps): Font =>
    l.card?.font
      ? { family: l.card.font.family, weight: l.card.font.weight, italic: l.card.font.italic === true }
      : l.isHook && props.hookFont
        ? { family: props.hookFont.font, weight: props.hookFont.weight, italic: props.hookFont.italic === true }
        : { family: style.font, weight: style.weight, italic: style.italic === true };
  const placeOf = (l: LyricLineProps): LyricArea => {
    const a = areaFor(l);
    return l.card?.centerY !== undefined ? { ...a, centerY: l.card.centerY } : a;
  };

  const layouts = useMemo(
    () =>
      ready
        ? lyrics.map((l): LyricLayout => {
            const area = areaFor(l);
            const font = fontOf(l);
            return layoutLyric(
              applyTextCase(l.text, style.textCase),
              Math.round(textSize * (l.card?.scale ?? 1)),
              area.right - area.left,
              (t, size) => measureText({ text: t, fontFamily: font.family, fontWeight: font.weight, fontSize: size, ...(font.italic ? { additionalStyles: { fontStyle: "italic" } } : {}) }).width,
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
            height: (i) => layouts[i].lines.length * layouts[i].fontSize * placeOf(lyrics[i]).lineHeight,
            wordCount: (i) => layouts[i].lines.join(" ").split(" ").length,
            wordLetters: (i) => layouts[i].lines.join(" ").split(" ").map((w) => [...w].length),
            breathe: effects.breathe ?? null,
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
        const area = placeOf(item.role === "next" ? lyrics[item.index - 1] : line);
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
              fontStyle: font.italic ? "italic" : "normal",
              fontSynthesis: "none", // the exact file: never a fake bold or italic
              fontSize: layout.fontSize,
              lineHeight: area.lineHeight,
              textShadow: shadows.join(", "),
              opacity: look.opacity,
              filter: look.blur > 0.01 ? `blur(${look.blur.toFixed(2)}px)` : undefined,
              letterSpacing: look.spacing ? `${look.spacing.toFixed(4)}em` : undefined,
            }}
          >
            {layout.lines.map((text, r) => (
              <div key={r} style={{ whiteSpace: "nowrap", ...(look.reveal !== undefined ? rowMask(layout.lines, r, look.reveal) : {}) }}>
                {item.words
                  ? text.split(" ").map((word, k) => {
                      const wl = item.words![w++] ?? item.words![item.words!.length - 1];
                      const letters = [...word];
                      const shown = Math.round(letters.length * wl.chars);
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
                            {letters.slice(0, shown).join("")}
                            {(wl.cursor ?? 0) > 0.001 ? <Cursor opacity={wl.cursor!} colour={effects.accent} /> : null}
                            {shown < letters.length ? <span style={{ opacity: 0 }}>{letters.slice(shown).join("")}</span> : null}
                          </span>
                        </span>
                      );
                    })
                  : look.wave !== undefined
                    ? waveLetters(layout.lines, r, look.wave, AMOUNT[(line.card?.effect ?? (line.isHook ? effects.hook : effects.verse)).intensity] ?? 1)
                    : text}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// The typewriter's cursor: a thin bar in the accent colour after the last typed letter, taking no room
// (the line's layout never shifts while it is typed).
function Cursor({ opacity, colour }: { opacity: number; colour: string }) {
  return (
    <span
      data-cursor
      style={{ display: "inline-block", width: 0, height: "0.95em", verticalAlign: "-0.12em", overflow: "visible", position: "relative" }}
    >
      <span style={{ position: "absolute", left: "0.04em", top: 0, bottom: 0, width: "0.07em", background: colour, opacity, borderRadius: "0.03em" }} />
    </span>
  );
}

// Ascend: each letter of row r drawn on its own, rising into place in a wave across the whole line.
function waveLetters(rows: readonly string[], r: number, wave: number, amount: number) {
  const n = rows.reduce((a, row) => a + [...row].length, 0);
  const before = rows.slice(0, r).reduce((a, row) => a + [...row].length, 0);
  return [...rows[r]].map((ch, k) => {
    const { y, opacity } = ascendLetter(before + k, n, wave, amount);
    return (
      <span key={k} style={{ display: "inline-block", whiteSpace: "pre", transform: y > 0.01 ? `translateY(${y.toFixed(2)}px)` : undefined, opacity }}>
        {ch}
      </span>
    );
  });
}

// Ink: row r uncovered left to right, its share of the line's revealed letters (row after row).
function rowMask(rows: readonly string[], r: number, reveal: number): React.CSSProperties {
  const sizes = rows.map((row) => [...row].length);
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  const before = sizes.slice(0, r).reduce((a, b) => a + b, 0);
  const share = Math.min(1, Math.max(0, (reveal * total - before) / (sizes[r] || 1)));
  const mask = inkMask(share);
  return mask ? { maskImage: mask, WebkitMaskImage: mask } : {};
}
