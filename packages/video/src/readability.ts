// Lyric readability over the clips (pure, no FFmpeg): WCAG contrast of the lyric colour and the hook
// accent against the brightest part behind the lyric band, and the automatic soft backing. Readability is
// the app's job: with readability "auto" (the default) the render adds the soft dark band behind the
// lyrics by itself when enough of the video's clips are too bright behind them; "strong" (always the
// band) and "normal" (never) stay as the user's overrides.

export type Readability = "auto" | "normal" | "strong";
export const READABILITY_VALUES: readonly Readability[] = ["auto", "normal", "strong"];

// Thin scripts (also those marked "script": "thin" in presets/font-pairings.json).
export const THIN_SCRIPTS = ["great vibes", "grand hotel", "yellowtail"];
export const isThinFace = (family: string, weight: number, script?: "thin") => script === "thin" || weight <= 300 || THIN_SCRIPTS.includes(family.toLowerCase());
// Contrast a colour needs over the frame: 3:1, thin strokes 4.5:1.
export const neededContrast = (thin: boolean) => (thin ? 4.5 : 3);
// The share of the video's clips that must be too bright behind the lyrics before the backing is added.
export const BRIGHT_SHARE = 0.25;

export function relativeLuminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
// WCAG contrast of a colour against a relative luminance (0-1).
export function contrastWith(hex: string, backgroundLuminance: number): number {
  const lum = relativeLuminance(hex);
  const [a, b] = lum > backgroundLuminance ? [lum, backgroundLuminance] : [backgroundLuminance, lum];
  return (a + 0.05) / (b + 0.05);
}

export type LyricLook = { colour: string; accent: string; verseThin: boolean; hookThin: boolean };
export type ContrastCheck = { verse: number; accent: number; verseNeed: number; accentNeed: number; low: boolean };

// The lyric colour and the hook accent over one frame (the brightest part behind the lyric band).
export function lyricContrast(backgroundLuminance: number, look: LyricLook): ContrastCheck {
  const verse = contrastWith(look.colour, backgroundLuminance);
  const accent = contrastWith(look.accent, backgroundLuminance);
  const verseNeed = neededContrast(look.verseThin);
  const accentNeed = neededContrast(look.hookThin);
  return { verse, accent, verseNeed, accentNeed, low: verse < verseNeed || accent < accentNeed };
}

export type BackingDecision = {
  backing: boolean;
  mode: Readability;
  measured: number; // clips measured behind the lyric band
  bright: number; // of those, too bright for the lyric colours
  text: string; // one line for the log and the manifest
};

// The render's soft backing: "strong" always, "normal" never, "auto" when at least a quarter of the
// measured clips (at least one) are too bright behind the lyrics. Unmeasured clips (null) do not count.
export function lyricBackingFor(mode: Readability | undefined, bands: readonly (number | null)[], look: LyricLook): BackingDecision {
  const m: Readability = mode ?? "auto";
  const measuredBands = bands.filter((b): b is number => b !== null);
  const bright = measuredBands.filter((b) => lyricContrast(b, look).low).length;
  const measured = measuredBands.length;
  if (m === "strong") return { backing: true, mode: m, measured, bright, text: "lyric readability strong (set by you): a soft dark band behind the lyrics" };
  if (m === "normal") return { backing: false, mode: m, measured, bright, text: `lyric readability normal (set by you): no backing${bright ? ` (${bright} of ${measured} clips are bright behind the lyrics)` : ""}` };
  const backing = measured > 0 && bright >= Math.max(1, Math.ceil(measured * BRIGHT_SHARE));
  const text = !measured
    ? "lyric readability auto: no clip could be measured, no backing"
    : backing
      ? `lyric readability auto: ${bright} of ${measured} clips are bright behind the lyrics, so a soft dark band goes behind them`
      : bright
        ? `lyric readability auto: ${bright} of ${measured} clips bright behind the lyrics, too few for a backing on every shot`
        : `lyric readability auto: the lyrics read clearly over all ${measured} clips, no backing`;
  return { backing, mode: m, measured, bright, text };
}
