// A colour typed by the user (theme editor: Text / Accent / fallback colour, 31 Oct 2026) read as "#RRGGBB",
// or null when it is not a colour yet. Accepts what designers paste: "#FF2D95", "FF2D95", "#F29", "f29",
// "rgb(255, 45, 149)", "255, 45, 149", "255 45 149". Pure, browser-safe.
export function parseColourRef(input: string): string | null {
  const s = input.trim().replace(/;$/, "");
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return `#${m[1].toUpperCase()}`;
  m = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m) return `#${[...m[1]].map((c) => c + c).join("").toUpperCase()}`;
  m = /^(?:rgba?\s*\()?\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)?$/i.exec(s);
  if (m) {
    const parts = [m[1], m[2], m[3]].map(Number);
    if (parts.some((n) => n > 255)) return null;
    return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  return null;
}
