import type { TitleStyle } from "./picture";
import type { BreatheProps } from "./effects/breathe";
import type { FontFileRef } from "./font-files";
import type { KenBurns } from "./photo";
import type { EffectChoice } from "./effects/types";
import type { CoverDrift, MoodSegment } from "./youtube";
import type { Format, LyricArea, SafeZone } from "./platform";
import type { PictureProps } from "./picture";

// Everything LyricVideo needs. Preview (@remotion/player) and export (renderMedia) receive the same
// object; media paths are relative to `mediaBaseUrl`, which is the only thing that differs.
export type TextCase = "none" | "upper" | "lower" | "title";

export type ShotProps = {
  start: number; // composition frame where the shot begins
  duration: number; // frames
  src: string; // clip, relative to mediaBaseUrl
  clipStartFrame: number; // where playback starts inside the clip (frames at 30 fps)
  clipDurationFrames: number;
  playbackRate: number; // 0.5 - 1
  holdLastFrame: boolean; // freeze the clip's last frame once it runs out
  kind?: "video" | "photo"; // photo: a still image with a slow Ken Burns move (`motion`)
  motion?: KenBurns;
  fit?: "cover" | "fill"; // fill: whole picture shown over a blurred, enlarged copy (--allow-fill)
  // Seamless loop (Spotify Canvas): over the last `frames` frames the same clip, from `fromClipFrame`
  // (the frames right before clipStartFrame), fades in on top, so the last frame flows into the first.
  loopBlend?: { frames: number; fromClipFrame: number };
  motionLoop?: boolean; // photo: the Ken Burns move goes out and comes back (first frame = last frame)
  // Story anchors: a dissolve into this shot, `before` frames over the previous shot (which keeps
  // playing `after` frames into this one: its `tail`). Without them: a hard cut.
  dissolve?: { before: number; after: number };
  tail?: number;
};

export type LyricLineProps = {
  text: string;
  startFrame: number; // composition frames (lead / offset already applied, no early cut)
  endFrame: number; // exclusive
  isHook?: boolean; // shown in the hook font when one is set
  // With lyric effects (Step 5j): when the line is sung (no lead), when its last word ends, and its
  // words' sung times (from the aligned LRC). All in composition frames.
  stampFrame?: number;
  sungEndFrame?: number;
  words?: { text: string; startFrame: number; endFrame: number }[];
  enterFrame?: number; // after a long instrumental gap: it fades in from here (brand motion.gapLeadInS)
  scale?: number; // the theme's final hook (src/line-shape.ts finalHookScales): x the text size; a card's own scale wins
  // The line's textboard card (src/textboard.ts): its id, and the look it sets for this line only.
  card?: {
    id: string;
    effect?: EffectChoice; // instead of the verse / hook effect
    scale?: number; // x the text size
    centerY?: number; // its own place (px), inside the lyric area
    position?: string; // the place's name (upper, centre, lower, top)
    font?: { family: string; weight: number; italic?: boolean };
    baseEndFrame?: number; // the display rules' end before the card's hold
  };
};

// Title, byline and tagline cards (the textboard's opening), and the theme's hook and end cards
// (src/extra-cards.ts): drawn over the picture.
export type TextCardProps = {
  id: string;
  type: "title" | "byline" | "tagline" | "hook" | "end";
  cardStyle?: TitleStyle; // hook / end card: the theme's style for it (the title card uses picture.titleStyle)
  off?: boolean; // planned but switched off in the theme: not drawn, not checked (the editor can switch it on)
  text: string;
  font: string;
  fallbackFont?: string; // for characters the font lacks (e.g. Japanese: Noto Sans JP), same in preview and render
  weight: number;
  italic?: boolean;
  size: number; // px
  baseSize?: number; // title / byline / tagline: the usual size (px) before the user's own size and the fit (the editor's px scale)
  colour: string;
  opacity?: number; // of the text colour (byline: 0.85)
  letterSpacing: number; // em
  upper: boolean;
  startFrame: number;
  endFrame: number; // gone by here (fades out over the last second without an effect)
  effect?: EffectChoice | null; // comes in / goes like that lyric effect (default: the fade)
  stackOn?: string; // drawn under this card (with-title), marginTop 0.25 x that card's size
  top?: number; // px: the block's top edge (title at the top)
  centerY?: number; // px: the block's centre (when no top)
  left?: number; // horizontal extent (default: the whole width)
  right?: number;
  lines?: string[]; // the text on these lines (the layout's balanced wrap inside the safe area), drawn and measured as is
};

// Lyric effects (src/effects): the verse and hook effect, and the accent colour for karaoke.
// Without this (manifests from before Step 5j) lines use the style's old fade / pop.
// gap: during an instrumental gap longer than hideMs no lyric is shown; the next line fades in
// leadInMs before its first sung word (missing in manifests from before: the old timing).
// breathe: the "breathe" add-on (recipe breathe gentle / beat; downbeats = frames of the video).
// The music-reactive add-ons (recipe heldGlow / chorusLift / shine "on"); downbeats: frames of the video
// (the song's detected bars), for Shine.
export type LyricEffectsProps = {
  verse: EffectChoice;
  hook: EffectChoice;
  accent: string;
  gap?: { hideMs: number; leadInMs: number };
  breathe?: BreatheProps;
  heldGlow?: boolean;
  chorusLift?: boolean;
  shine?: boolean;
  emphasis?: boolean; // the key word of each line in the hook font, bigger, in the accent (src/effects/accents.ts emphasisWord)
  downbeats?: number[];
  hookScale?: number; // the theme's text layout "Big hook": chorus lines this much larger (src/text-layout.ts)
  lineShape?: "stacked"; // the theme's line shape (src/line-shape.ts): short rows of 1-3 words; absent: subtitle
  lineBuild?: "build"; // each row appears as it is sung and stays until the line leaves; absent: the whole line
};

export type StillProps = { src: string; startFrame: number; endFrame: number; fadeFrames: number; motion?: KenBurns; section: string };

export type TitleOverlayProps = {
  title: string;
  artist: string;
  font: string;
  weight: number;
  letterSpacing: number; // em
  colour: string;
  untilFrame: number; // fully gone by this frame (Infinity-like large value = always shown)
  size: number; // px for the title; the artist is smaller
  position: "top" | "centre";
  left?: number; // horizontal extent of the title block in px (default: the whole width)
  right?: number;
};

export type StyleProps = {
  name: string;
  font: string; // font family (one of `fonts`)
  weight: number;
  italic?: boolean; // the family's italic file (rendered with font-synthesis: none, never a fake italic)
  textCase: TextCase;
  effect: string;
  animation: string;
};

export type LyricVideoProps = {
  mediaBaseUrl: string;
  audio: { src: string; startFrame: number; fadeInFrames: number; fadeOutFrames: number } | null;
  durationInFrames: number;
  cutFrames: number[]; // composition frames where a new shot starts (from getCutPoints)
  shots: ShotProps[];
  lyrics: LyricLineProps[];
  style: StyleProps;
  hookFont?: { font: string; weight: number; italic?: boolean } | null; // font for hook lines (default: the style's)
  fonts: FontFileRef[]; // every font file the lyrics need (loaded before rendering)
  textSize: number; // px on the 1080x1920 canvas
  colour: string;
  cinematicBars: boolean;
  showSafeGuides?: boolean; // preview only: outline the platform safe zone
  format?: Format; // frame size (default 1080x1920)
  // YouTube (16:9) extras; all optional, so vertical videos are unchanged.
  layout?: "vertical" | "cover" | "stills" | "clips";
  // Cover layout: the square cover on the left; backgroundSrc = the cover blurred and darkened in
  // advance; drift = its slow movement (px), the background moving the opposite way (parallax).
  cover?: { src: string; zoomFrom: number; zoomTo: number; backgroundSrc?: string; drift?: CoverDrift; parallax?: number } | null;
  stills?: StillProps[]; // stills layout: one picture per lyric section, crossfaded on downbeats
  titleOverlay?: TitleOverlayProps | null; // song title + artist over the opening seconds (manifests before the textboard)
  textCards?: TextCardProps[]; // the textboard's title / byline / tagline cards
  logo?: { src: string; left: number; top: number; width: number; height: number; goneAt: number | null } | null; // goneAt: faded out by this frame
  mood?: MoodSegment[]; // section mood: warm/bright on hooks, soft on verses (2 s eased changes)
  endScreen?: { fromFrame: number; seconds?: number /* window length; absent in older manifests */; lyricArea: LyricArea; clear: { left: number; top: number; right: number; bottom: number } } | null;
  lyricEffects?: LyricEffectsProps | null;
  // Automatic transitions (src/transitions.ts): dips to black, `frames` long and darkest on `frame`.
  dips?: { frame: number; frames: number }[];
  // Lyric readability "strong" (recipe readability, the reaction "lyrics hard to read"): a soft dark band
  // behind the lyric area, never a hard box.
  lyricBacking?: boolean;
  // Loop platforms: over the last `frames` frames the first shot's opening fades in on top, so the last
  // frame leads straight into the first (when the last shot does not already continue into it).
  loopInto?: { frames: number } | null;
  nextLine?: boolean; // show the next lyric line, small and faded, under the current one
  nextLineScale?: number; // its size compared with the current line (default 0.55)
  grain?: boolean; // subtle film grain
  glow?: { colour: string; beatFrames: number[] } | null; // soft glow on the lyrics, pulsing on the beats
  safeZone?: SafeZone; // covered by the platform's buttons and captions (preview guides, QA)
  lyricArea?: LyricArea; // where lyrics go, computed from the safe zones (see lyricArea()) and the theme's text layout
  lyricsAt?: number; // the platform's lyricsAt (the viewer moves the area when the text layout changes)
  textLayout?: "centre" | "lower" | "bighook"; // the theme's text layout (src/text-layout.ts), for the record
  // The theme's picture (src/picture.ts): the grade and vignette over the clips, what is behind the words,
  // and the background where there is no clip. Absent (older manifests): as before.
  picture?: PictureProps | null;
};

export const SIMPLE_STYLE: StyleProps = {
  name: "Simple",
  font: "Inter",
  weight: 600,
  textCase: "none",
  effect: "none",
  animation: "fade",
};

export const defaultLyricVideoProps: LyricVideoProps = {
  mediaBaseUrl: "",
  audio: null,
  durationInFrames: 90,
  cutFrames: [],
  shots: [],
  lyrics: [{ text: "Life Lyrics", startFrame: 0, endFrame: 90 }],
  style: SIMPLE_STYLE,
  fonts: [],
  textSize: 64,
  colour: "#ffffff",
  cinematicBars: false,
};

export function mediaUrl(base: string, relative: string): string {
  const encoded = relative.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/${encoded}`;
}
