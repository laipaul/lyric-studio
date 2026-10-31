// The song page's Assets tab (Step 6.2c-1): the files of a song folder. Clips are dropped into
// <song folder>\clips\ (unique names, duplicates found by content), removed clips go to
// clips\_removed\ (never deleted), and a replaced song, lyrics.txt, cover, hints.lrc or vocals.wav is kept
// in .studio\replaced\. No rendering code is imported here, so the studio's server can use it directly.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { absPath, clip as clipTable, PHOTO_EXTENSION, probeMedia, project as projectTable, uniqueFileName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { isHandTimeLine } from "../hand-times";
import { HOOK_MARKER, normalizeLyric } from "../lrc";
import { cachedFileHash, SOURCE_FILE, syncCollection } from "./collection";
import { keepReplaced, storeCover, storeLyricsTxt } from "./project-settings";
import { moveEntry, songPathsById } from "./song-folder";
import { enqueueLyricTiming } from "./runs";
import { resolveVoiceSource, storedStemCheck, type StemCheckRunner } from "./voice-source";
import { storeProjectHint } from "./song-project";

export const REMOVED_DIR = "_removed";

export type ClipAsset = {
  name: string;
  file: string; // workspace-relative
  thumb: string | null; // workspace-relative
  kind: "video" | "photo";
  orientation: "vertical" | "horizontal" | "square";
  width: number;
  height: number;
  durationMs: number; // 0 for photos
  duplicateOf: string | null; // another clip of this song with the same content
};

export type SongAssets = {
  folder: string | null; // workspace-relative song folder (null: not migrated yet)
  folderPath: string | null; // the same on disk (D:\videomaker\workspace\songs\...)
  song: { name: string; file: string; durationMs: number | null; bpm: number | null } | null;
  lyrics: { file: string; lines: number } | null; // an instrumental: its story.txt (sentences)
  instrumental: boolean; // song.json "instrumental": true
  cover: string | null;
  hints: (HintsCheck & { file: string }) | null;
  // vocals.wav: Suno's vocal stem, the main guide for lyric timing (analysis only). status: lined up on the
  // song, rejected (doesn't follow the song: Demucs is used), or not checked yet (checked at the next timing).
  vocals: { file: string; name: string; status: "lined-up" | "rejected" | "unchecked"; message: string; offsetMs: number | null } | null;
  backingVocals: string | null; // backing-vocals.wav (never used for timing)
  clips: ClipAsset[];
  removed: string[]; // in clips\_removed\
  usable: { vertical: number; horizontal: number }; // for 9:16 and 16:9 platforms
};

const rel = (ws: Workspace, file: string) => path.relative(ws.dir, file).split(path.sep).join("/");
export const songClipsCollection = (projectId: string) => `song:${projectId}`;

function orientation(width: number, height: number): ClipAsset["orientation"] {
  if (Math.abs(width - height) <= Math.max(width, height) * 0.02) return "square";
  return height > width ? "vertical" : "horizontal";
}

// Everything the Assets tab shows. Clips are synced with the database on the way (thumbnail, size).
export async function songAssets(ws: Workspace, projectId: string): Promise<SongAssets> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const paths = songPathsById(ws, projectId);
  const out: SongAssets = { folder: paths.legacy ? null : paths.rel, folderPath: paths.legacy ? null : paths.root, song: null, lyrics: null, instrumental: paths.instrumental, cover: null, hints: null, vocals: null, backingVocals: null, clips: [], removed: [], usable: { vertical: 0, horizontal: 0 } };
  if (paths.audio && existsSync(paths.audio)) out.song = { name: path.basename(paths.audio), file: rel(ws, paths.audio), durationMs: p.duration_ms ?? null, bpm: p.bpm ?? null };
  if (existsSync(paths.lyricsTxt)) out.lyrics = { file: rel(ws, paths.lyricsTxt), lines: readFileSync(paths.lyricsTxt, "utf8").split(/\r?\n/).filter((l) => l.replace(/^\*\s+/, "").trim()).length };
  if (paths.cover && existsSync(paths.cover)) out.cover = rel(ws, paths.cover);
  if (paths.hints && existsSync(paths.hints)) {
    out.hints = { file: rel(ws, paths.hints), ...checkHints(readFileSync(paths.hints, "utf8"), existsSync(paths.lyricsTxt) ? readFileSync(paths.lyricsTxt, "utf8") : "") };
  }
  if (paths.vocals && existsSync(paths.vocals)) {
    const stored = p.audio_hash ? await storedStemCheck(ws, { project: p, songHash: p.audio_hash }) : null;
    const c = stored?.check;
    out.vocals = {
      file: rel(ws, paths.vocals),
      name: path.basename(paths.vocals),
      status: c ? c.status : "unchecked",
      message: c ? c.message : "Not checked yet: it is checked against the song at the next lyric timing.",
      offsetMs: c?.status === "lined-up" ? c.offset_ms : null,
    };
  }
  if (paths.backingVocals && existsSync(paths.backingVocals)) out.backingVocals = rel(ws, paths.backingVocals);
  if (!paths.clips) return out;
  const { hashes: _hashes, ...listed } = await folderClips(ws, paths.clips, songClipsCollection(projectId));
  return { ...out, ...listed };
}

// The clips of a folder (a song's clips\ or a shared collection): synced with the database on the way
// (thumbnail, size), duplicates by content, what was removed (_removed\) and the counts each format can use.
// `hashes`: the content of each different clip (sorted), so two collections holding the same clips can be told.
export async function folderClips(ws: Workspace, folder: string, collectionName: string): Promise<Pick<SongAssets, "clips" | "removed" | "usable"> & { hashes: string[] }> {
  const out: Pick<SongAssets, "clips" | "removed" | "usable"> & { hashes: string[] } = { clips: [], removed: [], usable: { vertical: 0, horizontal: 0 }, hashes: [] };
  if (!existsSync(folder)) return out;
  const removedDir = path.join(folder, REMOVED_DIR);
  if (existsSync(removedDir)) out.removed = readdirSync(removedDir).filter((f) => SOURCE_FILE.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!readdirSync(folder).some((f) => SOURCE_FILE.test(f))) return out;
  const sync = await syncCollection(ws, { name: collectionName, folder, prepare: false });
  const firstOf = new Map<string, string>();
  for (const s of sync.sources) {
    const duplicateOf = firstOf.get(s.hash) ?? null;
    if (!duplicateOf) firstOf.set(s.hash, s.name);
    const photo = PHOTO_EXTENSION.test(s.name);
    const o = orientation(s.clip.width, s.clip.height);
    out.clips.push({
      name: s.name,
      file: rel(ws, s.file),
      thumb: s.clip.thumb_path,
      kind: photo ? "photo" : "video",
      orientation: o,
      width: s.clip.width,
      height: s.clip.height,
      durationMs: photo ? 0 : s.clip.duration_ms,
      duplicateOf,
    });
    if (duplicateOf) continue;
    out.hashes.push(s.hash);
    // The same rule as the render (sourceFit): 9:16 takes vertical and square sources (horizontal
    // ones only when at least twice the output height); 16:9 takes horizontal and square ones.
    if (o !== "horizontal" || s.clip.height >= 3840) out.usable.vertical += 1;
    if (o !== "vertical" || s.clip.width >= 3840) out.usable.horizontal += 1;
  }
  out.hashes.sort();
  return out;
}

export type HintsCheck = {
  stamps: number; // every time stamp in the file
  timed: number; // stamps with a lyric line after them
  marks: number; // empty stamps: where the singing of the line before ends (pnpm tap writes one after the last line) or a pause
  orphans: string[]; // timed lines that match no line of lyrics.txt
  untapped: number; // lyric lines without a tapped time (the aligner times them on its own)
  handSet: number; // lines set by hand in the Lyrics tab ("[mm:ss.xx]! #n text"; not taps)
};

// hints.lrc against lyrics.txt (lines compared ignoring case, punctuation and "* " hook markers).
export function checkHints(hints: string, lyricsTxt: string): HintsCheck {
  const STAMP = /\[\d+:\d{1,2}(?:\.\d+)?\]/g;
  const out: HintsCheck = { stamps: 0, timed: 0, marks: 0, orphans: [], untapped: 0, handSet: 0 };
  const lyrics = lyricsTxt
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(HOOK_MARKER, "").trim())
    .filter(Boolean);
  const known = new Set(lyrics.map(normalizeLyric));
  const tapped = new Set<string>();
  for (const raw of hints.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (isHandTimeLine(raw)) {
      out.handSet++;
      continue;
    }
    const stamps = raw.match(STAMP)?.length ?? 0;
    if (!stamps || /^\[[a-z]+:/i.test(raw.trim())) continue; // [ti:...] and other tags
    out.stamps += stamps;
    const text = raw.replace(STAMP, "").replace(/<[^>]*>/g, "").trim().replace(HOOK_MARKER, "").trim();
    if (!text) {
      out.marks += stamps;
      continue;
    }
    out.timed += stamps;
    const key = normalizeLyric(text);
    tapped.add(key);
    if (lyrics.length && !known.has(key)) out.orphans.push(text);
  }
  out.untapped = lyrics.filter((l) => !tapped.has(normalizeLyric(l))).length;
  return out;
}

export type ImportResult = { added: string[]; duplicates: { name: string; sameAs: string }[]; skipped: { name: string; reason: string }[] };

// Clips dropped on the Assets tab: copied into the song's clips\ (a free name when one is taken).
// A file whose content is already there is not copied again (named in `duplicates`).
export async function importSongClips(ws: Workspace, projectId: string, files: readonly { file: string; name: string }[]): Promise<ImportResult> {
  const paths = songPathsById(ws, projectId);
  if (!paths.clips) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return importClipsInto(ws, paths.clips, songClipsCollection(projectId), files);
}

// Files copied into a clip folder (a free name when one is taken); content already there is not copied.
export async function importClipsInto(ws: Workspace, folder: string, collectionName: string, files: readonly { file: string; name: string }[]): Promise<ImportResult> {
  const paths = { clips: folder };
  mkdirSync(paths.clips, { recursive: true });
  const known = new Map<string, string>();
  for (const f of readdirSync(paths.clips)) {
    const full = path.join(paths.clips, f);
    if (SOURCE_FILE.test(f) && statSync(full).isFile()) known.set(await cachedFileHash(ws, full), f);
  }
  const result: ImportResult = { added: [], duplicates: [], skipped: [] };
  for (const f of files) {
    const name = path.basename(f.name);
    if (!SOURCE_FILE.test(name)) {
      result.skipped.push({ name, reason: "not a video or photo (.mp4, .mov, .webm, .jpg, .png, .webp, ...)" });
      continue;
    }
    const info = await probeMedia(f.file).catch(() => null);
    if (!info?.hasVideo || !info.width || !info.height) {
      result.skipped.push({ name, reason: "no video or picture found in the file" });
      continue;
    }
    const hash = await cachedFileHash(ws, f.file);
    const same = known.get(hash);
    if (same) {
      result.duplicates.push({ name, sameAs: same });
      continue;
    }
    const target = uniqueFileName(paths.clips, name);
    copyFileSync(f.file, path.join(paths.clips, target));
    known.set(hash, target);
    result.added.push(target);
  }
  if (result.added.length) await syncCollection(ws, { name: collectionName, folder: paths.clips, prepare: false });
  return result;
}

// "Remove": the clip moves to clips\_removed\ (never deleted); it can be put back by hand.
export async function removeSongClip(ws: Workspace, projectId: string, name: string): Promise<string> {
  const paths = songPathsById(ws, projectId);
  if (!paths.clips) throw new Error("This song has no folder yet.");
  return removeClipFrom(ws, paths.clips, name, "this song");
}

// A clip of a folder moves to its _removed\ (never deleted).
export async function removeClipFrom(ws: Workspace, folder: string, name: string, where: string): Promise<string> {
  const paths = { clips: folder };
  const base = path.basename(name);
  const file = path.join(paths.clips, base);
  if (base !== name || !SOURCE_FILE.test(base) || !existsSync(file)) throw new Error(`No clip ${name} in ${where}.`);
  const removedDir = path.join(paths.clips, REMOVED_DIR);
  mkdirSync(removedDir, { recursive: true });
  const target = path.join(removedDir, uniqueFileName(removedDir, base));
  moveEntry(file, target);
  const stored = rel(ws, file);
  ws.db.delete(clipTable).where(eq(clipTable.path, stored)).run();
  return rel(ws, target);
}

// "Restore": a removed clip (in _removed\) goes back into the folder (a free name when one is taken).
export function restoreClipTo(ws: Workspace, folder: string, name: string): string {
  const base = path.basename(name);
  const file = path.join(folder, REMOVED_DIR, base);
  if (base !== name || !SOURCE_FILE.test(base) || !existsSync(file)) throw new Error(`No removed clip ${name}.`);
  const target = path.join(folder, uniqueFileName(folder, base));
  moveEntry(file, target);
  return rel(ws, target);
}

export type AssetKind = "song" | "lyrics" | "cover" | "hints" | "vocals";

export function checkAsset(kind: AssetKind, file: string, name: string): string | null {
  const ext = path.extname(name).toLowerCase();
  if (kind === "song" && ![".wav", ".mp3"].includes(ext)) return `The song must be a WAV or MP3 file (got ${name}).`;
  if (kind === "lyrics") {
    if (ext !== ".txt") return `The lyrics must be a .txt file (got ${name}).`;
    if (!readFileSync(file, "utf8").split(/\r?\n/).some((l) => l.replace(/^\*\s+/, "").trim())) return "The lyrics file is empty.";
  }
  if (kind === "vocals" && ext !== ".wav") return `The vocal stem must be the WAV file downloaded from Suno (got ${name}).`;
  if (kind === "cover" && ![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return `The cover must be a JPG, PNG or WEBP picture (got ${name}).`;
  if (kind === "hints") {
    if (ext !== ".lrc") return `The hints must be an .lrc file of tapped times (got ${name}).`;
    if (!/\[\d+:\d{1,2}(\.\d+)?\]/.test(readFileSync(file, "utf8"))) return "The hints file has no time stamps like [00:12.34].";
  }
  return null;
}

// Replaces the song, lyrics.txt, cover or hints.lrc of a song folder (the old one is kept in .studio\replaced\).
export async function replaceAsset(ws: Workspace, projectId: string, kind: AssetKind, file: string, name: string): Promise<string> {
  const problem = checkAsset(kind, file, name);
  if (problem) throw new Error(problem);
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  if (kind === "lyrics") return storeLyricsTxt(ws, projectId, file);
  if (kind === "cover") return storeCover(ws, projectId, file);
  if (kind === "vocals") return (await storeVocalStem(ws, projectId, file, name)).stored;
  if (kind === "hints") {
    if (existsSync(paths.hints!)) keepReplaced(paths.root, paths.hints!);
    copyFileSync(file, paths.hints!);
    storeProjectHint(ws, projectId, paths.hints!, `${name} (from the Assets tab)`);
    return rel(ws, paths.hints!);
  }
  // A new mix or master of the same song: the old file is kept; timings stay (re-align if they moved).
  const target = path.join(paths.root, `song${path.extname(name).toLowerCase()}`);
  if (paths.audio && existsSync(paths.audio)) keepReplaced(paths.root, paths.audio);
  copyFileSync(file, target);
  const info = await probeMedia(target);
  if (!info.hasAudio) throw new Error(`No audio found in ${name}.`);
  ws.db
    .update(projectTable)
    .set({ audio_path: rel(ws, target), audio_hash: await cachedFileHash(ws, target), duration_ms: info.durationMs, bpm: null })
    .where(eq(projectTable.id, projectId))
    .run();
  return rel(ws, target);
}


export type VocalStemResult = { stored: string; status: "lined-up" | "rejected"; message: string; offsetMs: number | null; retimed: boolean };

// The Assets tab's "Vocal stem (from Suno)": the file becomes the song folder's vocals.wav (the old one
// is kept in .studio\replaced\), is checked against the song at once (same version? the offset from
// trimming; analysis only, the song is never touched) and the song's lyric timing is queued again on it
// (stored hints and hand-set starts are kept). A stem that doesn't follow the song is kept but not used.
export async function storeVocalStem(ws: Workspace, projectId: string, file: string, name: string, options: { check?: StemCheckRunner; queue?: boolean } = {}): Promise<VocalStemResult> {
  const problem = checkAsset("vocals", file, name);
  if (problem) throw new Error(problem);
  const paths = songPathsById(ws, projectId);
  if (paths.legacy || !paths.vocals) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const info = await probeMedia(file).catch(() => null);
  if (!info?.hasAudio) throw new Error(`No audio found in ${name}.`);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()!;
  if (!p.audio_path || !p.audio_hash || !existsSync(absPath(ws, p.audio_path))) throw new Error("Add the song file first: the vocal stem is checked against it.");
  if (existsSync(paths.vocals)) keepReplaced(paths.root, paths.vocals);
  copyFileSync(file, paths.vocals);
  const voice = await resolveVoiceSource(ws, { project: p, songHash: p.audio_hash, songFile: absPath(ws, p.audio_path) }, { check: options.check });
  const stored = await storedStemCheck(ws, { project: p, songHash: p.audio_hash });
  const message = voice.message ?? stored?.check.message ?? "";
  let retimed = false;
  if (options.queue !== false && !paths.instrumental && existsSync(paths.lyricsTxt)) {
    enqueueLyricTiming(ws, projectId);
    retimed = true;
  }
  return { stored: rel(ws, paths.vocals), status: voice.kind === "stem" ? "lined-up" : "rejected", message, offsetMs: voice.offsetMs ?? null, retimed };
}
