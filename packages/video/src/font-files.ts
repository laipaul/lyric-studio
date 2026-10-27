// A font file the composition loads (FontFace). `src` is relative to mediaBaseUrl:
// "_fonts/<file>" for bundled fonts, "fonts/<file>" for fonts in WORKSPACE_DIR\fonts.
export type FontFileRef = {
  family: string;
  weight: number;
  style: "normal" | "italic";
  src: string;
  unicodeRange?: string;
};

// Unicode ranges of the @fontsource "latin" and "latin-ext" subsets (from their CSS).
export const LATIN_RANGE =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
export const LATIN_EXT_RANGE =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

// Does a CSS unicode-range ("U+0000-00FF,U+0131,U+4E??") cover any character of `text`?
export function rangeCovers(range: string, text: string): boolean {
  const spans = range.split(",").map((part) => {
    const p = part.trim().replace(/^U\+/i, "");
    if (p.includes("?")) return [parseInt(p.replace(/\?/g, "0"), 16), parseInt(p.replace(/\?/g, "F"), 16)] as const;
    const [a, b] = p.split("-");
    return [parseInt(a, 16), parseInt(b ?? a, 16)] as const;
  });
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (spans.some(([a, b]) => c >= a && c <= b)) return true;
  }
  return false;
}
