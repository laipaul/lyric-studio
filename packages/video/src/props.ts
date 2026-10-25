import type { FontFileRef } from "./font-files";
import type { KenBurns } from "./photo";
import type { CoverDrift, MoodSegment } from "./youtube";
import type { Format, LyricArea, SafeZone } from "./platform";

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
};

export type LyricLineProps = {
  text: string;
  startFrame: number; // composition frames (lead / offset already applied, no early cut)
  endFrame: number; // exclusive
  isHook?: boolean; // shown in the hook font when one is set
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
  hookFont?: { font: string; weight: number } | null; // font for hook lines (default: the style's)
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
  titleOverlay?: TitleOverlayProps | null; // song title + artist over the opening seconds
  logo?: { src: string; left: number; top: number; width: number; height: number; goneAt: number | null } | null; // goneAt: faded out by this frame
  mood?: MoodSegment[]; // section mood: warm/bright on hooks, soft on verses (2 s eased changes)
  endScreen?: { fromFrame: number; lyricArea: LyricArea; clear: { left: number; top: number; right: number; bottom: number } } | null;
  nextLine?: boolean; // show the next lyric line, small and faded, under the current one
  nextLineScale?: number; // its size compared with the current line (default 0.55)
  grain?: boolean; // subtle film grain
  glow?: { colour: string; beatFrames: number[] } | null; // soft glow on the lyrics, pulsing on the beats
  safeZone?: SafeZone; // covered by the platform's buttons and captions (preview guides, QA)
  lyricArea?: LyricArea; // where lyrics go, computed from the safe zones (see lyricArea())
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
