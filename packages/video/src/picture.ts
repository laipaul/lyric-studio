// The theme's picture (pure, browser-safe): what a theme does to the clips and around the words.
//   grade        one colour grade on every clip (natural = the clips as they are), so mixed footage looks
//                like one film
//   vignette     the edges darkened (off | soft | strong)
//   grain        film grain over everything but the words (off | light | medium; Joey's finishing step, 22 Nov 2026):
//                one look over Midjourney, Seedance and InfiniteTalk clips; a fine noise drawn in the page (no file,
//                no network), moved on every frame by grainOffset (the same in the preview and both renderers)
//   textBacking  behind the words: none (the light shadow every video has) | shadow | glow (in the accent) |
//                band (the soft dark band, always) | box (a dark rounded box behind each line)
//   fallback     what shows where there is no clip (a song without clips, a slot waiting for one):
//                gradient (in the theme's accent) | colour (fallbackColour) | cover (the cover, blurred)
//   gradeCanvas  on (default): the Spotify Canvas gets the grade too; off: the Canvas keeps the clips' colours
// The clips themselves are never cut or changed by this: the grade and vignette are drawn over them in the
// composition, the same in the preview and the render. Readability stays the app's job: "auto" still adds
// the soft band by itself when a clip is too bright behind the lyrics, whatever the backing.
import type React from "react";

export const GRADES = ["natural", "warm", "cool", "faded", "mono", "moody"] as const;
export type Grade = (typeof GRADES)[number];
export const VIGNETTES = ["off", "soft", "strong"] as const;
export type Vignette = (typeof VIGNETTES)[number];
export const GRAINS = ["off", "light", "medium"] as const;
export type Grain = (typeof GRAINS)[number];
export const TEXT_BACKINGS = ["none", "shadow", "glow", "band", "box"] as const;
export type TextBacking = (typeof TEXT_BACKINGS)[number];
export const FALLBACKS = ["gradient", "colour", "cover"] as const;
// The title card's text style and shape (TypeCraft / TypeStudio style; the title, not the lyric lines).
export const TITLE_STYLES = ["plain", "outline", "layered", "extrude", "label"] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];
export const TITLE_WARPS = ["none", "arc", "wave"] as const;
export type TitleWarp = (typeof TITLE_WARPS)[number];
export const TITLE_STYLE_LABELS: Record<TitleStyle, string> = { plain: "Plain", outline: "Outline", layered: "Layered outline", extrude: "3D extrude", label: "Label bar" };
export const TITLE_WARP_LABELS: Record<TitleWarp, string> = { none: "Straight", arc: "Arc", wave: "Wave" };
export type Fallback = (typeof FALLBACKS)[number];

export const GRADE_LABELS: Record<Grade, string> = { natural: "Natural", warm: "Warm", cool: "Cool", faded: "Faded film", mono: "Black & white", moody: "Moody" };
export const VIGNETTE_LABELS: Record<Vignette, string> = { off: "Off", soft: "Soft", strong: "Strong" };
export const GRAIN_LABELS: Record<Grain, string> = { off: "Off", light: "Light", medium: "Medium" };
export const BACKING_LABELS: Record<TextBacking, string> = { none: "None", shadow: "Soft shadow", glow: "Glow", band: "Dark band", box: "Box" };
export const FALLBACK_LABELS: Record<Fallback, string> = { gradient: "Gradient", colour: "Plain colour", cover: "Blurred cover" };

// What LyricVideo / LookPreview receive (props.picture). Absent: the videos as before (natural, no
// vignette, the light shadow, black where there is no clip).
export type PictureProps = {
  grade: Grade;
  vignette: Vignette;
  grain?: Grain; // absent: off
  backing: TextBacking;
  fallback: Fallback;
  fallbackColour: string; // #RRGGBB
  accent: string; // the theme's accent: the gradient and the glow
  coverSrc?: string | null; // fallback "cover": the cover blurred in advance, relative to mediaBaseUrl
  titleStyle?: TitleStyle; // the title card: plain (default), outline, layered outline, 3D extrude, label bar
  titleWarp?: TitleWarp; // the title card's shape: straight (default), arc, wave
};

export const DEFAULT_PICTURE: Omit<PictureProps, "accent"> = { grade: "natural", vignette: "off", backing: "none", fallback: "gradient", fallbackColour: "#101014" };

// The grade: a CSS filter on the clips and a colour veil over them (both drawn by the composition).
export type GradeLook = { filter?: string; veil?: { colour: string; blend: React.CSSProperties["mixBlendMode"] } };
export function gradeLook(grade: Grade | undefined): GradeLook {
  switch (grade) {
    case "warm":
      return { filter: "saturate(1.12) contrast(1.04)", veil: { colour: "rgba(255,150,70,0.22)", blend: "soft-light" } };
    case "cool":
      return { filter: "saturate(0.92) contrast(1.04)", veil: { colour: "rgba(70,130,255,0.24)", blend: "soft-light" } };
    case "faded":
      return { filter: "contrast(0.82) saturate(0.72) brightness(1.06)", veil: { colour: "rgba(255,236,210,0.10)", blend: "normal" } };
    case "mono":
      return { filter: "grayscale(1) contrast(1.1)" };
    case "moody":
      return { filter: "contrast(1.14) saturate(0.78) brightness(0.86)", veil: { colour: "rgba(20,30,70,0.22)", blend: "multiply" } };
    default:
      return {};
  }
}

// The vignette: darker edges, the middle untouched.
export function vignetteBackground(v: Vignette | undefined): string | null {
  if (v === "soft") return "radial-gradient(ellipse 75% 65% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)";
  if (v === "strong") return "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.78) 100%)";
  return null;
}

// Film grain: a 200 px tile of fine grey noise (an SVG noise filter as a data URI: drawn by the browser, no file, no
// network), laid over the picture in soft-light (it adds texture, the colours and the light stay), at the strength's
// opacity. The tile jumps to another place on every frame (grainOffset), as real grain changes every frame.
const GRAIN_TILE = 200;
const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='${GRAIN_TILE}' height='${GRAIN_TILE}'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`;
export function grainLayer(g: Grain | undefined): { background: string; opacity: number; blend: "soft-light"; size: number } | null {
  if (g !== "light" && g !== "medium") return null;
  return { background: `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG).replace(/'/g, "%27")}")`, opacity: g === "light" ? 0.32 : 0.55, blend: "soft-light", size: GRAIN_TILE };
}
// Where the tile sits on `frame`: a fixed pseudo-random place per frame (deterministic: the same frame, the same grain).
// Self-contained (no outside names): the HyperFrames page gets this very function as text.
export function grainOffset(frame: number, tile = 200): string {
  let h = (Math.imul(frame | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return `${h % tile}px ${(h >>> 8) % tile}px`;
}

// "#E8A3B5" + alpha -> "rgba(232,163,181,0.5)"
export function hexRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(3)})`;
}

// Where there is no clip: the theme's background.
export function fallbackBackground(p: Pick<PictureProps, "fallback" | "fallbackColour" | "accent"> | null | undefined): string {
  if (!p) return "#000";
  if (p.fallback === "colour") return p.fallbackColour;
  // gradient (and cover before its picture is drawn): the accent glowing softly in the upper middle
  return `radial-gradient(ellipse at 50% 40%, ${hexRgba(p.accent, 0.32)} 0%, #141417 60%, #0b0b0d 100%)`;
}

// The text shadow behind the words (none: the light shadow every video has; band and box add it too).
export const BASE_TEXT_SHADOW = "0 2px 12px rgba(0,0,0,0.55)";
export function backingShadow(b: TextBacking | undefined, accent: string): string {
  if (b === "shadow") return "0 3px 6px rgba(0,0,0,0.7), 0 6px 26px rgba(0,0,0,0.75)";
  if (b === "glow") return `0 0 18px ${hexRgba(accent, 0.75)}, 0 0 42px ${hexRgba(accent, 0.45)}, 0 2px 8px rgba(0,0,0,0.5)`;
  return BASE_TEXT_SHADOW;
}

// "box": each printed line on its own dark rounded box, a clear caption box (31 Oct 2026: stronger and roomier,
// the first one at 55% with no top/bottom room hardly read as a box).
export const BOX_STYLE: React.CSSProperties = { background: "rgba(0,0,0,0.72)", borderRadius: "0.22em", padding: "0.06em 0.45em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" };

// The theme's picture fields as props (recipe values; the Canvas without the grade when gradeCanvas is off).
export function pictureOf(
  v: { grade?: string; vignette?: string; grain?: string; textBacking?: string; fallback?: string; fallbackColour?: string; gradeCanvas?: string; accentColour?: string; titleStyle?: string; titleWarp?: string },
  opts: { canvas?: boolean; coverSrc?: string | null } = {},
): PictureProps {
  const pick = <T extends string>(list: readonly T[], x: string | undefined, d: T): T => ((list as readonly string[]).includes(x ?? "") ? (x as T) : d);
  const grade = pick(GRADES, v.grade, "natural");
  return {
    grade: opts.canvas && v.gradeCanvas === "off" ? "natural" : grade,
    vignette: pick(VIGNETTES, v.vignette, "off"),
    ...(v.grain === "light" || v.grain === "medium" ? { grain: v.grain } : {}),
    backing: pick(TEXT_BACKINGS, v.textBacking, "none"),
    fallback: pick(FALLBACKS, v.fallback, "gradient"),
    fallbackColour: /^#[0-9a-fA-F]{6}$/.test(v.fallbackColour ?? "") ? v.fallbackColour! : DEFAULT_PICTURE.fallbackColour,
    accent: /^#[0-9a-fA-F]{6}$/.test(v.accentColour ?? "") ? v.accentColour! : "#E8A3B5",
    ...(opts.coverSrc ? { coverSrc: opts.coverSrc } : {}),
    ...(v.titleStyle && v.titleStyle !== "plain" ? { titleStyle: pick(TITLE_STYLES, v.titleStyle, "plain") } : {}),
    ...(v.titleWarp && v.titleWarp !== "none" ? { titleWarp: pick(TITLE_WARPS, v.titleWarp, "none") } : {}),
  };
}

// The title's text style (a card's CSS): outline = hollow letters; layered = hollow letters over an accent
// copy; extrude = a 3D block of accent shadows; label = the text on an accent bar that wipes in.
export function titleStyleCss(style: TitleStyle | undefined, size: number, colour: string, accent: string, show = 1): React.CSSProperties {
  const stroke = Math.max(1.5, size * 0.028);
  if (style === "outline") return { color: "transparent", WebkitTextStroke: `${stroke.toFixed(1)}px ${colour}`, textShadow: "none" };
  if (style === "layered") return { color: "transparent", WebkitTextStroke: `${stroke.toFixed(1)}px ${colour}`, textShadow: `${(size * 0.05).toFixed(1)}px ${(size * 0.05).toFixed(1)}px 0 ${accent}` };
  if (style === "extrude") {
    const step = Math.max(1, size * 0.012);
    return { textShadow: Array.from({ length: 7 }, (_, k) => `${((k + 1) * step).toFixed(1)}px ${((k + 1) * step).toFixed(1)}px 0 ${shade(accent, 0.75 - k * 0.06)}`).join(", ") };
  }
  if (style === "label") {
    const s = Math.min(1, Math.max(0, show));
    return { display: "inline-block", background: accent, color: "#141414", padding: "0.06em 0.4em", borderRadius: "0.08em", textShadow: "none", clipPath: s < 1 ? `inset(0 ${((1 - s) * 100).toFixed(1)}% 0 0)` : undefined };
  }
  return {};
}
// "#E8A3B5" darkened to `k` of its brightness.
function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const c = (v: number) => Math.round(v * k);
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
// The title's shape: each letter's lift (px) and turn (deg); k = its place, n = letters on the row.
export function warpLetter(warp: TitleWarp | undefined, k: number, n: number, size: number): { y: number; rotate: number } {
  if (warp === "arc" && n > 1) {
    const t = (2 * k) / (n - 1) - 1; // -1 .. 1
    return { y: -size * 0.28 * (1 - t * t), rotate: t * 16 };
  }
  if (warp === "wave") return { y: size * 0.1 * Math.sin(k * 0.75), rotate: 7 * Math.cos(k * 0.75) };
  return { y: 0, rotate: 0 };
}
