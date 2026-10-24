// Automatic section choice for "pnpm make --section auto": the first full chorus, ready for a 45-60 s
// short video.
//   Anchor: the first hook line ("* " in lyrics.txt; a single marked line per chorus is enough). Without
//           hooks: the first occurrence of the most repeated block of lines. Without repeats: the first line.
//   Start:  one bar before the anchor line (a musical lead-in), on a bar start (downbeat); if the line
//           before it is still being sung there, the bar before that line appears (never mid-line).
//   End:    on the first bar start after a lyric line has finished (never in the middle of a line),
//           45-60 s after the start; the end of a chorus line is preferred. If no such bar exists, up
//           to 65 s is allowed rather than cutting a line.
// Pure: the reason is returned as text so the command can print it.
import type { Beat } from "./beats";
import { normalizeLyric, type TimedWord } from "./lrc";

export type SectionLine = {
  text: string;
  start_ms: number;
  end_ms: number; // next stamp (LRC)
  isHook: boolean;
  sung_end_ms?: number; // end of the last sung word, when known (pnpm align report)
  words?: TimedWord[];
};

export type AutoSectionOptions = {
  durationMs: number;
  minMs?: number; // default 45 s
  maxMs?: number; // default 60 s
  hardMaxMs?: number; // default 65 s: allowed only so that no line is cut
  leadMs?: number; // lines appear this much before their stamp (default 250 ms)
  targetMs?: number; // platform presets: prefer the clean end nearest this length (else the latest)
  anchorMode?: "lead-in" | "centre"; // centre: the first chorus sits in the middle of the section
};

export type SectionChoice = {
  start_ms: number;
  end_ms: number;
  anchor: { kind: "hook" | "repeat" | "first-line" | "none"; line: number | null }; // line: 1-based
  endKind: "chorus-line" | "line" | "instrumental" | "extended" | "song-end" | "cuts-line";
  reason: string;
  warnings: string[];
};

export const SECTION_TARGET = { minMs: 45_000, maxMs: 60_000, hardMaxMs: 65_000 } as const;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const clockText = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;

// When the singing of a line stops: the aligner's last word end if known; otherwise the last word's
// start plus a typical word length in this line; otherwise the line's end stamp.
export function sungEnd(line: SectionLine): number {
  if (line.sung_end_ms !== undefined) return Math.min(line.sung_end_ms, line.end_ms);
  const words = line.words ?? [];
  if (words.length >= 2) {
    const span = words[words.length - 1].start_ms - words[0].start_ms;
    const typical = Math.min(1000, Math.max(250, span / (words.length - 1)));
    return Math.min(line.end_ms, words[words.length - 1].start_ms + typical);
  }
  if (words.length === 1) return Math.min(line.end_ms, words[0].start_ms + 1000);
  return line.end_ms;
}

// The most repeated block of consecutive lines (by words, case and punctuation ignored): the block
// covering the most lines in total (length x occurrences, occurrences not overlapping), at least 2
// occurrences; ties go to the earliest. Returns the start index of every occurrence and the length.
export function mostRepeatedBlock(texts: readonly string[]): { starts: number[]; length: number } | null {
  const keys = texts.map(normalizeLyric);
  let best: { starts: number[]; length: number; coverage: number } | null = null;
  const maxLength = Math.min(12, Math.floor(keys.length / 2));
  for (let length = maxLength; length >= 1; length--) {
    const seen = new Map<string, number[]>();
    for (let i = 0; i + length <= keys.length; i++) {
      const block = keys.slice(i, i + length);
      if (block.some((k) => !k)) continue;
      const key = block.join("\n");
      const starts = seen.get(key) ?? [];
      if (!starts.length || i >= starts[starts.length - 1] + length) starts.push(i);
      seen.set(key, starts);
    }
    for (const starts of seen.values()) {
      if (starts.length < 2) continue;
      const coverage = starts.length * length;
      if (!best || coverage > best.coverage || (coverage === best.coverage && starts[0] < best.starts[0])) {
        best = { starts, length, coverage };
      }
    }
  }
  return best ? { starts: best.starts, length: best.length } : null;
}

export function autoSection(lines: readonly SectionLine[], beats: readonly Beat[], options: AutoSectionOptions): SectionChoice {
  const minMs = options.minMs ?? SECTION_TARGET.minMs;
  const maxMs = options.maxMs ?? SECTION_TARGET.maxMs;
  const hardMaxMs = options.hardMaxMs ?? SECTION_TARGET.hardMaxMs;
  const leadMs = options.leadMs ?? 250;
  const duration = options.durationMs;
  const warnings: string[] = [];

  const downbeats = beats.filter((b) => b.is_downbeat).map((b) => b.time_ms).sort((a, b) => a - b);
  const gaps = downbeats.slice(1).map((t, i) => t - downbeats[i]).sort((a, b) => a - b);
  const bar = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2000;

  // 1. Anchor line (and which lines count as "chorus" for the end preference).
  const chorus = new Set<number>();
  let anchor: SectionChoice["anchor"];
  let anchorText: string;
  const firstHook = lines.findIndex((l) => l.isHook);
  if (firstHook >= 0) {
    lines.forEach((l, i) => l.isHook && chorus.add(i));
    anchor = { kind: "hook", line: firstHook + 1 };
    anchorText = `one bar before the first hook line (line ${firstHook + 1}, "${lines[firstHook].text}")`;
  } else {
    const block = mostRepeatedBlock(lines.map((l) => l.text));
    if (block) {
      for (const s of block.starts) for (let k = 0; k < block.length; k++) chorus.add(s + k);
      anchor = { kind: "repeat", line: block.starts[0] + 1 };
      anchorText =
        `one bar before line ${block.starts[0] + 1} "${lines[block.starts[0]].text}" (no hook lines; first of the ` +
        `most repeated block: ${block.length} line${block.length > 1 ? "s" : ""}, ${block.starts.length} times)`;
    } else if (lines.length) {
      anchor = { kind: "first-line", line: 1 };
      anchorText = `one bar before line 1 "${lines[0].text}" (no hook lines and no repeated lines)`;
    } else {
      anchor = { kind: "none", line: null };
      anchorText = "the first bar (no lyrics)";
    }
  }

  // When each line's singing ends, and which line (if any) is being sung or already on screen at `t`.
  const ends = lines.map(sungEnd);
  const singing = (t: number) => lines.findIndex((l, i) => l.start_ms - leadMs < t && t < ends[i]);

  // 2. Start: one bar before the anchor line, on a downbeat, and before the line appears on screen.
  let start: number;
  if (anchor.line === null) {
    start = downbeats[0] ?? 0;
  } else {
    const lineStart = lines[anchor.line - 1].start_ms;
    const latest = lineStart - leadMs; // the line must not be on screen before the video starts
    const usable = downbeats.filter((d) => d <= latest);
    if (!usable.length) {
      start = 0;
    } else {
      const target = lineStart - bar;
      start = usable.reduce((best, d) => (Math.abs(d - target) < Math.abs(best - target) ? d : best), usable[0]);
    }
  }

  // Never start in the middle of a line either: if the line before the anchor (e.g. the end of the
  // pre-chorus) is still being sung at that bar, start at the bar before that line appears instead.
  // At most 2 lines back; if the singing is continuous even then, keep the 1-bar lead-in and warn.
  let startNote = "";
  const isCut = (t: number) => {
    const i = singing(t);
    return i >= 0 && i !== (anchor.line ?? 0) - 1 ? i : -1;
  };
  let candidate = start;
  const moved: number[] = [];
  for (let steps = 0; steps < 2 && isCut(candidate) >= 0; steps++) {
    const cut = isCut(candidate);
    const earlier = downbeats.filter((d) => d <= lines[cut].start_ms - leadMs).pop();
    if (earlier === undefined || earlier >= candidate) break;
    moved.push(cut);
    candidate = earlier;
  }
  if (moved.length && isCut(candidate) < 0) {
    const first = moved[moved.length - 1];
    startNote = `; moved back to the bar before line ${first + 1} "${lines[first].text}" so it is not cut`;
    start = candidate;
  }
  // Centre mode (Reels): the first chorus (the hook line and the lines sung right after it) sits in
  // the middle of the section, starting on a bar where no line is cut.
  if (options.anchorMode === "centre" && options.targetMs && anchor.line !== null) {
    // The chorus: the hook line and the lines right after it that are sung again later in the song
    // (verse lines are unique), up to a pause.
    const a = anchor.line - 1;
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(normalizeLyric(l.text), (counts.get(normalizeLyric(l.text)) ?? 0) + 1);
    let last = a;
    while (
      last + 1 < lines.length &&
      lines[last + 1].start_ms <= lines[last].end_ms + 250 &&
      (counts.get(normalizeLyric(lines[last + 1].text)) ?? 0) >= 2 &&
      ends[last + 1] - lines[a].start_ms <= options.targetMs
    ) {
      last += 1;
    }
    const middle = (lines[a].start_ms + ends[last]) / 2;
    const desired = middle - options.targetMs / 2;
    const clean = downbeats.filter((d) => d <= lines[a].start_ms - leadMs && isCut(d) < 0);
    if (clean.length) {
      start = clean.reduce((best, d) => (Math.abs(d - desired) < Math.abs(best - desired) ? d : best), clean[0]);
      anchorText =
        `centred on the first chorus (line${last > a ? `s ${a + 1}-${last + 1}` : ` ${a + 1}`}, ` +
        `${clockText(lines[a].start_ms)}-${clockText(ends[last])}, from the hook line "${lines[a].text}")`;
      startNote = "";
    }
  }

  const startCut = isCut(start);
  if (startCut >= 0) {
    warnings.push(`The section start (${clockText(start)}) cuts line ${startCut + 1} "${lines[startCut].text}"; choose a section with --section.`);
  }

  // 3. End candidates: bar starts where no line is being sung or already on screen.
  type Candidate = { at: number; afterLine: number; firstBarAfterLine: boolean; chorusLine: boolean };
  const candidates: Candidate[] = [];
  const points = [...downbeats.filter((d) => d > start && d <= duration)];
  for (const at of points) {
    if (singing(at) >= 0) continue;
    let afterLine = -1;
    for (let i = 0; i < lines.length; i++) if (ends[i] <= at) afterLine = i;
    const previousBar = downbeats.filter((d) => d < at).pop();
    const firstBarAfterLine = afterLine >= 0 && (previousBar === undefined || previousBar < ends[afterLine]);
    candidates.push({ at, afterLine, firstBarAfterLine, chorusLine: afterLine >= 0 && chorus.has(afterLine) });
  }

  const length = (c: Candidate) => c.at - start;
  const inWindow = (c: Candidate) => length(c) >= minMs && length(c) <= maxMs;
  const inExtension = (c: Candidate) => length(c) > maxMs && length(c) <= hardMaxMs;
  const describeLine = (i: number) => `line ${i + 1} "${lines[i].text}"`;

  let end: number;
  let endKind: SectionChoice["endKind"];
  let endText: string;
  const after = (pool: Candidate[]) => pool.filter((c) => c.firstBarAfterLine);

  if (start + minMs > duration) {
    end = duration;
    endKind = "song-end";
    endText = `the song ends ${seconds(duration - start)} after the start (shorter than ${seconds(minMs)})`;
  } else {
    const windowed = after(candidates.filter(inWindow));
    const chorusEnds = windowed.filter((c) => c.chorusLine);
    const extended = after(candidates.filter(inExtension));
    const quiet = candidates.filter(inWindow);
    const quietExtended = candidates.filter(inExtension);
    // Range presets: the latest clean end; target presets: the clean end nearest the target.
    const pick = (pool: Candidate[]) =>
      options.targetMs ? pool.reduce((best, c) => (Math.abs(length(c) - options.targetMs!) < Math.abs(length(best) - options.targetMs!) ? c : best)) : pool[pool.length - 1];
    if (chorusEnds.length) {
      const c = pick(chorusEnds);
      [end, endKind] = [c.at, "chorus-line"];
      endText = `the first bar after chorus ${describeLine(c.afterLine)} finishes`;
    } else if (windowed.length) {
      const c = pick(windowed);
      [end, endKind] = [c.at, "line"];
      endText = `the first bar after ${describeLine(c.afterLine)} finishes (no chorus line ends between ${seconds(minMs)} and ${seconds(maxMs)})`;
    } else if (extended.length) {
      const c = extended[0];
      [end, endKind] = [c.at, "extended"];
      endText =
        `no bar between ${seconds(minMs)} and ${seconds(maxMs)} without cutting a line; ` +
        `extended to the first bar after ${describeLine(c.afterLine)} finishes`;
    } else if (quiet.length || quietExtended.length) {
      const c = quiet[0] ?? quietExtended[0];
      [end, endKind] = [c.at, "instrumental"];
      endText = "a bar start where nothing is sung";
    } else {
      // No bar start up to 65 s is free of singing: end on the bar nearest 60 s and say which line is cut.
      const pool = points.filter((d) => d - start <= hardMaxMs);
      end = pool.reduce((best, d) => (Math.abs(d - start - maxMs) < Math.abs(best - start - maxMs) ? d : best), pool[0] ?? start + maxMs);
      endKind = "cuts-line";
      const cut = singing(end);
      endText = `every bar start up to ${seconds(hardMaxMs)} is inside a lyric line; ending at the bar nearest ${seconds(maxMs)}`;
      if (cut >= 0) warnings.push(`The section end (${clockText(end)}) cuts ${describeLine(cut)}; choose a section with --section.`);
    }
  }

  const total = end - start;
  if (options.targetMs && endKind !== "song-end" && (total < minMs || total > maxMs)) {
    warnings.push(`The section is ${seconds(total)}, outside ${seconds(minMs)}-${seconds(maxMs)}: no clean bar to end on inside that range.`);
  }
  const reason =
    `start ${clockText(start)}: ${anchorText}${startNote}; ` +
    `end ${clockText(end)}: ${endText}; ${seconds(end - start)}`;
  return { start_ms: start, end_ms: end, anchor, endKind, reason, warnings };
}

// Lines already on screen when the video starts whose singing is over: an LRC line stays on screen
// until the next stamp, so the end of the verse can linger into the lead-in bar. These are not shown
// (a line still being sung at the start is shown from the first frame). Returns their indices.
export function finishedBeforeStart(lines: readonly SectionLine[], startMs: number, leadMs: number, offsetMs = 0, toleranceMs = 100): number[] {
  return lines.flatMap((l, i) => {
    const shownFrom = l.start_ms - leadMs + offsetMs;
    const shownUntil = l.end_ms - leadMs + offsetMs;
    return shownFrom < startMs - toleranceMs && shownUntil > startMs && sungEnd(l) <= startMs ? [i] : [];
  });
}
