// Feeling per section (feelings.ts) for a take: a singing clip's lines, or a picture placed on a shot (pictures.json
// "slot"): the shot's line, or for a shot without a line the line of the shot before it (as in Shots: sectionsOfShots).
// A loose picture (on no shot) gets none. Never throws: a song without sections or shot list simply has no feeling.
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { feelingOfLines } from "../feelings";
import type { NamedSection } from "../sections";
import { readShotListFile, SHOTLIST_FILE } from "./shotlist";
import { songPathsById } from "./song-folder";
import { songSections } from "./song-sections";

export type TakeFeeling = { feeling?: string; feelingTo?: string };

function sectionsOf(ws: Workspace, projectId: string): NamedSection[] {
  try {
    return songSections(ws, projectId).sections;
  } catch {
    return [];
  }
}

export function feelingForLines(ws: Workspace, projectId: string, from: number, through?: number): TakeFeeling {
  return feelingOfLines(sectionsOf(ws, projectId), from, through);
}

export function feelingForSlot(ws: Workspace, projectId: string, slotId: string | undefined): TakeFeeling {
  if (!slotId) return {};
  try {
    const paths = songPathsById(ws, projectId);
    if (paths.legacy) return {};
    const slots = [...(readShotListFile(path.join(paths.root, SHOTLIST_FILE))?.slots ?? [])].sort((a, b) => a.order - b.order);
    const i = slots.findIndex((s) => s.id === slotId);
    if (i < 0) return {};
    const line = slots.slice(0, i + 1).reverse().find((s) => s.line !== null)?.line ?? null;
    return line === null ? {} : feelingOfLines(sectionsOf(ws, projectId), line);
  } catch {
    return {};
  }
}
