// Assets → "Replaced files": every file of a song folder that was replaced is kept in
// <song folder>\.studio\replaced\<date>-<its own name> (nothing the user made is ever deleted, CLAUDE.md).
// This lists them with what each one was (the song, the lyrics, the vocal stem, the cover, ...) and Restore
// makes one that again: the file in use now is kept in Replaced files in its place, so a Restore can be undone
// the same way. Files kept before 1 Nov 2026 have no note: their role is read from the name where it is clear.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { replaceAsset, storeVocalStem } from "./assets";
import { restoreLyrics } from "./lyrics-view";
import { readReplacedIndex, type ReplacedRole } from "./project-settings";
import { restoreShotList } from "./shotlist";
import { songPathsById, STUDIO_DIR } from "./song-folder";

export type ReplacedFile = {
  file: string; // the name in .studio\replaced\
  original: string; // the name it had in the song folder
  role: ReplacedRole | null; // null: not clear what it was (no Restore; it stays in the folder)
  at: string; // when it was replaced (ISO)
  bytes: number;
};

const STAMPED = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:\.\d+)?-(.+)$/;

function roleFromName(original: string): ReplacedRole | null {
  if (/^cover\.(jpe?g|png|webp)$/i.test(original)) return "cover";
  if (/\.lrc$/i.test(original)) return "hints";
  if (original === "shotlist.json") return "shotlist";
  if (/\.txt$/i.test(original)) return "lyrics";
  return null; // a WAV or MP3 could be the song, the vocal stem or the backing vocals
}

export function songReplacedFiles(ws: Workspace, projectId: string): ReplacedFile[] {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) return [];
  const dir = path.join(paths.root, STUDIO_DIR, "replaced");
  if (!existsSync(dir)) return [];
  const notes = new Map(readReplacedIndex(paths.root).map((n) => [n.file, n]));
  const out: ReplacedFile[] = [];
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    const m = STAMPED.exec(f);
    if (!m || !statSync(full).isFile()) continue; // backups of other kinds (guard files, ...) are not listed
    const note = notes.get(f);
    const original = note?.original ?? m[2];
    const at = note?.at ?? new Date(`${m[1].slice(0, 10)}T${m[1].slice(11).replace(/-/g, ":")}Z`).toISOString();
    // An instrumental's text is story.txt; a song with lyrics never restores a story (and back).
    let role = note ? note.role : roleFromName(original);
    if (role === "lyrics" && paths.instrumental !== (original === "story.txt")) role = null;
    out.push({ file: f, original, role, at, bytes: statSync(full).size });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.file.localeCompare(a.file));
}

// Restore: the kept file becomes what it was again; the one in use now goes to Replaced files.
export async function restoreReplacedFile(ws: Workspace, projectId: string, file: string): Promise<{ role: ReplacedRole; restored: string }> {
  const entry = songReplacedFiles(ws, projectId).find((x) => x.file === file);
  if (!entry || path.basename(file) !== file) throw new Error("That file is not in Replaced files any more.");
  if (!entry.role) throw new Error(`It is not clear what ${entry.original} was, so it cannot be restored here. It stays in the song folder (.studio\\replaced\\).`);
  const paths = songPathsById(ws, projectId);
  const source = path.join(paths.root, STUDIO_DIR, "replaced", file);
  const before = readFileSync(source);
  let restored: string;
  if (entry.role === "shotlist") {
    // The kept shot list is imported again (the one in use now goes to Replaced files); its kept copy stays.
    await restoreShotList(ws, projectId, source);
    return { role: entry.role, restored: entry.original };
  }
  if (entry.role === "lyrics") {
    restoreLyrics(ws, projectId, file);
    restored = entry.original;
  } else if (entry.role === "vocals") restored = (await storeVocalStem(ws, projectId, source, entry.original)).stored;
  else restored = await replaceAsset(ws, projectId, entry.role, source, entry.original);
  // The restored file now sits in the song folder (a copy): the identical kept copy is not needed twice.
  // The lyrics are written as text (line endings may differ), so their kept copy stays.
  const placed = entry.role === "lyrics" ? null : path.join(ws.dir, restored);
  if (placed && existsSync(placed) && existsSync(source) && readFileSync(placed).equals(before)) rmSync(source);
  return { role: entry.role, restored };
}
