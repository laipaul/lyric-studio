// YouTube (16:9) helpers, pure: lyric sections for the stills layout, stills.txt, crossfades on
// downbeats, the end-screen area of the last 20 s, the beat-pulsed glow and .srt captions.
import type { Beat } from "./beats";
import { normalizeLyric } from "./lrc";
import { type Format, type LyricArea, lyricArea, type SafeZone } from "./platform";

export type SectionKind = "intro" | "verse" | "chorus" | "bridge" | "outro";
export type LyricSection = { name: string; kind: SectionKind; number: number; start_ms: number; end_ms: number; lines: number[] };
type Line = { text: string; start_ms: number; end_ms: number; isHook: boolean };

const GAP_MS = 2000; // an intro/outro shorter than this is not a section of its own

// Lyric sections from blank-line pauses (an LRC line ending before the next one starts) and hook
// lines: a block with a hook line is a chorus; a block after the second chorus whose words appear
// nowhere else is the bridge; the others are verses. Without any pauses, a block starts at each hook
// line and wherever repeated lines (chorus) change to unique lines (verse) or back. Without hook
// lines, a repeated block is a chorus. Sections cover the whole song without gaps.
export function lyricSections(lines: readonly Line[], durationMs: number): LyricSection[] {
  if (!lines.length) return [{ name: "intro", kind: "intro", number: 1, start_ms: 0, end_ms: durationMs, lines: [] }];
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(normalizeLyric(l.text), (counts.get(normalizeLyric(l.text)) ?? 0) + 1);
  const repeated = (i: number) => (counts.get(normalizeLyric(lines[i].text)) ?? 0) >= 2;
  const hooks = lines.some((l) => l.isHook);
  const pauses = lines.some((l, i) => i + 1 < lines.length && l.end_ms < lines[i + 1].start_ms);
  const blocks: number[][] = [[0]];
  for (let i = 1; i < lines.length; i++) {
    const pause = lines[i - 1].end_ms < lines[i].start_ms;
    const change = !pauses && ((lines[i].isHook && !lines[i - 1].isHook) || repeated(i) !== repeated(i - 1));
    if (pause || change) blocks.push([i]);
    else blocks[blocks.length - 1].push(i);
  }
  const numbers: Record<SectionKind, number> = { intro: 0, verse: 0, chorus: 0, bridge: 0, outro: 0 };
  const out: LyricSection[] = [];
  const add = (kind: SectionKind, start_ms: number, end_ms: number, idx: number[]) => {
    numbers[kind] += 1;
    out.push({ name: kind === "intro" || kind === "outro" ? kind : `${kind} ${numbers[kind]}`, kind, number: numbers[kind], start_ms, end_ms, lines: idx });
  };
  if (lines[0].start_ms >= GAP_MS) add("intro", 0, lines[0].start_ms, []);
  blocks.forEach((block, b) => {
    const start = b === 0 && lines[0].start_ms < GAP_MS ? 0 : lines[block[0]].start_ms;
    const next = blocks[b + 1];
    const lastEnd = lines[block[block.length - 1]].end_ms;
    const end = next ? lines[next[0]].start_ms : durationMs - lastEnd >= GAP_MS ? lastEnd : durationMs;
    let kind: SectionKind = (hooks ? block.some((i) => lines[i].isHook) : block.length > 1 && block.every(repeated)) ? "chorus" : "verse";
    if (kind === "verse" && numbers.chorus >= 2 && numbers.bridge === 0 && block.every((i) => counts.get(normalizeLyric(lines[i].text)) === 1)) kind = "bridge";
    add(kind, start, end, block);
  });
  const last = out[out.length - 1];
  if (last.end_ms < durationMs) add("outro", last.end_ms, durationMs, []);
  return out;
}

// stills.txt: "chorus = 03_bride.jpg" (every chorus), "chorus 2 = 07_x.jpg" (that one only),
// also intro, verse, verse 1, bridge, outro. "#" starts a comment.
export function parseStills(text: string): { rules: Map<string, string>; warnings: string[] } {
  const rules = new Map<string, string>();
  const warnings: string[] = [];
  text.replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const m = /^(intro|outro|verse|chorus|bridge)(?:\s+(\d+))?\s*=\s*(.+)$/i.exec(line);
    if (!m) {
      warnings.push(`stills.txt line ${i + 1} not understood: "${raw.trim()}" (use e.g. "chorus = 03_bride.jpg")`);
      return;
    }
    rules.set(`${m[1].toLowerCase()}${m[2] ? ` ${Number(m[2])}` : ""}`, m[3].trim());
  });
  return { rules, warnings };
}

// One picture per section: an exact rule ("chorus 2"), else the kind's rule ("chorus"), else the
// next picture in file-name order among those stills.txt does not use (all of them if it uses every
// picture), avoiding the picture of the section before. Unknown pictures give a warning.
export function assignStills(sections: readonly LyricSection[], images: readonly string[], rules: ReadonlyMap<string, string>): { files: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const find = (name: string) => images.find((f) => f.toLowerCase() === name.toLowerCase() || f.replace(/\.[^.]+$/, "").toLowerCase() === name.toLowerCase());
  for (const [key, file] of rules) if (!find(file)) warnings.push(`stills.txt: "${key} = ${file}": no such horizontal picture in the collection`);
  const used = new Set([...rules.values()].map(find).filter(Boolean));
  const pool = images.filter((f) => !used.has(f)).length ? images.filter((f) => !used.has(f)) : [...images];
  let next = 0;
  const files: string[] = [];
  sections.forEach((s, i) => {
    const ruled = rules.get(s.name) ?? rules.get(s.kind);
    const hit = ruled ? find(ruled) : undefined;
    if (hit) {
      files.push(hit);
      return;
    }
    let file = pool[next % pool.length];
    if (pool.length > 1 && file === files[i - 1]) {
      next += 1;
      file = pool[next % pool.length];
    }
    next += 1;
    files.push(file);
  });
  return { files, warnings };
}

export const CROSSFADE_SECONDS = 1.5;

// Section changes on the downbeat nearest each section start, with the crossfade centred on it.
// Returns frames relative to the video start (not clamped: a still can begin before the video when
// the video starts mid-song; see visibleStills).
export function stillTimings(
  sections: readonly LyricSection[],
  beats: readonly Beat[],
  fps: number,
  startMs: number,
  durationInFrames: number,
): { startFrame: number; endFrame: number; fadeFrames: number }[] {
  const downbeats = beats.filter((b) => b.is_downbeat).map((b) => b.time_ms);
  const snap = (ms: number) => downbeats.reduce((best, d) => (Math.abs(d - ms) < Math.abs(best - ms) ? d : best), downbeats[0] ?? ms);
  const fade = Math.round(CROSSFADE_SECONDS * fps);
  const toFrame = (ms: number) => Math.round(((ms - startMs) * fps) / 1000);
  const changes = sections.slice(1).map((s) => toFrame(snap(s.start_ms)));
  return sections.map((_, i) => ({
    startFrame: i === 0 ? Math.min(0, toFrame(0)) : changes[i - 1] - Math.floor(fade / 2),
    endFrame: i === sections.length - 1 ? Math.max(durationInFrames, toFrame(sections[i].end_ms)) : changes[i] + Math.ceil(fade / 2),
    fadeFrames: fade,
  }));
}

// Opacity of a still at `frame`. A crossfade fades the NEW picture in over the old one, which stays
// fully visible underneath until the new one covers it (no dark dip in the middle). The first still
// starts fully visible.
export function stillOpacity(s: { startFrame: number; endFrame: number; fadeFrames: number }, frame: number, first: boolean, _last = false): number {
  if (frame < s.startFrame || frame >= s.endFrame) return 0;
  return first ? 1 : Math.min(1, (frame - s.startFrame + 1) / s.fadeFrames);
}

// The last `seconds` of a YouTube video: YouTube's end-screen elements go bottom-right, so that
// area (`clear`, fractions of the frame) stays free; lyrics move to a band above it.
export function endScreenLayout(
  format: Format,
  safe: SafeZone,
  area: LyricArea,
  fps: number,
  durationInFrames: number,
  options: { seconds: number; clear: { left: number; top: number } },
): { fromFrame: number; lyricArea: LyricArea; clear: { left: number; top: number; right: number; bottom: number } } {
  const clear = { left: Math.round(format.width * options.clear.left), top: Math.round(format.height * options.clear.top), right: format.width, bottom: format.height };
  const band = lyricArea(format, { ...safe, bottom: 1 - options.clear.top + 0.03 }, 0.5);
  return {
    fromFrame: Math.max(0, durationInFrames - Math.round(options.seconds * fps)),
    lyricArea: { ...band, left: area.left, right: area.right },
    clear,
  };
}

// 0..1: how strongly the glow pulses at `frame` (jumps on a beat, decays over ~0.2 s).
export function beatPulse(frame: number, beatFrames: readonly number[]): number {
  let last = -Infinity;
  for (const b of beatFrames) {
    if (b > frame) break;
    last = b;
  }
  return Number.isFinite(last) ? Math.exp(-(frame - last) / 6) : 0;
}

// .srt captions for a video: the lyric lines as the video shows them (times from its first frame).
export function toSrt(lines: readonly { text: string; startFrame: number; endFrame: number }[], fps: number): string {
  const time = (frame: number) => {
    const ms = Math.max(0, Math.round((frame * 1000) / fps));
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const sec = Math.floor((ms % 60_000) / 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(h)}:${p(m)}:${p(sec)},${p(ms % 1000, 3)}`;
  };
  return lines
    .filter((l) => l.endFrame > l.startFrame)
    .map((l, i) => `${i + 1}\n${time(l.startFrame)} --> ${time(l.endFrame)}\n${l.text}\n`)
    .join("\n");
}

// The stills that are on screen in a video of `durationInFrames` frames (the first and last of them
// are drawn without a fade at the video's start and end).
export function visibleStills<T extends { startFrame: number; endFrame: number }>(stills: readonly T[], durationInFrames: number): T[] {
  return stills.filter((s) => s.endFrame > 0 && s.startFrame < durationInFrames);
}

// ---- cover motion (zoom + gentle drift, background parallax) --------------------------------

export type CoverDrift = { fromX: number; fromY: number; toX: number; toY: number }; // px

// A seeded drift: from one side to the other, at most `share` of the cover's side in each direction.
export function coverDrift(random: () => number, side: number, share: number): CoverDrift {
  const a = side * share;
  const dx = (random() * 2 - 1) * a;
  const dy = (random() * 2 - 1) * a * 0.6;
  return { fromX: -dx, fromY: -dy, toX: dx, toY: dy };
}

// The cover's zoom and offset at progress t (0 = first frame, 1 = last), eased in and out; the
// background moves `parallax` as much, the opposite way.
export function coverMotionAt(
  cover: { zoomFrom: number; zoomTo: number; drift?: CoverDrift },
  t: number,
  parallax: number,
): { zoom: number; x: number; y: number; backgroundX: number; backgroundY: number } {
  const e = 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;
  const d = cover.drift ?? { fromX: 0, fromY: 0, toX: 0, toY: 0 };
  const x = d.fromX + (d.toX - d.fromX) * e;
  const y = d.fromY + (d.toY - d.fromY) * e;
  return { zoom: cover.zoomFrom + (cover.zoomTo - cover.zoomFrom) * e, x, y, backgroundX: -x * parallax, backgroundY: -y * parallax };
}

// ---- section mood ------------------------------------------------------------------------------

export type MoodKind = "hook" | "verse" | "neutral";
export type MoodSegment = { startFrame: number; kind: MoodKind };
export type Rgba = [number, number, number, number];

// A colour laid over the background: warm and light on hook (chorus) sections, a soft dark veil on
// verses and the bridge, nothing on the intro and outro.
export const MOOD_COLOURS: Record<MoodKind, Rgba> = {
  hook: [255, 186, 130, 0.13],
  verse: [14, 16, 34, 0.18],
  neutral: [0, 0, 0, 0],
};
export const MOOD_TRANSITION_SECONDS = 2;

// Mood sections on the downbeat nearest each lyric section start (frames from the video start).
export function moodSegments(sections: readonly LyricSection[], beats: readonly Beat[], fps: number, startMs: number): MoodSegment[] {
  const downbeats = beats.filter((b) => b.is_downbeat).map((b) => b.time_ms);
  const snap = (ms: number) => downbeats.reduce((best, d) => (Math.abs(d - ms) < Math.abs(best - ms) ? d : best), downbeats[0] ?? ms);
  return sections.map((s, i) => ({
    startFrame: i === 0 ? -1_000_000 : Math.round(((snap(s.start_ms) - startMs) * fps) / 1000), // (props are JSON: no -Infinity)
    kind: s.kind === "chorus" ? "hook" : s.kind === "intro" || s.kind === "outro" ? "neutral" : "verse",
  }));
}

// The mood colour at `frame`: each change is a smooth (eased) 2 s blend centred on the section start.
export function moodAt(frame: number, segments: readonly MoodSegment[], fps: number): Rgba {
  if (!segments.length) return MOOD_COLOURS.neutral;
  const half = (MOOD_TRANSITION_SECONDS * fps) / 2;
  let current = 0;
  for (let i = 0; i < segments.length; i++) if (segments[i].startFrame - half <= frame) current = i;
  const seg = segments[current];
  const to = MOOD_COLOURS[seg.kind];
  if (current === 0 || frame >= seg.startFrame + half) return to;
  const from = MOOD_COLOURS[segments[current - 1].kind];
  const t = (frame - (seg.startFrame - half)) / (2 * half);
  const e = t * t * (3 - 2 * t); // smoothstep: no sudden change at either end
  const a = from[3] + (to[3] - from[3]) * e;
  // Blend the colours weighted by their opacity, so fading from "nothing" does not pass through black.
  const mix = (i: number) => (a > 0 ? (from[i] * from[3] * (1 - e) + to[i] * to[3] * e) / a : to[i]);
  return [mix(0), mix(1), mix(2), a];
}

// ---- logo ----------------------------------------------------------------------------------------

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

// Where the logo goes: always in a corner of the FRAME with a fixed margin (3% of the width), never
// mid-frame. "auto" = bottom right.
export const LOGO_MARGIN_SHARE = 0.03;
export const logoMargin = (format: Format) => Math.round(format.width * LOGO_MARGIN_SHARE);

export function logoPlacement(format: Format, corner: Corner | "auto", size: { width: number; height: number }): { left: number; top: number } {
  const [v, h] = (corner === "auto" ? "bottom-right" : corner).split("-") as ["top" | "bottom", "left" | "right"];
  const margin = logoMargin(format);
  return {
    left: h === "left" ? margin : format.width - margin - size.width,
    top: v === "top" ? margin : format.height - margin - size.height,
  };
}

// For QA: is the logo anchored to a frame corner (its fixed margin from two frame edges)?
export function logoCornerProblem(format: Format, logo: { left: number; top: number; width: number; height: number }): string | null {
  const margin = logoMargin(format);
  const x = Math.min(logo.left, format.width - logo.left - logo.width);
  const y = Math.min(logo.top, format.height - logo.top - logo.height);
  if (Math.abs(x - margin) <= 1 && Math.abs(y - margin) <= 1) return null;
  return `the logo is ${Math.round(x)} px from the nearest side and ${Math.round(y)} px from the top/bottom; it must sit in a frame corner, ${margin} px from both edges`;
}

// Logo opacity: fades out over `fadeFrames` so it is gone by `goneAt` (YouTube's end-screen window).
export function logoOpacity(frame: number, goneAt: number | null, fadeFrames: number): number {
  if (goneAt === null) return 1;
  if (frame >= goneAt) return 0;
  return Math.min(1, (goneAt - frame) / fadeFrames);
}
