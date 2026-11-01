// The Themes page's mood filters (1 Nov 2026): a theme's moods are ticked on its page (theme.json "moods").
// Browser-safe.
export const THEME_MOODS = ["Romantic", "Night", "Warm", "Minimal", "Bright", "Moody"] as const;
export type ThemeMood = (typeof THEME_MOODS)[number];
