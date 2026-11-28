// The song's tracks on disk (Part A, 28 Nov 2026; src/tracks.ts says what they are): <song folder>\tracks.json.
// Made from the song's edit (song.json "anchors", clips.json "order" and "inserts") the first time and again whenever
// that edit changed since (its fingerprint), so the tracks always say what the song's edit says. Make reads its edit
// through the tracks (songEditFromTracks): nothing a video shows changes (pnpm tracks:check proves it per video).
// The song's own files are only read here; tracks.json is the only file written.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AnchorSpec } from "../anchors";
import { fingerprint, fromEdit, toEdit, TRACKS_VERSION, type Edit, type Tracks } from "../tracks";
import { readClipEdits, type ClipEdits } from "./clip-edits";
import { readRecipe } from "./recipe";

export const TRACKS_FILE = "tracks.json";
const HELP = "The song's edit as tracks, like a pro editor: \"singer\" (V1: singing clips locked to song time, always 1.00x) and \"broll\" (V2: the story line, story clips on their lines, B-roll over a stretch of the song, cut-aways over the singer). Written by the app from song.json and clips.json; made again when those change.";

// The edit Make reads today, straight from the song's files.
export function songEdit(recipeFile: string | null, songRoot: string): Edit {
  const anchors: AnchorSpec[] = recipeFile ? (readRecipe(recipeFile).anchors ?? []) : [];
  const edits = readClipEdits(songRoot);
  return { anchors, order: edits.order, inserts: edits.inserts ?? [] };
}

export function readTracksFile(songRoot: string): Tracks | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(songRoot, TRACKS_FILE), "utf8")) as Tracks & { _help?: string };
    if (raw.version !== TRACKS_VERSION || !Array.isArray(raw.singer) || !raw.broll || !Array.isArray(raw.broll.story)) return null;
    delete raw._help;
    return raw;
  } catch {
    return null;
  }
}

function writeTracksFile(songRoot: string, t: Tracks): void {
  const file = path.join(songRoot, TRACKS_FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ _help: HELP, ...t }, null, 2)}\n`);
  renameSync(tmp, file);
}

// The song's tracks: tracks.json when it was made from the edit as it is now, else made from the edit (and saved,
// unless `write` is false: pnpm tracks:check changes nothing). `made`: they were (re)made now.
export function songTracks(recipeFile: string | null, songRoot: string, o: { write?: boolean } = {}): { tracks: Tracks; made: boolean } {
  const edit = songEdit(recipeFile, songRoot);
  const saved = readTracksFile(songRoot);
  if (saved && saved.from === fingerprint(edit)) return { tracks: saved, made: false };
  const tracks = fromEdit(edit);
  if (o.write !== false && existsSync(songRoot)) {
    try {
      writeTracksFile(songRoot, saved?.videos ? { ...tracks, videos: saved.videos } : tracks);
    } catch {
      // a read-only folder: the tracks are still used, made again next time
    }
  }
  return { tracks, made: true };
}

// What Make reads, through the tracks: the anchors, and the clips.json edits with the story order and inserts from V2
// (an "inserts" that was not in clips.json stays absent, so nothing Make compares changes).
export function songEditFromTracks(recipeFile: string | null, songRoot: string, edits: ClipEdits, o: { write?: boolean } = {}): { anchors: AnchorSpec[]; edits: ClipEdits } {
  const e = toEdit(songTracks(recipeFile, songRoot, o).tracks);
  const next: ClipEdits = { ...edits, order: e.order };
  if (e.inserts.length || edits.inserts !== undefined) next.inserts = e.inserts;
  return { anchors: e.anchors, edits: next };
}
