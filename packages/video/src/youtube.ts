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
