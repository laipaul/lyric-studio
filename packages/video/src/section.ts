// Automatic section choice for "pnpm make --section auto".
//   Anchor: the first hook line ("* " in lyrics.txt; a single marked line per chorus is enough). Without
//           hooks: the first occurrence of the most repeated block of lines. Without repeats: the first line.
//   Clean cut: a bar start where no line is being sung, i.e. after a line's LAST WORD ENDS and before
//           the next line's FIRST WORD (word timings from the aligned LRC). Without word end times the
//           end is estimated from the word starts; without any word timings a line lasts until the
//           next line starts (line-start logic).
//   Start, "lead-in" (standard): one bar before the anchor line; if the line before it is still being
//           sung there, the bar before that line (at most 2 lines back).
//   Start, "hook-first" (Reels, TikTok, Shorts): at most one bar before the hook's first word, so the
//           hook is heard within ~2.5 s; never earlier.
//   End:    the first bar after a line's last word, inside the length window (standard: the latest,
//           45-60 s, up to 65 s rather than cutting; presets: nearest the target +-15%, else the nearest
//           clean line end up to 25% shorter, else up to 30% longer). Cutting a line is the last resort
//           and always gives a warning naming the line.
//   Loop:   (Reels, TikTok, Shorts loop on the platform) among the clean line ends inside the length
//           tolerance (chorus lines still first), the one whose last bar flows best into the first bar
//           (whole bars, level, harmony: options.loopFit) wins; the reason names the others.
//   Anchors: (story anchors, options.anchorsKept) among those clean ends (on a loop platform the ones
//           that loop well, when there are any), the ones that keep the most anchors; then the above.
// Pure: the reason is returned as text so the command can print it.
import type { Beat } from "./beats";
import { normalizeLyric, type TimedWord } from "./lrc";

export type SectionLine = {
  text: string;
  start_ms: number;
  end_ms: number; // next stamp (LRC)
  isHook: boolean;
  sung_end_ms?: number; // end of the last sung word, when known (LRC end tag or pnpm align report)
  words?: TimedWord[];
};

export type AutoSectionOptions = {
  durationMs: number;
  minMs?: number; // default 45 s
  maxMs?: number; // default 60 s
  hardMaxMs?: number; // default 65 s: allowed only so that no line is cut
  leadMs?: number; // lines appear this much before their stamp (default 250 ms)
  targetMs?: number; // platform presets: prefer the clean end nearest this length (else the latest)
  shortestMs?: number; // presets: a clean end down to this length is preferred over a longer one
  anchorMode?: "lead-in" | "hook-first"; // hook-first: start at most 1 bar before the hook
  // hook-first with the title opening: room for the title before the hook (2 bars, 1 when 2 bars are
  // longer than 5 s); the earliest clean bar in that reach.
  titleLead?: boolean;
  // Instrumentals: no line to start on; the section starts on this bar (the strongest stretch of the
  // music, src/story.ts), moved back to the bar before a story sentence it would cut.
  musicStartMs?: number;
  endOn?: "bar" | "beat"; // beat: when no bar is clean, any beat may end the section (bars still preferred)
  // Loop platforms: how well an end flows back into the start (lower score flows better).
  loopFit?: (startMs: number, endMs: number) => { score: number; ok: boolean; text: string };
  // Story anchors: how many anchored lines a section keeps (on screen and sung to the end inside it).
  anchorsKept?: (startMs: number, endMs: number) => { kept: number; total: number; missing: number[] };
};

export type SectionChoice = {
  start_ms: number;
  end_ms: number;
  anchor: { kind: "hook" | "repeat" | "first-line" | "music" | "none"; line: number | null }; // line: 1-based
  endKind: "chorus-line" | "line" | "shorter" | "instrumental" | "extended" | "song-end" | "cuts-line";
  cuts: SectionCut[]; // sung lines cut at the start or the end (empty when both are clean)
  reason: string;
  warnings: string[];
};

export const SECTION_TARGET = { minMs: 45_000, maxMs: 60_000, hardMaxMs: 65_000 } as const;
export const TITLE_LEAD_MAX_MS = 5000; // the title opening's lead-in before the hook: 2 bars, at most ~5 s

// How many bars the title opening may start before the first hook: 2, or 1 when 2 bars are longer than ~5 s.
export function titleLeadBars(barMs: number): number {
  return 2 * barMs <= TITLE_LEAD_MAX_MS ? 2 : 1;
}

// The typical bar length of a song: the median gap between its bar starts (2 s without any).
export function medianBarMs(downbeats: readonly number[]): number {
  const d = [...downbeats].sort((a, b) => a - b);
  const gaps = d.slice(1).map((t, i) => t - d[i]).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2000;
}

// The lead-in (ms) the title opening may take before the first sung line: what autoSection allows.
export function titleLeadMs(downbeats: readonly number[]): number {
  const bar = medianBarMs(downbeats);
  return titleLeadBars(bar) * bar;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const clockText = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;

export type SectionCut = { at: "start" | "end"; line: number; text: string; time_ms: number }; // line: 1-based

// When the singing of a line starts: its first word (the line stamp without word timings).
export function sungStart(line: SectionLine): number {
  return line.words?.[0]?.start_ms ?? line.start_ms;
}

// When the singing of a line stops: the last word's end if known (LRC end tag / aligner report);
// otherwise the last word's start plus a typical word length in this line; otherwise the line's end
// stamp (= the next line's start).
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
  const shortestMs = options.shortestMs ?? minMs;
  const leadMs = options.leadMs ?? 250;
  const duration = options.durationMs;
  const hookFirst = options.anchorMode === "hook-first";
  const warnings: string[] = [];

  const downbeats = beats.filter((b) => b.is_downbeat).map((b) => b.time_ms).sort((a, b) => a - b);
  const gaps = downbeats.slice(1).map((t, i) => t - downbeats[i]).sort((a, b) => a - b);
  const bar = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2000;
  const describeLine = (i: number) => `line ${i + 1} "${lines[i].text}"`;

  // 1. Anchor line (and which lines count as "chorus" for the end preference).
  const chorus = new Set<number>();
  let anchor: SectionChoice["anchor"];
  let anchorText: string;
  const leadBars = hookFirst && options.titleLead ? titleLeadBars(bar) : 1;
  const before = hookFirst ? (leadBars > 1 ? `at most ${leadBars} bars before (room for the title opening)` : options.titleLead ? "at most one bar before (room for the title opening)" : "at most one bar before") : "one bar before";
  const firstHook = lines.findIndex((l) => l.isHook);
  if (options.musicStartMs !== undefined) {
    anchor = { kind: "music", line: null };
    anchorText = "the strongest stretch of the music (an instrumental)";
  } else if (firstHook >= 0) {
    lines.forEach((l, i) => l.isHook && chorus.add(i));
    anchor = { kind: "hook", line: firstHook + 1 };
    anchorText = `${before} the first hook line (line ${firstHook + 1}, "${lines[firstHook].text}")`;
  } else {
    const block = mostRepeatedBlock(lines.map((l) => l.text));
    if (block) {
      for (const s of block.starts) for (let k = 0; k < block.length; k++) chorus.add(s + k);
      anchor = { kind: "repeat", line: block.starts[0] + 1 };
      anchorText =
        `${before} line ${block.starts[0] + 1} "${lines[block.starts[0]].text}" (no hook lines; first of the ` +
        `most repeated block: ${block.length} line${block.length > 1 ? "s" : ""}, ${block.starts.length} times)`;
    } else if (lines.length) {
      anchor = { kind: "first-line", line: 1 };
      anchorText = `${before} line 1 "${lines[0].text}" (no hook lines and no repeated lines)`;
    } else {
      anchor = { kind: "none", line: null };
      anchorText = "the first bar (no lyrics)";
    }
  }

  // Which line (if any) is being sung at `t`: after its first word starts and before its last word ends.
  const starts = lines.map(sungStart);
  const ends = lines.map(sungEnd);
  const singing = (t: number) => lines.findIndex((_, i) => starts[i] < t && t < ends[i]);
  const isCut = (t: number) => {
    const i = singing(t);
    return i >= 0 && i !== (anchor.line ?? 0) - 1 ? i : -1;
  };

  // 2. Start.
  let start: number;
  let startNote = "";
  if (options.musicStartMs !== undefined) {
    const at = options.musicStartMs;
    start = downbeats.filter((d) => d <= at + 1).pop() ?? downbeats[0] ?? 0;
    // Never in the middle of a story sentence: the bar before it appears.
    const i = lines.findIndex((l) => l.start_ms - leadMs < start && start < sungEnd(l));
    if (i >= 0) {
      const earlier = downbeats.filter((d) => d <= lines[i].start_ms - leadMs).pop();
      if (earlier !== undefined) {
        startNote = `; moved back to the bar before "${lines[i].text}" so it is not cut`;
        start = earlier;
      }
    }
  } else if (anchor.line === null) {
    start = downbeats[0] ?? 0;
  } else if (hookFirst) {
    // At most one bar before the hook's first word (a little tolerance for the bar grid), on a bar:
    // the earliest such bar that cuts no line, else the one nearest the hook.
    const hookAt = starts[anchor.line - 1];
    const inReach = downbeats.filter((d) => d <= hookAt && d >= hookAt - leadBars * bar - 150);
    const clean = inReach.filter((d) => isCut(d) < 0);
    start = clean[0] ?? inReach[inReach.length - 1] ?? downbeats.filter((d) => d <= hookAt).pop() ?? 0;
    startNote = ` (${seconds(hookAt - start)} before the hook)`;
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
    // Never start in the middle of a line either: if the line before the anchor (e.g. the end of the
    // pre-chorus) is still being sung at that bar, start at the bar before that line appears instead.
    // At most 2 lines back; if the singing is continuous even then, keep the 1-bar lead-in and warn.
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
  }

  // 3. End candidates: bar starts (and, with endOn "beat", other beats) where no line is being sung.
  type Candidate = { at: number; afterLine: number; firstAfterLine: boolean; chorusLine: boolean; unit: "bar" | "beat" };
  const build = (grid: number[], unit: "bar" | "beat"): Candidate[] => {
    const out: Candidate[] = [];
    for (const at of grid) {
      if (at <= start || at > duration || singing(at) >= 0) continue;
      let afterLine = -1;
      for (let i = 0; i < lines.length; i++) if (ends[i] <= at) afterLine = i;
      const previous = grid.filter((d) => d < at).pop();
      const firstAfterLine = afterLine >= 0 && (previous === undefined || previous < ends[afterLine]);
      out.push({ at, afterLine, firstAfterLine, chorusLine: afterLine >= 0 && chorus.has(afterLine), unit });
    }
    return out;
  };
  const barCandidates = build(downbeats, "bar");
  const beatGrid = beats.map((b) => b.time_ms).sort((a, b) => a - b);
  const beatCandidates = options.endOn === "beat" ? build(beatGrid, "beat") : [];
  const points = downbeats.filter((d) => d > start && d <= duration);

  const length = (c: Candidate) => c.at - start;
  const within = (lo: number, hi: number) => (c: Candidate) => length(c) >= lo && length(c) <= hi;
  const after = (pool: Candidate[]) => pool.filter((c) => c.firstAfterLine);
  const target = options.targetMs;
  const nearest = (pool: Candidate[], to: number) => pool.reduce((best, c) => (Math.abs(length(c) - to) < Math.abs(length(best) - to) ? c : best));

  let end: number;
  let endKind: SectionChoice["endKind"];
  let endText: string;
  let loopNote = "";

  // Story anchors: of the clean ends in the window, the ones that keep the most anchors (on a loop
  // platform only among the ends that loop well, when there are any).
  let anchorNote = "";
  const keepAnchors = (pool: Candidate[]): Candidate[] => {
    if (!options.anchorsKept || pool.length < 1) return pool;
    const kept = pool.map((c) => ({ c, k: options.anchorsKept!(start, c.at) }));
    if (!kept[0].k.total) return pool;
    const flowing = options.loopFit ? kept.filter((x) => options.loopFit!(start, x.c.at).ok) : kept;
    const consider = flowing.length ? flowing : kept;
    const most = Math.max(...consider.map((x) => x.k.kept));
    const best = consider.filter((x) => x.k.kept === most);
    const fewer = kept.filter((x) => x.k.kept < most).map((x) => `${clockText(x.c.at)} keeps ${x.k.kept}`);
    const missing = best[0].k.missing;
    anchorNote =
      `; anchors: keeps ${most} of ${best[0].k.total}${missing.length ? ` (not: line ${missing.join(", ")})` : ""}` + (fewer.length ? `, more than ${fewer.join(", ")}` : "");
    return best.map((x) => x.c);
  };

  // Loop platforms: of the clean ends in the window, the one that flows best back into the start;
  // a small share of the distance to the target breaks near-ties.
  const pickLoop = (pool: Candidate[]): Candidate => {
    const fits = pool.map((c) => ({ c, fit: options.loopFit!(start, c.at) }));
    const total = (f: (typeof fits)[number]) => f.fit.score + (target ? (Math.abs(length(f.c) - target) / target) * 0.5 : 0);
    const best = fits.reduce((a, b) => (total(b) < total(a) ? b : a));
    const others = fits.filter((f) => f !== best).map((f) => `${clockText(f.c.at)} (${f.fit.text})`);
    loopNote = others.length
      ? `; loop: ${clockText(best.c.at)} flows best back into the start (${best.fit.text}); also clean: ${others.join(", ")}`
      : `; loop: the only clean end in the window (${best.fit.text})`;
    return best.c;
  };

  if (start + shortestMs > duration) {
    end = duration;
    endKind = "song-end";
    endText = `the song ends ${seconds(duration - start)} after the start (shorter than ${seconds(shortestMs)})`;
  } else {
    // Range presets (standard): the latest clean end; target presets: the clean end nearest the target.
    const pick = (pool: Candidate[]) => (target ? nearest(pool, target) : pool[pool.length - 1]);
    const range = `${seconds(minMs)}-${seconds(maxMs)}`;
    // Each length tier tries bar ends first, then (TikTok, Shorts) any beat.
    const grids = [barCandidates, ...(beatCandidates.length ? [beatCandidates] : [])];
    const tier = (choose: (pool: Candidate[]) => Candidate | undefined) => {
      for (const g of grids) {
        const c = choose(g);
        if (c) return c;
      }
      return undefined;
    };
    const windowEnd = tier((g) => {
      const pool = after(g.filter(within(minMs, maxMs)));
      const chorusPool = pool.filter((c) => c.chorusLine);
      const choose = (pool: Candidate[]) => (options.loopFit ? pickLoop : pick)(keepAnchors(pool));
      return chorusPool.length ? choose(chorusPool) : pool.length ? choose(pool) : undefined;
    });
    const shorterEnd = target ? tier((g) => after(g.filter(within(shortestMs, minMs - 1))).pop()) : undefined;
    const longerEnd = tier((g) => after(g.filter(within(maxMs + 1, hardMaxMs)))[0]);
    const quietEnd = tier((g) => {
      const pool = g.filter(within(shortestMs, hardMaxMs));
      return pool.length ? (target ? nearest(pool, target) : pool[0]) : undefined;
    });
    if (windowEnd) {
      end = windowEnd.at;
      endKind = windowEnd.chorusLine ? "chorus-line" : "line";
      endText = windowEnd.chorusLine
        ? `the first ${windowEnd.unit} after chorus ${describeLine(windowEnd.afterLine)} finishes`
        : `the first ${windowEnd.unit} after ${describeLine(windowEnd.afterLine)} finishes (no chorus line ends within ${range})`;
    } else if (shorterEnd) {
      [end, endKind] = [shorterEnd.at, "shorter"];
      endText = `shorter than the target: no clean line end within ${range}; the nearest clean end is the ${shorterEnd.unit} after ${describeLine(shorterEnd.afterLine)}`;
    } else if (longerEnd) {
      [end, endKind] = [longerEnd.at, "extended"];
      endText = target
        ? `longer than the target: no clean line end within ${range} or up to 25% shorter; the nearest clean end is the ${longerEnd.unit} after ${describeLine(longerEnd.afterLine)}`
        : `no bar within ${range} without cutting a line; extended to the first bar after ${describeLine(longerEnd.afterLine)} finishes`;
    } else if (quietEnd) {
      [end, endKind] = [quietEnd.at, "instrumental"];
      endText = `a ${quietEnd.unit} where nothing is sung`;
    } else {
      // No bar start in reach is free of singing: end on the bar nearest the target and name the cut line.
      const goal = target ?? maxMs;
      const pool = points.filter((d) => d - start <= hardMaxMs);
      end = pool.reduce((best, d) => (Math.abs(d - start - goal) < Math.abs(best - start - goal) ? d : best), pool[0] ?? start + goal);
      endKind = "cuts-line";
      endText = `every ${beatCandidates.length ? "beat" : "bar start"} up to ${seconds(hardMaxMs)} is inside a sung line; ending at the bar nearest ${seconds(goal)}`;
    }
  }

  // Sung lines cut at either end (the hook line itself never counts as cut at the start).
  const cuts: SectionCut[] = [];
  const startCut = isCut(start);
  if (startCut >= 0) cuts.push({ at: "start", line: startCut + 1, text: lines[startCut].text, time_ms: start });
  const endCut = singing(end);
  if (endCut >= 0 && endKind !== "song-end") cuts.push({ at: "end", line: endCut + 1, text: lines[endCut].text, time_ms: end });
  for (const c of cuts) {
    warnings.push(`The section ${c.at} (${clockText(c.time_ms)}) cuts line ${c.line} "${c.text}" while it is sung; choose a section with --section.`);
  }

  const reason =
    `start ${clockText(start)}: ${anchorText}${startNote}; ` +
    `end ${clockText(end)}: ${endText}; ${seconds(end - start)}${anchorNote}${loopNote}`;
  return { start_ms: start, end_ms: end, anchor, endKind, reason, warnings, cuts };
}

// Sung lines cut by a section chosen by hand (--section), for the QA check.
export function sectionCuts(lines: readonly SectionLine[], startMs: number, endMs: number): SectionCut[] {
  const out: SectionCut[] = [];
  for (const [at, t] of [["start", startMs], ["end", endMs]] as const) {
    const i = lines.findIndex((l) => sungStart(l) < t && t < sungEnd(l));
    if (i >= 0) out.push({ at, line: i + 1, text: lines[i].text, time_ms: t });
  }
  return out;
}

// Lines whose first word comes at or after the end of the video: they would only flash up in the
// last 0.25 s (they appear before their stamp), so they are not shown. Returns their indices.
export function startsAfterEnd(lines: readonly SectionLine[], endMs: number, leadMs: number, offsetMs = 0): number[] {
  return lines.flatMap((l, i) => (sungStart(l) + offsetMs >= endMs && l.start_ms - leadMs + offsetMs < endMs ? [i] : []));
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
