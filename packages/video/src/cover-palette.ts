// Colours from a cover picture (1 Nov 2026, asked by the user): 3–5 colours a theme could use, and from
// them a suggestion for the lyric text and the accent (the chorus words use the accent). A suggestion only:
// nothing changes until the user clicks "Use these colours".

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
export const toHex = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
const rgb = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
};
// Relative luminance (WCAG), 0 = black, 1 = white.
export function luminance(c: string): number {
  const ch = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const saturation = (c: string) => {
  const [r, g, b] = rgb(c);
  const max = Math.max(r, g, b);
  return max ? (max - Math.min(r, g, b)) / max : 0;
};

// The main colours of a picture from its RGBA pixels (e.g. a 24×24 canvas): grouped in coarse buckets,
// the big and lively ones first; near-black and near-white left out (they are no use for lyrics). At most
// `max` colours, never two almost the same.
export function paletteFromPixels(px: ArrayLike<number>, max = 5): string[] {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number; s: number }>();
  for (let i = 0; i + 2 < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    if (hi < 40 || lo > 225) continue;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, s: 0 };
    buckets.set(key, { n: e.n + 1, r: e.r + r, g: e.g + g, b: e.b + b, s: e.s + (hi - lo) });
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n * (1 + b.s / b.n / 128) - a.n * (1 + a.s / a.n / 128)).map((e) => toHex(e.r / e.n, e.g / e.n, e.b / e.n));
  const out: string[] = [];
  for (const c of ranked) {
    const [r, g, b] = rgb(c);
    if (out.some((o) => {
      const [r2, g2, b2] = rgb(o);
      return Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2) < 48;
    }))
      continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

// Mixes a colour towards white (amount 0–1).
const towardsWhite = (c: string, amount: number) => {
  const [r, g, b] = rgb(c);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
};

// From a palette: the lyric text colour (the lightest, lifted towards white until it reads on a dark
// picture) and the accent (the liveliest colour bright enough to stand out; the chorus words use it).
export function suggestThemeColours(palette: string[]): { textColour: string; accentColour: string } | null {
  if (!palette.length) return null;
  const lightest = [...palette].sort((a, b) => luminance(b) - luminance(a))[0];
  let text = lightest;
  for (let k = 0.15; luminance(text) < 0.75 && k <= 1; k += 0.15) text = towardsWhite(lightest, k);
  const lively = [...palette].sort((a, b) => saturation(b) - saturation(a));
  let accent = lively.find((c) => c !== lightest && luminance(c) > 0.1) ?? lively[0];
  for (let k = 0.15; luminance(accent) < 0.1 && k <= 1; k += 0.15) accent = towardsWhite(lively[0], k);
  return { textColour: text, accentColour: accent };
}
