// LRC lyrics: "[mm:ss.xx]text". A stamp with no text ends the previous line (pause / last line end).
// A line starting with "* " is a hook; every line with the same words (see normalizeLyric) is then
// a hook too, so marking one chorus occurrence marks them all.
// Enhanced LRC (from "pnpm align") also has word tags: "[00:14.00]<00:14.00>Hope <00:14.42>is".
export type TimedWord = { text: string; start_ms: number };
export type TimedLine = { text: string; start_ms: number; end_ms: number; isHook: boolean; words?: TimedWord[] };

const STAMP = /\[(\d+):(\d{1,2}(?:\.\d{1,3})?)\]/g;
const WORD_TAG = /<(\d+):(\d{1,2}(?:\.\d{1,3})?)>/g;
const tagMs = (m: string, s: string) => Math.round((Number(m) * 60 + Number(s)) * 1000);

// Line text without word tags, and the word timings if there are any.
function splitWords(body: string): { text: string; words?: TimedWord[] } {
  const tags = [...body.matchAll(WORD_TAG)];
  const text = body.replace(WORD_TAG, " ").replace(/\s+/g, " ").trim();
  if (!tags.length) return { text };
  const words = tags.map((t, i) => ({
    start_ms: tagMs(t[1], t[2]),
    text: body.slice((t.index ?? 0) + t[0].length, tags[i + 1]?.index ?? body.length).trim(),
  }));
  return { text, words: words.filter((w) => w.text) };
}
export const HOOK_MARKER = /^\*\s+/;

// Text used to compare lyric lines (pins, hooks): case, punctuation and extra spaces ignored.
export function normalizeLyric(text: string): string {
  return text
    .replace(WORD_TAG, " ")
    .normalize("NFC")
    .replace(HOOK_MARKER, "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLrc(content: string, fallbackEndMs?: number): TimedLine[] {
  const stamps: { ms: number; text: string; isHook: boolean; words?: TimedWord[] }[] = [];
  for (const raw of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const times = [...raw.matchAll(STAMP)];
    if (!times.length) continue;
    const body = raw.replace(STAMP, "").trim();
    const isHook = HOOK_MARKER.test(body);
    const { text, words } = splitWords(body.replace(HOOK_MARKER, "").trim());
    for (const t of times) stamps.push({ ms: tagMs(t[1], t[2]), text, isHook, ...(words ? { words } : {}) });
  }
  stamps.sort((a, b) => a.ms - b.ms);

  const lines: TimedLine[] = [];
  stamps.forEach((s, i) => {
    if (!s.text) return; // end / pause marker
    const end = stamps[i + 1]?.ms ?? fallbackEndMs;
    if (end !== undefined && end > s.ms) {
      lines.push({ text: s.text, start_ms: s.ms, end_ms: end, isHook: s.isHook, ...(s.words ? { words: s.words } : {}) });
    }
  });

  const hooks = new Set(lines.filter((l) => l.isHook).map((l) => normalizeLyric(l.text)));
  return lines.map((l) => ({ ...l, isHook: hooks.has(normalizeLyric(l.text)) }));
}

export function formatLrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10)); // centiseconds
  const minutes = Math.floor(total / 6000);
  const seconds = (total % 6000) / 100;
  return `[${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}]`;
}

// Moves every time stamp and word tag by `shiftMs` (never below 0). Tags like [ar:...] and the text
// are unchanged.
export function shiftLrc(content: string, shiftMs: number): string {
  return content
    .replace(STAMP, (_, m: string, s: string) => formatLrcTime(Math.max(0, tagMs(m, s) + shiftMs)))
    .replace(WORD_TAG, (_, m: string, s: string) => `<${formatLrcTime(Math.max(0, tagMs(m, s) + shiftMs)).slice(1, -1)}>`);
}

// Marks every line with the same words as `lineText` as a hook ("* " after the time stamp).
// Returns the new content and how many lines matched (already-marked lines count too).
export function markHookInLrc(content: string, lineText: string): { content: string; matched: number } {
  const key = normalizeLyric(lineText);
  let matched = 0;
  const out = content.split(/(\r?\n)/).map((part) => {
    const times = [...part.matchAll(STAMP)];
    if (!times.length) return part;
    const prefix = part.slice(0, (times[times.length - 1].index ?? 0) + times[times.length - 1][0].length);
    const body = part.slice(prefix.length);
    if (!body.trim() || normalizeLyric(body) !== key) return part;
    matched += 1;
    return HOOK_MARKER.test(body.trim()) ? part : `${prefix}* ${body.trimStart()}`;
  });
  return { content: out.join(""), matched };
}

// Plain synced lyrics for lyric services (Musixmatch, LyricFind): title/artist/length tags, one
// stamp per line (with the project's lyrics offset), an empty stamp for each pause and at the end;
// no word tags and no "* " hook markers.
export function cleanLrc(lines: readonly TimedLine[], meta: { title: string; artist: string; durationMs: number; offsetMs?: number }): string {
  const offset = meta.offsetMs ?? 0;
  const total = Math.round(meta.durationMs / 1000);
  const out = [`[ti:${meta.title}]`, `[ar:${meta.artist}]`, `[length:${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}]`, "[re:Lyric Studio]"];
  lines.forEach((l, i) => {
    out.push(`${formatLrcTime(l.start_ms + offset)}${l.text}`);
    const next = lines[i + 1];
    if (!next || l.end_ms < next.start_ms) out.push(formatLrcTime(l.end_ms + offset));
  });
  return `${out.join("\n")}\n`;
}
