// Output format shared by preview and render. See CLAUDE.md.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

export const COMPOSITION_ID = "LyricVideo";

// Safe zones and the lyric position are per platform (presets/platforms.json; see ./platform.ts).

export const AUDIO_FADE = {
  inSeconds: 0.3,
  outSeconds: 0.5,
} as const;
