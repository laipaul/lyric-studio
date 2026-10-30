// "a frame of <long clip file name>" -> "a frame of your clip “lifelyrics_lonely_korean…”" (the full name stays in the title tooltip).
export function shortFrom(from: string): string {
  const m = /^a frame of (.+)$/.exec(from);
  if (!m) return from;
  const n = m[1];
  return `a frame of your clip “${n.length > 24 ? `${n.slice(0, 24)}…` : n}”`;
}
