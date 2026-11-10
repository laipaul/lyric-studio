// Story notes on a song's clips (Prepare → Clips, asked by the user on 9 Nov 2026): a few words per clip on its role
// in the story line, written by the user FOR THE USER ONLY. The app never reads them for anything else: no planning,
// no Make, no storyboard, no assessment, no AI (test/clip-notes.test.ts checks that only assets.ts reads this file).
//
// Kept in the song folder's .studio\clip-notes.json, keyed by the clip's content fingerprint (the same hash the clip
// sync uses), so a note survives reordering, renaming the file, Omit / Use, removing and restoring the clip, and every
// regeneration (notes are not part of clips.json or of a storyboard). A clip whose content was replaced under the same
// name finds its note by the name (the note is then keyed by the new content). Clearing the text deletes the note.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { STUDIO_DIR } from "./song-folder";

export const CLIP_NOTES_FILE = "clip-notes.json";
export const CLIP_NOTE_MAX = 2000; // characters
export type ClipNote = { text: string; clip: string; updatedAt: string }; // clip: the file name when last written
type NotesFile = { about: string; notes: Record<string, ClipNote> };
const ABOUT = "Story notes on this song's clips (Prepare → Storyboard), for you only: the app never reads them for anything. Keyed by each clip's content, so they follow a renamed or moved clip.";

const fileOf = (songRoot: string) => path.join(songRoot, STUDIO_DIR, CLIP_NOTES_FILE);

export function readClipNotes(songRoot: string): Record<string, ClipNote> {
  const file = fileOf(songRoot);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<NotesFile>;
    const out: Record<string, ClipNote> = {};
    for (const [hash, n] of Object.entries(raw.notes ?? {})) if (n && typeof n.text === "string" && n.text.trim()) out[hash] = { text: n.text, clip: String(n.clip ?? ""), updatedAt: String(n.updatedAt ?? "") };
    return out;
  } catch {
    return {}; // a broken file is never fatal for the clips list (it is rewritten on the next save)
  }
}

// The note of each clip: by its content; else by its name, when no clip of the song has that note's content any more
// (the file was replaced by another one under the same name).
export function notesForClips(notes: Record<string, ClipNote>, clips: readonly { name: string; hash: string }[]): Map<string, string> {
  const hashes = new Set(clips.map((c) => c.hash));
  const out = new Map<string, string>();
  for (const c of clips) {
    const own = notes[c.hash];
    const orphan = own ? null : Object.entries(notes).find(([h, n]) => !hashes.has(h) && n.clip === c.name)?.[1];
    const text = (own ?? orphan)?.text;
    if (text) out.set(c.name, text);
  }
  return out;
}

// Saves (or, with empty text, deletes) one clip's note. Written atomically (a temporary file, then renamed).
export function setClipNote(songRoot: string, o: { hash: string; clip: string; text: string; now?: Date }): ClipNote | null {
  if (!/^[0-9a-f]{16,128}$/i.test(o.hash)) throw new Error("Which clip? (its fingerprint is missing)");
  const text = String(o.text ?? "").replace(/\r\n/g, "\n").slice(0, CLIP_NOTE_MAX);
  const notes = readClipNotes(songRoot);
  // An old note found by the clip's name (content replaced) moves to the new content.
  for (const [h, n] of Object.entries(notes)) if (h !== o.hash && n.clip === o.clip) delete notes[h];
  const note = text.trim() ? { text, clip: o.clip, updatedAt: (o.now ?? new Date()).toISOString() } : null;
  if (note) notes[o.hash] = note;
  else delete notes[o.hash];
  const file = fileOf(songRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ about: ABOUT, notes } satisfies NotesFile, null, 2)}\n`);
  renameSync(tmp, file);
  return note;
}
