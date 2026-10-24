// Output format shared by preview and render. See CLAUDE.md.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

export const COMPOSITION_ID = "LyricVideo";

export type LyricVideoProps = {
  title: string;
  artist: string;
};

export const defaultLyricVideoProps: LyricVideoProps = {
  title: "Untitled song",
  artist: "Life Lyrics",
};
