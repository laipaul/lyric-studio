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
  key: string; // "slot:<id>" for a planned shot (with or without a take), else the clip's name
  clip: string | null; // the take (clip name); null: a stand-in
  slot: Slot | null; // the planned shot it belongs to (when it came from the shot list)
  line: number | null; // the lyric line it starts on
  number: number; // 1-based place in the story line
};

const SLOT = "slot:";

// The story line as the film's shots. `order`: clips.json "order" (collection cards already expanded); `used`: the clip
// names this video may show (Omit left out, and only those that suit its shape), in file-name order. A planned shot is
// one card whichever of its takes the order holds: its take for this film is the one among `used` (the vertical take,
// shotlist "filled", for the Film 9:16; the landscape one, "filledWide", for the Film 16:9), else a stand-in. Clips that
// belong to no shot keep their own card; those never placed in the order follow at the end.
export function filmItems(
  order: readonly string[],
  used: readonly string[],
  list: ShotListFile | null,
  anchors: readonly { line: number; clip: string; sync?: number }[],
): FilmItem[] {
  const lower = (s: string) => s.toLowerCase();
  const usedSet = new Map(used.map((n) => [lower(n), n]));
  const slots = new Map((list?.slots ?? []).map((s) => [s.id, s]));
  const slotOfClip = new Map<string, string>();
  for (const m of [list?.filledWide ?? {}, list?.filled ?? {}]) for (const [id, clip] of Object.entries(m)) slotOfClip.set(lower(String(clip)), id);
  const takeFor = (id: string) => [list?.filled?.[id], list?.filledWide?.[id]].map((c) => (c ? usedSet.get(lower(String(c))) : undefined)).find((c) => c !== undefined) ?? null;
  const anchorLine = (clip: string) => anchors.find((a) => a.sync === undefined && lower(a.clip) === lower(clip))?.line ?? null;
  const seen = new Set<string>();
  const out: Omit<FilmItem, "number">[] = [];
  const addSlot = (id: string) => {
    const slot = slots.get(id);
    if (!slot || seen.has(`${SLOT}${id}`)) return;
    seen.add(`${SLOT}${id}`);
    const take = takeFor(id);
    if (take) seen.add(lower(take));
    out.push({ key: `${SLOT}${id}`, clip: take, slot, line: slot.line });
  };
  const addClip = (name: string) => {
    const id = slotOfClip.get(lower(name));
    if (id && slots.has(id)) return addSlot(id);
    if (seen.has(lower(name)) || !usedSet.has(lower(name))) return;
    seen.add(lower(name));
    out.push({ key: name, clip: usedSet.get(lower(name))!, slot: null, line: anchorLine(name) });
  };
  for (const entry of order) {
    if (entry.startsWith(SLOT)) addSlot(entry.slice(SLOT.length));
    else addClip(entry);
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
  section: { startFrame: number; endFrame: number; fps: number; early?: number; minShotMs?: number; songEndMs?: number }, // songEndMs: the whole song (the spans), when the video is a part of it
): { cuts: CutPoint[]; kept: FilmItem[]; notes: string[] } {
  const { startFrame, endFrame, fps } = section;
  const early = section.early ?? 2;
  const minShot = Math.round(((section.minShotMs ?? 700) * fps) / 1000);
  const ms = (frame: number) => Math.round((frame * 1000) / fps);
  const timedLine = (n: number | null) => n !== null && lines.some((l) => l.number === n && l.startMs !== null);
  const songEnd = section.songEndMs ?? ms(endFrame);
  const spans = slotSpans(items.map((x) => ({ id: x.key, line: timedLine(x.line) ? x.line : null })), lines, songEnd);
  // A part of the song (the pink window): only the cards whose moment is inside it; the card already playing when the
  // part starts opens it. The others are simply outside this video (not "without room").
  const inside = items.filter((x) => {
    const span = spans.get(x.key);
    return !span || (span.endMs > ms(startFrame) + 1 && span.startMs < ms(endFrame) - 1);
  });
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
  for (const item of inside) {
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
