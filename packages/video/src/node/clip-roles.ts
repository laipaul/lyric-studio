// What each file in a song's clips\ folder is for (Prepare → Storyboard shows only the "story" ones):
//   story    a story moment the user sent (dropped, picked, or sent from Creation): numbered, orderable.
//   singing  a singing take (lip sync): an anchor of song.json with "sync", or the clip a lip-sync take of Creation was
//            sent as. It belongs to its Lyrics Sync line and plays only there.
//   lineOnly clips.json "lineOnly": a Creation take picked in Lyrics Sync for a line or as a hidden-moment cover.
// Hidden clips keep their entries in clips.json; nothing is deleted. No rendering code is imported here.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { editOf, readClipEdits } from "./clip-edits";
import { readRecipe } from "./recipe";

export type ClipRole = "story" | "singing" | "lineOnly";
export type SingingLine = { line: number; through: number; clip?: string }; // clip: the singing take (two-layer timeline B1: V1 markers in the story line)

const PICTURES_PATH = ["pictures", "pictures.json"];

// The clips that lip-sync takes of Creation were sent as (pictures\pictures.json; read here without importing animate.ts).
function lipsyncClips(songRoot: string): Set<string> {
  const out = new Set<string>();
  const file = path.join(songRoot, ...PICTURES_PATH);
  if (!existsSync(file)) return out;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { pictures?: Record<string, { takes?: { kind?: string; sent?: string; clip?: string }[] }> };
    for (const rec of Object.values(raw.pictures ?? {})) for (const t of rec?.takes ?? []) if (t.kind === "lipsync" && (t.sent ?? t.clip)) out.add((t.sent ?? t.clip)!.toLowerCase());
  } catch {
    // an unreadable file: no clip is taken for singing
  }
  return out;
}

export function songSingingLines(recipeFile: string | null): { clip: string; line: number; through: number }[] {
  if (!recipeFile || !existsSync(recipeFile)) return [];
  return (readRecipe(recipeFile).anchors ?? []).filter((a) => a.sync !== undefined).map((a) => ({ clip: a.clip, line: a.line, through: a.through ?? a.line }));
}

export function clipRoles(songRoot: string, recipeFile: string | null, names: readonly string[]): Map<string, ClipRole> {
  const edits = readClipEdits(songRoot);
  const singing = lipsyncClips(songRoot);
  for (const a of songSingingLines(recipeFile)) singing.add(a.clip.toLowerCase());
  return new Map(names.map((n) => [n, singing.has(n.toLowerCase()) ? "singing" : editOf(edits, n).lineOnly ? "lineOnly" : "story"] as const));
}
