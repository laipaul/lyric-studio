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
};

export type LyricLineProps = {
  text: string;
  startFrame: number; // composition frames, on the vocal (no early cut)
  endFrame: number; // exclusive
};

export type StyleProps = {
  name: string;
  font: string;
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
  textSize: number; // px on the 1080x1920 canvas
  colour: string;
  cinematicBars: boolean;
  showSafeGuides?: boolean; // preview only: outline the platform safe zone
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
  textSize: 64,
  colour: "#ffffff",
  cinematicBars: false,
};

export function mediaUrl(base: string, relative: string): string {
  const encoded = relative.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/${encoded}`;
}
