// The textboard's title, byline and tagline cards and the theme's hook / end cards, drawn over the picture.
// Shared by the current renderer (LyricVideo.tsx) and the HyperFrames text layer (src/hf/text-runtime.tsx):
// the same code draws them in both.
import { useCurrentFrame, useVideoConfig } from "remotion";

import { ascendLetter } from "./effects/ascend";
import { inkMask } from "./effects/ink";
import { REST, type LineLook } from "./effects/types";
import { titleStyleCss, warpLetter } from "./picture";
import { CARD_LINE_HEIGHT } from "./card-layout";
import type { Format } from "./platform";
import type { LyricVideoProps, TextCardProps } from "./props";
import { textCardLook } from "./text-cards";

// A typewriter card: the letters typed so far (spaces come with them), the rest kept invisible so the
// block never shifts, and a thin cursor while it types.
function TypedText({ text, share }: { text: string; share: number }) {
  const chars = [...text];
  const letters = chars.filter((c) => c.trim()).length;
  let n = Math.round(letters * share);
  let cut = 0;
  while (cut < chars.length && (n > 0 || !chars[cut].trim())) {
    if (chars[cut].trim()) n -= 1;
    cut += 1;
  }
  return (
    <>
      {chars.slice(0, cut).join("")}
      {share > 0 && share < 1 ? <span data-cursor style={{ display: "inline-block", width: 0, height: "0.9em", verticalAlign: "-0.1em", position: "relative" }}><span style={{ position: "absolute", left: "0.04em", top: 0, bottom: 0, width: "0.06em", background: "currentColor" }} /></span> : null}
      {cut < chars.length ? <span style={{ opacity: 0 }}>{chars.slice(cut).join("")}</span> : null}
    </>
  );
}

// An ascend card: its letters rising into place one after another (spaces and line breaks kept).
function WaveText({ text, wave }: { text: string; wave: number }) {
  const chars = [...text];
  return (
    <>
      {chars.map((ch, k) => {
        if (ch === "\n") return <br key={k} />;
        const { y, opacity } = ascendLetter(k, chars.length, wave, 1);
        return (
          <span key={k} style={{ display: "inline-block", whiteSpace: "pre", transform: y > 0.01 ? `translateY(${y.toFixed(2)}px)` : undefined, opacity }}>
            {ch}
          </span>
        );
      })}
    </>
  );
}

// The title's shape (arc, wave): each letter lifted and turned on its row.
function WarpedText({ text, warp, size }: { text: string; warp: NonNullable<NonNullable<LyricVideoProps["picture"]>["titleWarp"]>; size: number }) {
  return (
    <>
      {text.split("\n").map((row, r) => {
        const letters = [...row];
        return (
          <div key={r} data-warp={warp} style={{ whiteSpace: "pre" }}>
            {letters.map((ch, k) => {
              const w = warpLetter(warp, k, letters.length, size);
              return (
                <span key={k} style={{ display: "inline-block", whiteSpace: "pre", transform: `translateY(${w.y.toFixed(1)}px) rotate(${w.rotate.toFixed(1)}deg)` }}>
                  {ch}
                </span>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

// The textboard's title, byline and tagline cards. A card "with-title" sits under the card it is stacked
// on (as the artist under the title); the others are blocks of their own. Without an effect a card
// is on screen from its start and fades out over its last second (the YouTube title as before).
export function TextCards({ cards, format, picture }: { cards: TextCardProps[]; format: Format; picture?: LyricVideoProps["picture"] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  cards = cards.filter((c) => !c.off);
  const shown = new Set(cards.map((c) => c.id));
  const roots = cards.filter((c) => !c.stackOn || !shown.has(c.stackOn));
  const line = (c: TextCardProps, parent: TextCardProps | null, rootLook?: LineLook) => {
    const look = parent ? textCardLook(c, frame, fps) : (rootLook ?? { ...REST });
    if (!look || look.opacity <= 0.001) return null;
    const body = c.lines?.length ? c.lines.join("\n") : c.text;
    // The theme's title style and shape (src/picture.ts): only on the title card.
    const titled = c.type === "title" && picture ? picture : null;
    const cardStyle = c.cardStyle ?? titled?.titleStyle; // hook / end card: their own style from the theme
    const styled = cardStyle ? titleStyleCss(cardStyle, c.size, c.colour, picture?.accent ?? c.colour, look.opacity * 1.4) : {};
    const warped = titled?.titleWarp && look.chars === undefined && look.wave === undefined ? titled.titleWarp : undefined;
    return (
      <div
        key={c.id}
        data-text-card={c.id}
        data-title-style={cardStyle}
        style={{
          fontSize: c.size,
          ...styled,
          ...(c.upper ? { textTransform: "uppercase" as const } : {}),
          ...(c.lines?.length ? { whiteSpace: "pre-line" as const } : {}),
          ...(parent
            ? {
                marginTop: parent.size * 0.25,
                ...(c.colour !== parent.colour ? { color: c.colour } : {}),
                ...(c.font !== parent.font || c.weight !== parent.weight || !!c.italic !== !!parent.italic
                  ? { fontFamily: `"${c.font}"${c.fallbackFont ? `, "${c.fallbackFont}"` : ""}, serif`, fontWeight: c.weight, fontStyle: c.italic ? "italic" : "normal" }
                  : {}),
                ...(c.letterSpacing !== parent.letterSpacing || look.spacing ? { letterSpacing: `${(c.letterSpacing + (look.spacing ?? 0)).toFixed(4)}em` } : {}),
                opacity: (c.opacity ?? 1) * look.opacity,
              }
            : c.opacity !== undefined && c.opacity !== 1
              ? { opacity: c.opacity }
              : {}),
        }}
      >
        {look.chars !== undefined ? <TypedText text={body} share={look.chars} /> : look.wave !== undefined ? <WaveText text={body} wave={look.wave} /> : warped ? <WarpedText text={body} warp={warped} size={c.size} /> : body}
      </div>
    );
  };
  return (
    <>
      {roots.map((root) => {
        const look = textCardLook(root, frame, fps);
        if (!look || look.opacity <= 0.001) return null;
        const stacked = cards.filter((c) => c.stackOn === root.id);
        const { chars: rootChars, wave: rootWave } = look;
        const moved = look.x || look.y || look.scale !== 1;
        return (
          <div
            key={root.id}
            data-title={root.type === "title" ? "" : undefined}
            style={{
              position: "absolute",
              left: root.left ?? 0,
              right: root.right !== undefined ? format.width - root.right : 0,
              top: root.top ?? root.centerY ?? "50%",
              transform: [root.top === undefined ? "translateY(-50%)" : "", moved ? `translate(${look.x.toFixed(2)}px, ${look.y.toFixed(2)}px) scale(${look.scale.toFixed(4)})` : ""].filter(Boolean).join(" ") || undefined,
              textAlign: "center",
              // The planner (card-layout.ts cardBlocks) measures every row at this height; "normal" is the font's own
              // (Cinzel ~1.42), which drew the block ~25% taller than planned and onto the first lyric line.
              lineHeight: CARD_LINE_HEIGHT,
              fontFamily: `"${root.font}"${root.fallbackFont ? `, "${root.fallbackFont}"` : ""}, serif`,
              fontWeight: root.weight,
              ...(root.italic ? { fontStyle: "italic" as const } : {}),
              fontSynthesis: "none",
              color: root.colour,
              letterSpacing: `${(root.letterSpacing + (look.spacing ?? 0)).toFixed(4)}em`,
              ...(look.reveal !== undefined ? { maskImage: inkMask(look.reveal), WebkitMaskImage: inkMask(look.reveal) } : {}),
              textShadow: "0 2px 18px rgba(0,0,0,0.6)",
              opacity: look.opacity,
              filter: look.blur > 0.01 ? `blur(${look.blur.toFixed(2)}px)` : undefined,
            }}
          >
            {line(root, null, { ...REST, ...(rootChars !== undefined ? { chars: rootChars } : {}), ...(rootWave !== undefined ? { wave: rootWave } : {}) })}
            {stacked.map((c) => line(c, root))}
          </div>
        );
      })}
    </>
  );
}

