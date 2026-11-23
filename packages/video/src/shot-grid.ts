// The shot grid (23 Nov 2026, Paul: "suppose we had to start again. You need to analyse the full song and plan each
// shot list according to the length of the song"). The music decides the timing, the story fills it: the whole song,
// 0:00 to its end, cut into shot moments: the intro, every lyric line (its start until the next line starts), the
// instrumental breaks and the ending. A moment shorter than a usable shot joins its neighbour; a moment longer than one
// good take is split into parts of whole bars. Each moment says its time, length, section and lyric line(s), so the
// Song brief can ask Claude to write one shot per moment, and the app can tell how long each planned shot lasts.
// Pure: the Song brief, the shot list check and Creation → Production use the same rules.
import { sectionOfLine, type NamedSection } from "./sections";

export type GridLine = { number: number; text: string; startMs: number | null; endMs: number | null };
export type GridKind = "intro" | "line" | "break" | "ending";
export type GridShot = {
  number: number; // 1-based, in the song's order
  startMs: number;
  endMs: number;
  kind: GridKind;
  line: number | null; // the lyric line the shot starts on (parts after the first: null, they follow the shot before)
  lines: number[]; // the lyric lines sung during it
  part: number; // 1-based part of its moment
  parts: number;
  section: string; // "Intro", "Verse 1", "Chorus", "Instrumental", "Ending"
};

// One video take: Midjourney makes 5 s (extendable by about 4 s at a time); Seedance 4-10 s. A shot of about 5 s is
// one take; up to 8 s still reads as one shot; under 2 s a shot is a flash.
export const TAKE = { idealMs: 5000, maxMs: 8000, minMs: 2000 } as const;
const BREAK_MS = 4000; // a pause after a line this long is its own (instrumental) moment

type Moment = { startMs: number; endMs: number; kind: GridKind; lines: number[] };

export function shotGrid(lines: readonly GridLine[], durationMs: number, o: { bpm?: number | null; sections?: readonly NamedSection[] } = {}): GridShot[] {
  const timed = lines.filter((l): l is GridLine & { startMs: number } => l.startMs !== null && l.startMs < durationMs).sort((a, b) => a.startMs - b.startMs);
  if (!timed.length || durationMs <= 0) return [];
  const moments: Moment[] = [];
  if (timed[0].startMs > 0) moments.push({ startMs: 0, endMs: timed[0].startMs, kind: "intro", lines: [] });
  timed.forEach((l, i) => {
    const next = timed[i + 1]?.startMs ?? durationMs;
    const sungEnd = Math.min(next, Math.max(l.startMs + 1, l.endMs ?? next));
    if (next - sungEnd >= BREAK_MS) {
      moments.push({ startMs: l.startMs, endMs: sungEnd, kind: "line", lines: [l.number] });
      moments.push({ startMs: sungEnd, endMs: next, kind: i + 1 < timed.length ? "break" : "ending", lines: [] });
    } else moments.push({ startMs: l.startMs, endMs: next, kind: "line", lines: [l.number] });
  });
  // Too short for a shot: an intro joins the first line, a line joins the next line (lines a-b), a break or the
  // ending joins the moment before it.
  const len = (m: Moment) => m.endMs - m.startMs;
  for (let i = 0; i < moments.length; ) {
    const m = moments[i];
    if (len(m) >= TAKE.minMs || moments.length === 1) {
      i++;
      continue;
    }
    const next = moments[i + 1];
    const prev = moments[i - 1];
    if ((m.kind === "intro" || m.kind === "line") && next && (next.kind === "line" || m.kind === "intro")) {
      moments.splice(i, 2, { startMs: m.startMs, endMs: next.endMs, kind: next.kind, lines: [...m.lines, ...next.lines] });
    } else if (prev) {
      moments.splice(i - 1, 2, { ...prev, endMs: m.endMs, lines: [...prev.lines, ...m.lines] });
      i--;
    } else if (next) {
      moments.splice(i, 2, { ...next, startMs: m.startMs, lines: [...m.lines, ...next.lines] });
    } else i++;
  }
  // Longer than one take: parts of whole bars (about 5 s each, none over 8 s when the bars allow).
  const bar = o.bpm && o.bpm > 0 ? (4 * 60_000) / o.bpm : null;
  const shots: Omit<GridShot, "number">[] = [];
  for (const m of moments) {
    const total = len(m);
    const parts = total > TAKE.maxMs ? Math.max(Math.ceil(total / TAKE.maxMs), Math.round(total / TAKE.idealMs)) : 1;
    const cuts = [m.startMs];
    for (let k = 1; k < parts; k++) {
      const even = m.startMs + (total * k) / parts;
      const snapped = bar ? m.startMs + Math.round((even - m.startMs) / bar) * bar : even;
      const at = Math.round(snapped > cuts[cuts.length - 1] + TAKE.minMs && snapped < m.endMs - TAKE.minMs ? snapped : even);
      cuts.push(at);
    }
    cuts.push(m.endMs);
    const section = m.kind === "intro" ? "Intro" : m.kind === "ending" ? "Ending" : m.kind === "break" ? "Instrumental" : (o.sections?.length ? sectionOfLine([...o.sections], m.lines[0])?.name : null) ?? "Song";
    for (let k = 0; k < parts; k++) {
      shots.push({ startMs: cuts[k], endMs: cuts[k + 1], kind: m.kind, line: k === 0 && m.lines.length ? m.lines[0] : null, lines: m.lines, part: k + 1, parts, section });
    }
  }
  return shots.map((s, i) => ({ number: i + 1, ...s }));
}

// How long each planned shot of a shot list lasts on the song: a shot on a line starts when the line starts and lasts
// until the next shot on a line (or the song's end); shots without a line share the time of the shot before them
// (before the first line: the intro). Pure; null for shots that cannot be timed (lyrics not timed).
export function slotSpans(
  slots: readonly { id: string; line: number | null }[],
  lines: readonly GridLine[],
  durationMs: number,
): Map<string, { startMs: number; endMs: number } | null> {
  const startOf = (n: number) => lines.find((l) => l.number === n)?.startMs ?? null;
  const out = new Map<string, { startMs: number; endMs: number } | null>();
  // Groups: a shot with a timed line, then the shots without a line after it (before the first: from 0).
  type Group = { startMs: number | null; ids: string[] };
  const groups: Group[] = [];
  for (const s of slots) {
    const at = s.line !== null ? startOf(s.line) : undefined;
    if (at !== undefined) groups.push({ startMs: at, ids: [s.id] });
    else if (groups.length) groups[groups.length - 1].ids.push(s.id);
    else groups.push({ startMs: 0, ids: [s.id] });
  }
  groups.forEach((g, i) => {
    const nextStart = groups.slice(i + 1).find((x) => x.startMs !== null)?.startMs ?? durationMs;
    if (g.startMs === null || nextStart <= g.startMs) {
      for (const id of g.ids) out.set(id, null);
      return;
    }
    const each = (nextStart - g.startMs) / g.ids.length;
    g.ids.forEach((id, k) => out.set(id, { startMs: Math.round(g.startMs! + k * each), endMs: Math.round(g.startMs! + (k + 1) * each) }));
  });
  return out;
}

// The shot list against the song, in plain words (warnings, never blocking): a shot longer than one take, a shot that
// is only a flash, the intro / long moments with too few shots. `number`: the shot's place (1-based) for the message.
export function timingNotes(slots: readonly { id: string; line: number | null }[], lines: readonly GridLine[], durationMs: number): { slot: string; text: string }[] {
  const spans = slotSpans(slots, lines, durationMs);
  const notes: { slot: string; text: string }[] = [];
  const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  for (const s of slots) {
    const span = spans.get(s.id);
    if (!span) continue;
    const length = span.endMs - span.startMs;
    const where = span.startMs === 0 && s.line === null ? "the intro" : s.line !== null ? `line ${s.line}` : "after the shot before it";
    if (length > TAKE.maxMs) {
      const more = Math.max(Math.ceil(length / TAKE.maxMs), Math.round(length / TAKE.idealMs)) - 1;
      notes.push({ slot: s.id, text: `lasts ${s1(length)} (${where}): one take is about 5 s. Extend its take to ${s1(length)}, or add ${more} shot${more === 1 ? "" : "s"} after it (without a line).` });
    } else if (length < TAKE.minMs) {
      notes.push({ slot: s.id, text: `lasts only ${s1(length)} (${where}): a flash. Join it with the shot before or after it.` });
    }
  }
  return notes;
}

const clock = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

// The grid as Markdown lines for the Song brief.
export function gridText(grid: readonly GridShot[], lines: readonly GridLine[]): string[] {
  const textOf = (n: number) => lines.find((l) => l.number === n)?.text ?? "";
  return grid.map((g) => {
    const id = `s${String(g.number).padStart(2, "0")}`;
    const part = g.parts > 1 ? ` (part ${g.part} of ${g.parts})` : "";
    const sung = g.lines.length ? (g.line !== null ? ` · line ${g.lines.length > 1 ? `${g.lines[0]}-${g.lines[g.lines.length - 1]}` : g.line}: "${g.lines.map(textOf).join(" / ")}"` : " · (no line: follows the shot before)") : "";
    return `- **${id}** · ${clock(g.startMs)}–${clock(g.endMs)} · ${((g.endMs - g.startMs) / 1000).toFixed(1)} s · ${g.section}${part}${sung}`;
  });
}
