// Output format shared by preview and render. See CLAUDE.md.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

export const COMPOSITION_ID = "LyricVideo";

// Platform UI (TikTok / Reels / Shorts) covers the bottom 20% and the right 12%: keep lyrics out.
export const SAFE_ZONE = {
  right: 0.12,
  bottom: 0.2,
} as const;

// Lyric block: centred in the safe area horizontally, around 62.5% of the height vertically.
export const LYRIC_AREA = {
  left: 64,
  right: Math.round(VIDEO.width * (1 - SAFE_ZONE.right)) - 32, // 918
  centerY: Math.round(VIDEO.height * 0.625), // 1200
  maxLines: 2,
  minScale: 0.75, // long lines shrink by at most 25%
  lineHeight: 1.15,
} as const;

export const CINEMATIC_BAR_HEIGHT = Math.round(VIDEO.height * 0.1);

export const AUDIO_FADE = {
  inSeconds: 0.3,
  outSeconds: 0.5,
} as const;
