// Draws the lyric scene (src/effects/scene.ts) for the current frame: up to three lines (leaving,
// active, waiting next), each with its effect's look, words as separate spans for word effects.
import { measureText } from "@remotion/layout-utils";
import { useMemo, type CSSProperties } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

import { lyricScene, sceneTimeline, wordTimings } from "./effects/scene";
import { kineticAt, kineticGroups } from "./effects/trending";
import { EMPHASIS_SCALE, emphasisWord } from "./effects/accents";
import { ascendLetter } from "./effects/ascend";
import { inkMask } from "./effects/ink";
import { AMOUNT } from "./effects/types";
import { applyTextCase, layoutLyric, type LyricLayout } from "./lyrics";
import type { LyricArea } from "./platform";
import { backingShadow, BOX_STYLE, type TextBacking } from "./picture";
import type { LyricEffectsProps, LyricLineProps, StyleProps } from "./props";

type Font = { family: string; weight: number; italic?: boolean };

const BASE_SHADOW = "0 2px 12px rgba(0,0,0,0.55)";
// "box": each printed row on its own dark rounded box (centred, as wide as its words).
const BOX_ROW: CSSProperties = { ...BOX_STYLE, width: "fit-content", marginLeft: "auto", marginRight: "auto" };
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
  backing?: TextBacking; // the theme's "behind the words" (src/picture.ts): shadow, glow, box
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
            accents: effects.heldGlow || effects.chorusLift || effects.shine ? { heldGlow: effects.heldGlow, chorusLift: effects.chorusLift, shine: effects.shine, downbeats: effects.downbeats } : null,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layouts, lyrics, fps, durationInFrames, effects, props.showNext, props.nextScale, textSize],
  );
  if (!layouts || !timeline) return null;

  // Kinetic stack: one or two big words at a time (each on its own row), popping in on the voice.
  const t0 = (item: { index: number }) => !!timeline.own[item.index].effect.kinetic;
  const kineticBlock = (line: LyricLineProps, layout: LyricLayout, item: { index: number; words: unknown }, f: number, font: Font, area: LyricArea) => {
    const words = layout.lines.join(" ").split(" ").filter(Boolean);
    if (!words.length) return null;
    const groups = kineticGroups(words);
    const starts = wordTimings(timeline, item.index).map((w) => w.startFrame);
    const { group, pop } = kineticAt(groups, starts, f);
    const shown = groups[group].map((k) => words[k]);
    const width = area.right - area.left;
    const measure = (t: string, size: number) => measureText({ text: t, fontFamily: font.family, fontWeight: font.weight, fontSize: size, ...(font.italic ? { additionalStyles: { fontStyle: "italic" } } : {}) }).width;
    const big = layout.fontSize * 1.9;
    const size = Math.max(layout.fontSize, Math.min(big, ...shown.map((t) => (big * width * 0.92) / Math.max(1, measure(t, big)))));
    const k = 0.75 + 0.25 * pop + 0.1 * Math.sin(Math.PI * pop);
    return (
      <div data-kinetic={shown.join(" ")} style={{ fontSize: size, lineHeight: 1.02, transform: `scale(${k.toFixed(4)})`, opacity: Math.min(1, 0.2 + pop * 1.6) }}>
        {shown.map((t, i) => (
          <div key={i} style={{ whiteSpace: "nowrap", ...(line.isHook && i === shown.length - 1 ? {} : {}) }}>
            {t}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      {lyricScene(timeline, frame).map((item) => {
        const line = lyrics[item.index];
        const layout = layouts[item.index];
        // A waiting line sits under the line before it (in that line's area).
        const area = placeOf(item.role === "next" ? lyrics[item.index - 1] : line);
        const font = fontOf(line);
        const { look } = item;
        const shadows = [style.effect !== "none" && SHADOWS[style.effect] ? SHADOWS[style.effect] : backingShadow(props.backing, effects.accent)];
        if (look.glow > 0.001) shadows.push(`0 0 ${Math.round(16 + 34 * look.glow)}px ${rgba(effects.accent, 0.85 * look.glow)}`, `0 0 ${Math.round(6 + 10 * look.glow)}px ${rgba("#ffffff", 0.6 * look.glow)}`);
        if (props.glow) shadows.push(props.glow);
        // Glitch: red / cyan copies; Echo stack: faint copies stacked under the line.
        if (look.split) shadows.push(`${look.split.toFixed(1)}px 0 0 rgba(255,0,80,0.75)`, `${(-look.split).toFixed(1)}px 0 0 rgba(0,220,255,0.75)`);
        if (look.echo) [0.42, 0.24, 0.12].forEach((a, k) => shadows.push(`0 ${((k + 1) * layout.fontSize * 0.62 * look.echo!).toFixed(1)}px 0 ${rgba(colour, a * Math.min(1, look.echo! * 1.6))}`));
        const tilt = look.tiltX || look.tiltY ? ` perspective(900px) rotateX(${(look.tiltX ?? 0).toFixed(2)}deg) rotateY(${(look.tiltY ?? 0).toFixed(2)}deg)` : "";
        const rise = look.rise ? Math.min(1, look.rise) : 0;
        const kinetic = t0(item) && item.role !== "next" ? kineticBlock(line, layout, item, frame, font, area) : null;
        let w = 0;
        let pw = 0; // the plain text's word counter (Emphasis word)
        // Emphasis word: the line's key word in the hook font, a touch bigger, in the accent colour.
        const allWords = layout.lines.join(" ").split(" ");
        const emph = effects.emphasis && item.role !== "next" ? emphasisWord(allWords, line.words?.length === allWords.length ? line.words : null) : -1;
        const hookFace = props.hookFont ? { fontFamily: `"${props.hookFont.font}", sans-serif`, fontWeight: props.hookFont.weight, fontStyle: props.hookFont.italic ? "italic" : "normal" } : {};
        const emphStyle: CSSProperties = { ...hookFace, color: effects.accent };
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
              transform: `translate(${look.x.toFixed(2)}px, -50%)${rise ? ` translateY(${(rise * 100).toFixed(2)}%)` : ""}${tilt} scale(${look.scale.toFixed(4)})`,
              clipPath: rise ? `inset(0 0 ${(rise * 100).toFixed(2)}% 0)` : undefined,
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
            {kinetic ?? (
            <div style={look.slice ? { clipPath: "inset(0 0 50% 0)", transform: `translateX(${look.slice.toFixed(1)}px)` } : undefined}>
            {layout.lines.map((text, r) => (
              <div key={r} style={{ whiteSpace: "nowrap", ...(props.backing === "box" && item.role !== "next" ? BOX_ROW : {}), ...(look.reveal !== undefined ? rowMask(layout.lines, r, look.reveal) : {}) }}>
                {item.words
                  ? text.split(" ").map((word, k) => {
                      const isEm = w === emph;
                      const wl = item.words![w++] ?? item.words![item.words!.length - 1];
                      const letters = [...word];
                      const shown = Math.round(letters.length * wl.chars);
                      return (
                        <span key={k}>
                          {k > 0 ? " " : null}
                          <span
                            data-word={word}
                            data-emphasis={isEm || undefined}
                            style={{
                              display: "inline-block",
                              opacity: wl.opacity,
                              ...(isEm ? emphStyle : {}),
                              transform: wl.y || wl.scale !== 1 || isEm ? `translateY(${wl.y.toFixed(2)}px) scale(${(wl.scale * (isEm ? EMPHASIS_SCALE : 1)).toFixed(4)})` : undefined,
                              filter: wl.blur > 0.01 ? `blur(${wl.blur.toFixed(2)}px)` : undefined,
                              color: wl.accent > 0.001 ? mixColour(colour, effects.accent, wl.accent) : (wl.glow ?? 0) > 0.001 ? mixColour(colour, effects.accent, 0.35 * wl.glow!) : undefined,
                              textShadow: (wl.glow ?? 0) > 0.001 ? `${shadows.join(", ")}, 0 0 ${Math.round(14 + 30 * wl.glow!)}px ${rgba(effects.accent, 0.9 * wl.glow!)}, 0 0 ${Math.round(4 + 8 * wl.glow!)}px ${rgba("#ffffff", 0.7 * wl.glow!)}` : undefined,
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
                    : look.ripple !== undefined
                      ? rippleLetters(layout.lines, r, look.ripple, look.rippleAmp ?? 6)
                      : emph >= 0
                        ? text.split(" ").map((word, k) => {
                            const isEm = pw++ === emph;
                            return (
                              <span key={k}>
                                {k > 0 ? " " : null}
                                {isEm ? (
                                  <span data-emphasis style={{ display: "inline-block", ...emphStyle, transform: `scale(${EMPHASIS_SCALE})` }}>
                                    {word}
                                  </span>
                                ) : (
                                  word
                                )}
                              </span>
                            );
                          })
                        : text}
              </div>
            ))}
            </div>
            )}
            {look.slice && !kinetic ? (
              // Slice: the bottom half, pushed the other way.
              <div aria-hidden data-slice style={{ position: "absolute", inset: 0, clipPath: "inset(50% 0 0 0)", transform: `translateX(${(-look.slice).toFixed(1)}px)` }}>
                {layout.lines.map((text, r) => (
                  <div key={r} style={{ whiteSpace: "nowrap" }}>
                    {text}
                  </div>
                ))}
              </div>
            ) : null}
            {look.shine !== undefined && (!item.words || item.words.every((wd) => wd.chars >= 1)) ? (
              <div
                aria-hidden
                data-shine
                style={{
                  position: "absolute",
                  inset: 0,
                  color: "transparent",
                  textShadow: "none",
                  pointerEvents: "none",
                  backgroundImage: `linear-gradient(105deg, transparent ${(look.shine * 130 - 30).toFixed(1)}%, rgba(255,255,255,0.95) ${(look.shine * 130 - 15).toFixed(1)}%, transparent ${(look.shine * 130).toFixed(1)}%)`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                }}
              >
                {layout.lines.map((text, r) => (
                  <div key={r} style={{ whiteSpace: "nowrap" }}>
                    {text}
                  </div>
                ))}
              </div>
            ) : null}
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

// Wave: each letter of row r rides a gentle wave running along the line.
function rippleLetters(rows: readonly string[], r: number, phase: number, amp: number) {
  const before = rows.slice(0, r).reduce((a, row) => a + [...row].length, 0);
  return [...rows[r]].map((ch, k) => {
    const y = amp * Math.sin(phase - (before + k) * 0.55);
    return (
      <span key={k} style={{ display: "inline-block", whiteSpace: "pre", transform: `translateY(${y.toFixed(2)}px)` }}>
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
