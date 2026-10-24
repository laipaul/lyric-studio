// LRC lyrics: "[mm:ss.xx]text". A stamp with no text ends the previous line (pause / last line end).
export type TimedLine = { text: string; start_ms: number; end_ms: number };

const STAMP = /\[(\d+):(\d{1,2}(?:\.\d{1,3})?)\]/g;

export function parseLrc(content: string, fallbackEndMs?: number): TimedLine[] {
  const stamps: { ms: number; text: string }[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const times = [...raw.matchAll(STAMP)];
    if (!times.length) continue;
    const text = raw.replace(STAMP, "").trim();
    for (const t of times) stamps.push({ ms: Math.round((Number(t[1]) * 60 + Number(t[2])) * 1000), text });
  }
  stamps.sort((a, b) => a.ms - b.ms);

  const lines: TimedLine[] = [];
  stamps.forEach((s, i) => {
    if (!s.text) return; // end / pause marker
    const end = stamps[i + 1]?.ms ?? fallbackEndMs;
    if (end !== undefined && end > s.ms) lines.push({ text: s.text, start_ms: s.ms, end_ms: end });
  });
  return lines;
}

export function formatLrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10)); // centiseconds
  const minutes = Math.floor(total / 6000);
  const seconds = (total % 6000) / 100;
  return `[${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}]`;
}
