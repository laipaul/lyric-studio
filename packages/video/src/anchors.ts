// Story anchors (song.json "anchors": [{ line: 9, clip: "hands.mp4", clipIn?: 1.5, transition?: "dissolve" }]):
// a clip that lands on one lyric line (its number in the Lyrics tab: sung lines counted, blank lines
// not, as in check-start and hints.lrc; a repeated chorus line can land on another clip each time).
//   Cut:   on the downbeat at or just before the line's on-screen time (earlyCutFrames before it, as
//          every cut), held until at least the line's sung end; the next cut is the first regular cut
//          after that. Anchors win over the regular cut rate; regular cuts fill the gaps.
//   Never dropped silently: an anchor that cannot be placed (too close to another, too near the end of
//          the section) says why; anchors outside a platform's section are listed as such.
//   Dissolve: ~1 bar centred on the downbeat (less when a neighbouring shot is short).
//   Lip sync ("sync", 21 Nov 2026): a singing clip made for this moment of the song (Lyrics Sync → Singer): its first
//          frame belongs at song second `sync`. It cuts in on the downbeat (never before its footage starts), plays
//          at exactly normal speed from the frame that matches the song at the cut, always with a hard cut, and is
//          never used to fill other shots: the lips stay in time with the song.
// Pure: pnpm make, the preview and the Lyrics tab use the same rules.
import type { Beat } from "./beats";
import { cutPointAt, type CutPlan, type CutPoint } from "./cuts";

export type AnchorTransition = "cut" | "dissolve";
export type AnchorSpec = { line: number; clip: string; clipIn?: number; transition?: AnchorTransition; sync?: number }; // song.json (sync: song seconds of the clip's first frame)
export type GapOrder = "story" | "shuffle";

// An anchor whose clip was found; `lyric` is the line's index in the render's lyric list.
export type ResolvedAnchor = { line: number; text: string; lyric: number; clipId: string; clipName: string; clipInMs: number | null; transition: AnchorTransition; syncMs?: number | null };

export type AnchorUse = {
  line: number;
  text: string;
  clip: string;
  used: boolean;
  shot: number | null; // 0-based shot index in the video
  at_ms: number | null; // song time where its shot starts
  transition: AnchorTransition;
  why: string | null; // not used: why; used: how (e.g. "on the beat at 0:41.5: the bar is taken by line 8")
  playback_rate?: number; // < 1: slowed to cover its line (QA WARN)
  lipsync?: boolean; // a singing clip locked to the song (always in time)
};

export type AnchorPlan = {
  plan: CutPlan; // the regular cuts with the anchor cuts merged in
  shots: Map<number, ResolvedAnchor>; // shot index -> anchor
  uses: AnchorUse[];
  conflicts: string[]; // QA WARN, naming the lines
  notes: string[];
};

export const ANCHOR_REPEAT_MS = 8000; // the same clip anchored twice this close: the repeat is visible
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
const lineName = (a: { line: number; text: string }) => `line ${a.line} "${a.text}"`;

export type AnchorLine = { startFrame: number; endFrame: number; sungEndFrame?: number }; // section-relative (lyricFrames)

// Places the anchors in a section's cut plan. `beats`: the song's beats (downbeat offset applied);
// `lines[a.lyric]`: each anchored line's on-screen frames relative to the section.
export function planAnchors(
  plan: CutPlan,
  beats: readonly Beat[],
  anchors: readonly ResolvedAnchor[],
  lines: readonly AnchorLine[],
  o: { earlyCutFrames?: number; minShotFrames?: number } = {},
): AnchorPlan {
  const fps = plan.fps;
  const early = o.earlyCutFrames ?? 2;
  const minShot = o.minShotFrames ?? Math.ceil(0.8 * fps);
  const start = plan.start_frame;
  const end = plan.end_frame;
  const msOf = (frame: number) => Math.round((frame * 1000) / fps);
  const uses: AnchorUse[] = [];
  const conflicts: string[] = [];
  const notes: string[] = [];
  const base = (a: ResolvedAnchor) => ({ line: a.line, text: a.text, clip: a.clipName, transition: a.syncMs != null ? ("cut" as const) : a.transition, ...(a.syncMs != null ? { lipsync: true } : {}) });

  type Placed = { a: ResolvedAnchor; cut: CutPoint | null; frame: number; hold: number; use: AnchorUse };
  const placed: Placed[] = [];
  const byTime = [...anchors].sort((x, y) => (lines[x.lyric]?.startFrame ?? 0) - (lines[y.lyric]?.startFrame ?? 0) || x.line - y.line);
  for (const a of byTime) {
    const l = lines[a.lyric];
    const duration = end - start;
    if (!l || l.startFrame >= duration || l.endFrame <= 0) {
      uses.push({ ...base(a), used: false, shot: null, at_ms: null, why: "outside this section" });
      continue;
    }
    const appear = start + Math.max(0, l.startFrame);
    // A singing clip has no footage before its first frame: no cut before it (song frames).
    const footage = a.syncMs != null ? Math.ceil((a.syncMs * fps) / 1000) : -Infinity;
    const hold = start + Math.max(l.sungEndFrame ?? l.endFrame, Math.max(0, l.startFrame) + 1);
    const prev = placed.at(-1);
    const after = prev ? prev.frame + minShot : start + minShot;
    // Candidate cuts at or before the line's on-screen time: downbeats first, then (only when the bar is
    // taken by the previous anchor) any beat.
    const candidates = (downbeatsOnly: boolean) =>
      beats
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => !downbeatsOnly || b.is_downbeat)
        .map(({ i }) => cutPointAt(beats, i, fps, early))
        .filter((c) => c.frame <= appear && c.frame >= footage)
        .reverse();
    const bar = candidates(true)[0];
    let cut: CutPoint | null = null;
    let how: string | null = null;
    const singerLate = a.syncMs != null && !bar && !(start >= footage) ? beats.map((_, i) => cutPointAt(beats, i, fps, early)).find((c) => c.frame >= footage && c.frame >= after) : undefined;
    if (singerLate) {
      cut = singerLate; // the singing clip starts after the downbeat: the first beat with footage
      how = `on the beat at ${clock(singerLate.beat_time_ms)}: the singing clip starts there`;
    } else if (!prev && (!bar || bar.frame < start + minShot) && start >= footage) {
      cut = null; // the first shot of the video
      how = "from the first frame";
    } else if (bar && bar.frame >= after) {
      cut = bar;
    } else {
      const beat = candidates(false).find((c) => c.frame >= after);
      if (beat && prev) {
        cut = beat;
        how = `on the beat at ${clock(beat.beat_time_ms)}: the bar is taken by line ${prev.a.line}`;
        conflicts.push(`${lineName(a)} and line ${prev.a.line} are too close (one bar): ${lineName(a)} cuts in on the beat at ${clock(beat.beat_time_ms)} instead of the downbeat`);
      } else {
        const by = prev ? `too close to line ${prev.a.line} (anchored at ${clock(msOf(prev.frame))}): no beat left for it` : "too close to the start of this section";
        uses.push({ ...base(a), used: false, shot: null, at_ms: null, why: by });
        conflicts.push(`${lineName(a)} (${a.clipName}) is not shown: ${by}`);
        continue;
      }
    }
    const frame = cut ? cut.frame : start;
    if (frame > end - minShot) {
      const why = "too close to the end of this section";
      uses.push({ ...base(a), used: false, shot: null, at_ms: null, why });
      conflicts.push(`${lineName(a)} (${a.clipName}) is not shown: ${why}`);
      continue;
    }
    if (prev && prev.hold > frame) {
      conflicts.push(`line ${prev.a.line} "${prev.a.text}" (${prev.a.clipName}) cannot stay until its line ends (${clock(msOf(prev.hold))}): ${lineName(a)} cuts in at ${clock(msOf(frame))}`);
    }
    const use: AnchorUse = { ...base(a), used: true, shot: null, at_ms: msOf(frame), why: how };
    uses.push(use);
    placed.push({ a, cut, frame, hold: Math.max(hold, frame + minShot), use });
  }

  // The same clip anchored twice close together.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const x = placed[i];
      const y = placed[j];
      if (x.a.clipId === y.a.clipId && msOf(y.frame - x.frame) < ANCHOR_REPEAT_MS) {
        conflicts.push(`lines ${x.a.line} and ${y.a.line} both land on ${x.a.clipName}, ${((y.frame - x.frame) / fps).toFixed(1)} s apart: the repeat is visible`);
      }
    }
  }

  // Regular cuts inside an anchored shot (or too close before it) give way; an anchor's shot lasts until
  // the first regular cut after its line ends (or the next anchor).
  const regular = plan.cuts.filter((c) => !placed.some((p) => c.frame > p.frame - minShot && c.frame < p.hold));
  const cuts = [...regular, ...placed.flatMap((p) => (p.cut ? [p.cut] : []))].sort((x, y) => x.frame - y.frame);
  const merged = cuts.filter((c, i) => i === 0 || c.frame !== cuts[i - 1].frame);
  const bounds = [start, ...merged.map((c) => c.frame)];
  const shots = new Map<number, ResolvedAnchor>();
  for (const p of placed) {
    const index = bounds.indexOf(p.frame);
    p.use.shot = index;
    shots.set(index, p.a);
  }
  const outside = uses.filter((u) => !u.used && u.why === "outside this section");
  if (outside.length) notes.push(`not in this section: ${outside.map((u) => `line ${u.line} (${u.clip})`).join(", ")}`);
  return { plan: { ...plan, cuts: merged }, shots, uses: uses.sort((x, y) => x.line - y.line), conflicts, notes };
}

// A dissolve into shot `index`: `before` frames over the previous shot, `after` frames into this one
// (about one bar centred on the cut; at most half of either shot; `after` only if the previous clip has
// frames left to keep playing).
export function dissolveFrames(barFrames: number, previousShot: number, thisShot: number, previousFramesLeft: number): { before: number; after: number } {
  const half = Math.floor(barFrames / 2);
  const after = Math.max(0, Math.min(half, Math.floor(thisShot / 2), previousFramesLeft));
  const before = Math.max(0, Math.min(barFrames - after, Math.floor(previousShot / 2)));
  return { before, after };
}

// Song-level checks for the Lyrics tab (and printed by pnpm make): what will clash before any section is
// chosen. `lines`: every line by its lyrics.txt number with its on-screen start and sung end (song ms).
export function anchorProblems(
  anchors: readonly AnchorSpec[],
  lines: ReadonlyMap<number, { text: string; shownMs: number; sungEndMs: number }>,
  clips: ReadonlyMap<string, number | null>, // clip name (lower case) -> duration ms (null: a photo)
  downbeats: readonly number[], // song ms
  minShotMs = 800,
): { line: number; problem: string }[] {
  const out: { line: number; problem: string }[] = [];
  const barOf = (ms: number) => downbeats.filter((d) => d <= ms).at(-1) ?? 0;
  const seen = new Map<number, AnchorSpec>();
  const sorted = [...anchors].sort((a, b) => (lines.get(a.line)?.shownMs ?? 0) - (lines.get(b.line)?.shownMs ?? 0));
  let previous: { a: AnchorSpec; bar: number } | null = null;
  for (const a of sorted) {
    if (seen.has(a.line)) out.push({ line: a.line, problem: `line ${a.line} is anchored twice` });
    seen.set(a.line, a);
    const l = lines.get(a.line);
    if (!l) {
      out.push({ line: a.line, problem: `line ${a.line} is not a sung line of this song` });
      continue;
    }
    const key = a.clip.toLowerCase();
    if (!clips.has(key)) out.push({ line: a.line, problem: `${a.clip} is not in the song's clips or its collections` });
    const length = clips.get(key);
    const lineMs = l.sungEndMs - l.shownMs;
    if (a.sync !== undefined && length !== null && length !== undefined) {
      // A singing clip: it must have footage from the cut (the downbeat before the line) to the line's sung end.
      const from = a.sync * 1000;
      const to = from + length;
      const cutAt = barOf(l.shownMs);
      if (from > l.shownMs) out.push({ line: a.line, problem: `the singing clip ${a.clip} starts ${((from - l.shownMs) / 1000).toFixed(1)} s after line ${a.line} shows: make it again (it starts too late)` });
      else if (downbeats.length && from > cutAt + 1) out.push({ line: a.line, problem: `the singing clip ${a.clip} starts after the downbeat before line ${a.line}: it cuts in a little later, on a beat` });
      if (to < l.sungEndMs) out.push({ line: a.line, problem: `the singing clip ${a.clip} ends ${((l.sungEndMs - to) / 1000).toFixed(1)} s before line ${a.line} is sung: its last frame holds` });
    } else if (length !== null && length !== undefined) {
      const left = length - (a.clipIn ?? 0) * 1000;
      if (left < lineMs) {
        out.push({ line: a.line, problem: `${a.clip} has ${(Math.max(0, left) / 1000).toFixed(1)} s${a.clipIn ? ` from ${a.clipIn} s` : ""}, line ${a.line} lasts ${(lineMs / 1000).toFixed(1)} s: it will be slowed to ${Math.max(0.5, left / lineMs).toFixed(2)}x${left / lineMs < 0.5 ? " and its last frame held" : ""}` });
      }
    }
    const bar = barOf(l.shownMs);
    if (previous) {
      const p = lines.get(previous.a.line)!;
      if ((downbeats.length && bar === previous.bar) || l.shownMs - p.shownMs < minShotMs) { // (no beats analysed yet: only the spacing)
        out.push({ line: a.line, problem: `line ${a.line} and line ${previous.a.line} land on the same bar: line ${a.line} will cut in on a beat instead${l.shownMs - barOf(p.shownMs) < minShotMs ? " (or not at all: too close)" : ""}` });
      }
      if (previous.a.clip.toLowerCase() === key && l.shownMs - p.shownMs < ANCHOR_REPEAT_MS) {
        out.push({ line: a.line, problem: `lines ${previous.a.line} and ${a.line} both land on ${a.clip}, ${((l.shownMs - p.shownMs) / 1000).toFixed(1)} s apart: the repeat is visible` });
      }
    }
    previous = { a, bar };
  }
  return out;
}

// How many anchors a section keeps (their line on screen and sung to its end inside the section).
export function anchorsInside(
  anchors: readonly { line: number; shownMs: number; sungEndMs: number }[],
  startMs: number,
  endMs: number,
): { kept: number; total: number; missing: number[] } {
  const missing = anchors.filter((a) => a.shownMs < startMs - 100 || a.sungEndMs > endMs).map((a) => a.line);
  return { kept: anchors.length - missing.length, total: anchors.length, missing };
}

// song.json "anchors" and "gapOrder", checked; every problem named.
export function checkAnchors(raw: unknown): { anchors: AnchorSpec[]; problems: string[] } {
  const problems: string[] = [];
  const anchors: AnchorSpec[] = [];
  if (!Array.isArray(raw)) return { anchors, problems: ['anchors must be a list like [{ "line": 9, "clip": "hands.mp4" }]'] };
  raw.forEach((x, i) => {
    const a = x as Record<string, unknown>;
    const at = `anchors[${i}]`;
    if (!a || typeof a !== "object") return problems.push(`${at} must be like { "line": 9, "clip": "hands.mp4" }`);
    if (!Number.isInteger(a.line) || (a.line as number) < 1) return problems.push(`${at}: line must be a line number (1, 2, ...)`);
    if (typeof a.clip !== "string" || !a.clip.trim()) return problems.push(`${at}: clip must be a clip file name`);
    if (a.clipIn !== undefined && (typeof a.clipIn !== "number" || !Number.isFinite(a.clipIn) || a.clipIn < 0)) return problems.push(`${at}: clipIn must be seconds into the clip (0 or more)`);
    if (a.transition !== undefined && a.transition !== "cut" && a.transition !== "dissolve") return problems.push(`${at}: transition must be "cut" or "dissolve"`);
    if (a.sync !== undefined && (typeof a.sync !== "number" || !Number.isFinite(a.sync) || a.sync < 0)) return problems.push(`${at}: sync must be the song second of the singing clip's first frame (0 or more)`);
    anchors.push({ line: a.line as number, clip: (a.clip as string).trim(), ...(a.clipIn !== undefined ? { clipIn: a.clipIn as number } : {}), ...(a.transition ? { transition: a.transition as AnchorTransition } : {}), ...(a.sync !== undefined ? { sync: a.sync as number } : {}) });
  });
  return { anchors, problems };
}
