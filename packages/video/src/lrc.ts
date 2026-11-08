// LRC lyrics: "[mm:ss.xx]text". A stamp with no text ends the previous line (pause / last line end).
// A line starting with "* " is a hook; every line with the same words (see normalizeLyric) is then
// a hook too, so marking one chorus occurrence marks them all.
// Enhanced LRC (from "pnpm align") also has word tags: "[00:14.00]<00:14.00>Hope <00:14.42>is <00:14.90>";
// a last tag with no word after it is where the last word ends (the line's singing stops there).
export type TimedWord = { text: string; start_ms: number };
export type TimedLine = { text: string; start_ms: number; end_ms: number; isHook: boolean; words?: TimedWord[]; sung_end_ms?: number };

const STAMP = /\[(\d+):(\d{1,2}(?:\.\d{1,3})?)\]/g;
const WORD_TAG = /<(\d+):(\d{1,2}(?:\.\d{1,3})?)>/g;
const tagMs = (m: string, s: string) => Math.round((Number(m) * 60 + Number(s)) * 1000);

// Line text without word tags, and the word timings if there are any.
function splitWords(body: string): { text: string; words?: TimedWord[]; sung_end_ms?: number } {
  const tags = [...body.matchAll(WORD_TAG)];
  const text = body.replace(WORD_TAG, " ").replace(/\s+/g, " ").trim();
  if (!tags.length) return { text };
  const words = tags.map((t, i) => ({
    start_ms: tagMs(t[1], t[2]),
    text: body.slice((t.index ?? 0) + t[0].length, tags[i + 1]?.index ?? body.length).trim(),
  }));
  const last = words[words.length - 1];
  return { text, words: words.filter((w) => w.text), ...(words.length > 1 && !last.text ? { sung_end_ms: last.start_ms } : {}) };
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
  const stamps: { ms: number; text: string; isHook: boolean; words?: TimedWord[]; sung_end_ms?: number }[] = [];
  for (const raw of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const times = [...raw.matchAll(STAMP)];
    if (!times.length) continue;
    const body = raw.replace(STAMP, "").trim();
    const isHook = HOOK_MARKER.test(body);
    const { text, words, sung_end_ms } = splitWords(body.replace(HOOK_MARKER, "").trim());
    for (const t of times) stamps.push({ ms: tagMs(t[1], t[2]), text, isHook, ...(words ? { words } : {}), ...(sung_end_ms !== undefined ? { sung_end_ms } : {}) });
  }
  stamps.sort((a, b) => a.ms - b.ms);

  const lines: TimedLine[] = [];
  stamps.forEach((s, i) => {
    if (!s.text) return; // end / pause marker
    const end = stamps[i + 1]?.ms ?? fallbackEndMs;
    if (end !== undefined && end > s.ms) {
      lines.push({
        text: s.text,
        start_ms: s.ms,
        end_ms: end,
        isHook: s.isHook,
        ...(s.words ? { words: s.words } : {}),
        ...(s.sung_end_ms !== undefined ? { sung_end_ms: s.sung_end_ms } : {}),
      });
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

// A lyric line's words fixed by hand (a typo, a word heard wrong), its timing kept: the `number`-th sung
// line of an LRC (1-based, in time order) gets `text`. With word tags, words that stay as many keep their
// own times; a different number of words shares the line's sung span evenly (from its first word to where
// it stops singing). Stamps, the hook marker and the line's end stay as they were.
const pad2 = (n: number) => String(n).padStart(2, "0");
export function lrcTag(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  return `${pad2(Math.floor(cs / 6000))}:${((cs % 6000) / 100).toFixed(2).padStart(5, "0")}`;
}
// The sung lines of an LRC (one stamp and words), in time order: what "line N" means for the Lyrics tab.
function sungRows(rows: readonly string[]) {
  return rows
    .map((raw, index) => {
      const times = [...raw.matchAll(STAMP)];
      const body = raw.replace(STAMP, "").trim();
      return { index, ms: times.length ? tagMs(times[0][1], times[0][2]) : -1, times: times.length, body };
    })
    .filter((r) => r.times === 1 && r.body.replace(HOOK_MARKER, "").replace(WORD_TAG, "").trim())
    .sort((a, b) => a.ms - b.ms || a.index - b.index);
}

// Lines taken out of an LRC (1-based numbers as in the Lyrics tab): their rows go, and the stamp-only row that
// ends such a line right after it (its end marker; not after the last line: that one ends the line before). Every other row stays exactly as it was, so every other
// line keeps its own timing. null when the LRC does not have `expected` sung lines (it does not match the text).
export function dropLrcLines(content: string, drop: ReadonlySet<number>, expected: number): string | null {
  const rows = content.split(/(?<=\n)/);
  const sung = sungRows(rows);
  if (sung.length !== expected) return null;
  const sungAt = new Set(sung.map((r) => r.index));
  const marks = rows
    .map((raw, index) => ({ index, stamps: [...raw.matchAll(STAMP)], body: raw.replace(STAMP, "").trim() }))
    .filter((r) => !sungAt.has(r.index) && r.stamps.length === 1 && !r.body)
    .map((r) => ({ index: r.index, ms: tagMs(r.stamps[0][1], r.stamps[0][2]) }))
    .sort((x, y) => x.ms - y.ms);
  const gone = new Set<number>();
  sung.forEach((r, k) => {
    if (!drop.has(k + 1)) return;
    gone.add(r.index);
    const end = marks.find((m) => m.ms > r.ms);
    if (end && sung[k + 1] && end.ms <= sung[k + 1].ms) gone.add(end.index); // the last line's end marker stays: it ends the line before
  });
  return rows.filter((_, i) => !gone.has(i)).join("");
}

export function retextLrcLine(content: string, number: number, text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error("The line's new text is empty.");
  const rows = content.split(/(?<=\n)/);
  const sung = sungRows(rows);
  const row = sung[number - 1];
  if (!row) throw new Error(`There is no line ${number} in the timing.`);
  const raw = rows[row.index];
  const eol = raw.match(/\r?\n$/)?.[0] ?? "";
  const prefix = raw.match(/^\s*(?:\[\d+:\d{1,2}(?:\.\d{1,3})?\])+/)?.[0] ?? "";
  const hook = HOOK_MARKER.test(row.body) ? "* " : "";
  const old = splitWords(row.body.replace(HOOK_MARKER, "").trim());
  let body: string;
  if (!old.words?.length) body = words.join(" ");
  else {
    const from = old.words[0].start_ms;
    const last = old.words[old.words.length - 1].start_ms;
    const to = old.sung_end_ms ?? last + Math.max(200, old.words.length > 1 ? (last - from) / (old.words.length - 1) : 400);
    const starts = words.length === old.words.length ? old.words.map((w) => w.start_ms) : words.map((_, k) => Math.round(from + ((to - from) * k) / words.length));
    body = `${words.map((w, k) => `<${lrcTag(starts[k])}>${w}`).join(" ")}${old.sung_end_ms !== undefined ? ` <${lrcTag(old.sung_end_ms)}>` : ""}`;
  }
  rows[row.index] = `${prefix}${hook}${body}${eol}`;
  return rows.join("");
}
