// Creation → Production (C3, Part 1; 22 Nov 2026, decided with Paul): "Creation should be creating the pictures and
// video takes for each Storyboard item." The shot list's planned slots (shotlist.ts) are the items, in story order and
// grouped by the song's sections. A picture dropped on an item belongs to it (pictures.json "slot"); Animate makes its
// takes there as usual; "Use this take" fills the item: the take joins the song's clips, takes the slot's place in the
// story line (clips.json "order"), and goes on the slot's lyric line (song.json anchors) when it has one. The slot
// stays in shotlist.json, marked filled (shotlist.json "filled"), so a re-import keeps it filled. A take chosen again
// for the same item replaces the earlier one there (that clip is set to Omit, never deleted).
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { nameSections, sectionOfLine, type NamedSection } from "../sections";
import { readPictures, sendToStoryboard, songFolder, update, BOARD_FILE } from "./animate";
import { readClipEdits, setClipOmit, writeClipEdits } from "./clip-edits";
import { saveAnchors } from "./lyrics-view";
import { readRecipe } from "./recipe";
import { SHOTLIST_FILE, readShotListFile, slotKey, type Slot } from "./shotlist";
import { songPathsById } from "./song-folder";
import { songSections } from "./song-sections";
import { songText } from "./textboard";

export type ProductionShot = Slot & {
  number: number; // its place in the shot list, 1 = first (the Storyboard card's number)
  lineText: string | null;
  section: string; // "Intro", "Verse 1", "Chorus" … (the song's sections; a shot without a line follows the shot before it)
  filled: string | null; // the clip that fills it ("Use this take"), else null
  pictures: string[]; // the Creation pictures that belong to it
};
export type ProductionView = { shots: ProductionShot[]; sections: string[] };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function shotListFile(ws: Workspace, projectId: string): string {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return path.join(paths.root, SHOTLIST_FILE);
}

// The section a shot belongs to. Pure. A shot on a line: that line's section. A shot without a line: the section of the
// shot before it, or "Intro" when no shot before it has a line; after the last sung line: "Ending".
export function sectionsOfShots(slots: readonly Pick<Slot, "line">[], sections: readonly NamedSection[], lineCount: number): string[] {
  let last: string | null = null;
  let afterLast = false;
  const lastLine = lineCount;
  return slots.map((s) => {
    if (s.line !== null) {
      const sec = sectionOfLine(sections as NamedSection[], s.line);
      last = sec?.name ?? `Line ${s.line}`;
      afterLast = s.line >= lastLine;
      return last;
    }
    if (last === null) return "Intro";
    return afterLast ? "Ending" : last;
  });
}

export function productionView(ws: Workspace, projectId: string): ProductionView {
  const file = shotListFile(ws, projectId);
  const list = readShotListFile(file);
  if (!list?.slots.length) return { shots: [], sections: [] };
  const filled = list.filled ?? {};
  const slots = [...list.slots].sort((a, b) => a.order - b.order);
  const text = songText(ws, projectId).lines;
  let named: NamedSection[] = [];
  try {
    named = songSections(ws, projectId).sections;
  } catch {
    named = nameSections([], text.length);
  }
  const secs = sectionsOfShots(slots, named, text.length);
  const { dir } = songFolder(ws, projectId);
  const pics = readPictures(dir).pictures;
  const clipsDir = songPathsById(ws, projectId).clips;
  const shots = slots.map((s, i): ProductionShot => {
    const clip = filled[s.id];
    return {
      ...s,
      number: i + 1,
      lineText: s.line !== null ? (text.find((l) => l.number === s.line)?.text ?? null) : null,
      section: secs[i],
      filled: clip && clipsDir && existsSync(path.join(clipsDir, clip)) ? clip : null,
      pictures: Object.entries(pics)
        .filter(([f, p]) => p.slot === s.id && existsSync(path.join(dir, f)))
        .map(([f]) => f)
        .sort(),
    };
  });
  return { shots, sections: [...new Set(secs)] };
}

// A Creation picture belongs to a shot (or to none: null).
export function setPictureShot(ws: Workspace, projectId: string, file: unknown, slot: unknown): string | null {
  const name = path.basename(String(file ?? ""));
  const { dir } = songFolder(ws, projectId);
  if (!name || !BOARD_FILE.test(name) || !existsSync(path.join(dir, name))) throw new Error(`No ${String(file)} in this song's Creation space.`);
  const id = slot === null || slot === undefined || slot === "" ? null : String(slot);
  if (id !== null && !readShotListFile(shotListFile(ws, projectId))?.slots.some((s) => s.id === id)) throw new Error("That shot is not in this song's shot list.");
  update(dir, name, (p) => {
    if (id === null) delete p.slot;
    else p.slot = id;
  });
  return id;
}

export type UseForShot = { clip: string; shot: number; line: number | null; replaced: string | null; note: string | null };

// "Use this take" on a shot: the take (or the picture itself, n null) fills that Storyboard item, in its place and on its line.
export async function useForShot(ws: Workspace, projectId: string, o: { file: unknown; n?: unknown; slot: unknown }): Promise<UseForShot> {
  const file = shotListFile(ws, projectId);
  const list = readShotListFile(file);
  const slot = list?.slots.find((s) => s.id === String(o.slot ?? ""));
  if (!list || !slot) throw new Error("That shot is not in this song's shot list.");
  const n = o.n === undefined || o.n === null ? null : Number(o.n);
  const name = path.basename(String(o.file ?? ""));
  const { clip } = await sendToStoryboard(ws, projectId, name, n);
  const root = songPathsById(ws, projectId).root;
  const before = (list.filled ?? {})[slot.id] ?? null;
  const replaced = before && !same(before, clip) ? before : null;

  // The story line: the clip takes the slot's place (or the place of the clip that filled it before).
  const edits = readClipEdits(root);
  const at = (e: string) => e === slotKey(slot.id) || (replaced !== null && same(e, replaced));
  let order = edits.order.filter((e) => !same(e, clip));
  const index = order.findIndex(at);
  if (index < 0) order.push(clip);
  else order[index] = clip;
  order = order.filter((e) => e !== slotKey(slot.id));
  writeClipEdits(root, { ...edits, order });
  if (replaced) {
    try {
      setClipOmit(root, replaced, true); // stays in the Storyboard and Creation, out of the videos
    } catch {
      // no longer a song clip
    }
  }
  setClipOmitSafe(root, clip, false);

  // Remembered on the shot list, so a re-import keeps the item filled.
  const fresh = readShotListFile(file)!;
  writeFileSync(file, `${JSON.stringify({ ...fresh, filled: { ...(fresh.filled ?? {}), [slot.id]: clip } }, null, 2)}\n`);

  // Its lyric line: the clip shows on it (a line a singing take covers keeps its singer).
  let note: string | null = null;
  if (slot.line !== null) {
    const paths = songPathsById(ws, projectId);
    const anchors = paths.recipe ? (readRecipe(paths.recipe).anchors ?? []) : [];
    const singing = anchors.find((a) => a.sync !== undefined && a.line <= slot.line! && slot.line! <= (a.through ?? a.line));
    if (singing) note = `Line ${slot.line} is sung by a singing take: the clip is in the story line, the singer stays on the line.`;
    else saveAnchors(ws, projectId, [...anchors.filter((a) => a.line !== slot.line && !(replaced && same(a.clip, replaced))), { line: slot.line, clip }]);
  }
  // The picture's take is marked as used for this shot.
  const { dir } = songFolder(ws, projectId);
  if (readPictures(dir).pictures[name]) update(dir, name, (p) => void (p.slot ??= slot.id));
  const shot = [...list.slots].sort((a, b) => a.order - b.order).findIndex((s) => s.id === slot.id) + 1;
  return { clip, shot, line: slot.line, replaced, note };
}

function setClipOmitSafe(root: string, clip: string, omit: boolean): void {
  try {
    const edits = readClipEdits(root);
    const key = Object.keys(edits.clips).find((c) => same(c, clip));
    if (key && edits.clips[key]?.omit) setClipOmit(root, clip, omit);
  } catch {
    // nothing to change
  }
}
