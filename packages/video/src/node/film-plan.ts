// A Mini film plays shot by shot (23 Nov 2026, Step B; Paul: "the shots no longer match the lyrics", "maybe because
// we don't have the full 38 shots it goes in circle and fills the gaps"). For a story song every card of the story
// line (Prepare → Storyboard) is ONE shot of the video, in that order:
//   - a card on a lyric line (its shot's line in the shot list, else the line its clip is anchored on) starts when
//     that line appears, cut on the beat at or just before it; cards without a line share the time of the card
//     before them (before the first line: the intro) — the shot grid's rule (shot-grid.ts slotSpans);
//   - each take plays once, on its own card: no cycling, no repeats, no take filling another card's moment;
//   - a planned shot with no take yet shows a stand-in: its people's reference picture, dimmed (else a dark frame),
//     named "Shot N · no take yet", so the whole film's timing shows now and the gaps are visible.
// filmItems and filmCuts are pure; standInPicture makes the stand-in JPEG once (workspace cache).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";

import { absPath, ffmpegBin, type Workspace } from "@lyric/db";

import type { Beat } from "../beats";
import { cutPointAt, type CutPoint } from "../cuts";
import { slotSpans, type GridLine } from "../shot-grid";
import type { ShotListFile, Slot } from "./shotlist";

export type FilmItem = {
  key: string; // the story line entry: a clip name, or "slot:<id>" for a planned shot without a take
  clip: string | null; // the take (clip name); null: a stand-in
  slot: Slot | null; // the planned shot it belongs to (when it came from the shot list)
  line: number | null; // the lyric line it starts on
  number: number; // 1-based place in the story line
};

const SLOT = "slot:";

// The story line as the film's shots. `order`: clips.json "order" (collection cards already expanded); `used`: the clip
// names this video may show (Omit left out), in file-name order; clips never placed in the order follow at the end.
export function filmItems(
  order: readonly string[],
  used: readonly string[],
  list: ShotListFile | null,
  anchors: readonly { line: number; clip: string; sync?: number }[],
): FilmItem[] {
  const lower = (s: string) => s.toLowerCase();
  const usedSet = new Map(used.map((n) => [lower(n), n]));
  const slots = new Map((list?.slots ?? []).map((s) => [s.id, s]));
  const slotOfClip = new Map(Object.entries(list?.filled ?? {}).map(([id, clip]) => [lower(String(clip)), id]));
  const anchorLine = (clip: string) => anchors.find((a) => a.sync === undefined && lower(a.clip) === lower(clip))?.line ?? null;
  const seen = new Set<string>();
  const out: Omit<FilmItem, "number">[] = [];
  const addClip = (name: string) => {
    if (seen.has(lower(name))) return;
    seen.add(lower(name));
    const slotId = slotOfClip.get(lower(name));
    const slot = slotId ? (slots.get(slotId) ?? null) : null;
    out.push({ key: name, clip: name, slot, line: slot?.line ?? anchorLine(name) });
  };
  for (const entry of order) {
    if (entry.startsWith(SLOT)) {
      const slot = slots.get(entry.slice(SLOT.length));
      if (!slot || seen.has(lower(entry))) continue;
      seen.add(lower(entry));
      const take = list?.filled?.[slot.id];
      if (take && usedSet.has(lower(String(take)))) addClip(usedSet.get(lower(String(take)))!);
      else out.push({ key: entry, clip: null, slot, line: slot.line });
      continue;
    }
    const name = usedSet.get(lower(entry));
    if (name) addClip(name);
  }
  for (const name of used) addClip(name);
  return out.map((x, i) => ({ ...x, number: i + 1 }));
}

// The cuts of the film: each item from its time on the song (lines as shown on screen, song ms), cut on the beat at
// or just before it (the cut comes `early` frames before its beat, as every cut). An item that cannot get its own
// shot (less than `minShotMs` after the one before) is said, never silently dropped. Song frames throughout.
export function filmCuts(
  items: readonly FilmItem[],
  lines: readonly GridLine[],
  beats: readonly Beat[],
  section: { startFrame: number; endFrame: number; fps: number; early?: number; minShotMs?: number },
): { cuts: CutPoint[]; kept: FilmItem[]; notes: string[] } {
  const { startFrame, endFrame, fps } = section;
  const early = section.early ?? 2;
  const minShot = Math.round(((section.minShotMs ?? 700) * fps) / 1000);
  const ms = (frame: number) => Math.round((frame * 1000) / fps);
  const timedLine = (n: number | null) => n !== null && lines.some((l) => l.number === n && l.startMs !== null);
  const spans = slotSpans(items.map((x) => ({ id: x.key, line: timedLine(x.line) ? x.line : null })), lines, ms(endFrame));
  const beatCuts = beats.map((_, i) => cutPointAt(beats, i, fps, early));
  const cuts: CutPoint[] = [];
  const kept: FilmItem[] = [];
  const notes: string[] = [];
  let last = startFrame;
  const place = (item: FilmItem): CutPoint | null => {
    const span = spans.get(item.key);
    const wantFrame = Math.round(((span?.startMs ?? ms(last)) * fps) / 1000);
    // The beat at or just before the moment (within half a second), else the next beat.
    const before = [...beatCuts].reverse().find((c) => c.frame <= wantFrame && c.frame >= wantFrame - Math.round(fps / 2) && c.frame >= last + minShot);
    const after = beatCuts.find((c) => c.frame > wantFrame && c.frame >= last + minShot);
    const at = Math.max(wantFrame, last + minShot);
    const plain: CutPoint = { frame: at, time_ms: ms(at), beat_index: -1, beat_time_ms: ms(at), bar: 0, beat_in_bar: 1 };
    const cut = before ?? (beats.length ? (after ?? null) : plain);
    // A shot on a lyric line comes at most 0.2 s after its line appears (it belongs to the words); others may slide a second.
    const late = item.line !== null && span?.startMs !== undefined ? Math.round(fps * 0.2) : fps;
    return cut && cut.frame <= endFrame - minShot && cut.frame >= startFrame + minShot && cut.frame - wantFrame <= late ? cut : null;
  };
  const leftOut = (item: FilmItem, why: string) => notes.push(`shot ${item.number}${item.slot ? ` (${item.slot.id})` : ""} ${why}: it is left out of this video`);
  for (const item of items) {
    if (!kept.length) {
      kept.push(item); // the first shot opens the video
      continue;
    }
    let cut = place(item);
    // A shot on a lyric line wins over a shot without one just before it (e.g. an intro too short for its own shot).
    if (!cut && item.line !== null && kept[kept.length - 1].line === null) {
      const gone = kept.pop()!;
      if (kept.length) cuts.pop();
      last = cuts.at(-1)?.frame ?? startFrame;
      leftOut(gone, `has no room of its own before line ${item.line}`);
      if (!kept.length) {
        kept.push(item);
        continue;
      }
      cut = place(item);
    }
    if (!cut) {
      leftOut(item, "has no room of its own on the song (too close to the shot before it or to the end)");
      continue;
    }
    cuts.push(cut);
    kept.push(item);
    last = cut.frame;
  }
  return { cuts, kept, notes };
}

const runFfmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => execFile(ffmpegBin(), args, { windowsHide: true }, (error) => (error ? reject(error) : resolve())));

// The stand-in picture of a planned shot without a take: its first person's reference picture cover-cropped to the
// video's size, dimmed and softened (the shot's place in the film, never mistaken for a take), else a dark frame.
// Made once per picture, size and shot (workspace cache/standins); returns its workspace-relative path.
export async function standInPicture(ws: Workspace, picture: string | null, size: { width: number; height: number }, shot: string): Promise<string> {
  const source = picture && existsSync(picture) ? picture : null;
  const key = createHash("sha256").update(JSON.stringify({ v: 1, source, size })).digest("hex").slice(0, 16);
  const rel = `cache/standins/${key}-${shot.replace(/[^\w-]/g, "_")}.jpg`; // one file per shot: Shape names each shot by its file
  const out = absPath(ws, rel);
  if (existsSync(out)) return rel;
  mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp.jpg`;
  const { width, height } = size;
  const args = source
    ? ["-y", "-v", "error", "-i", source, "-frames:v", "1", "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=8:1,eq=brightness=-0.22:saturation=0.35`, "-q:v", "4", tmp]
    : ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x15151a:s=${width}x${height}`, "-frames:v", "1", "-q:v", "4", tmp];
  await runFfmpeg(args);
  renameSync(tmp, out);
  return rel;
}
