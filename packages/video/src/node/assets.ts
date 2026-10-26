// The song page's Assets tab (Step 6.2c-1): the files of a song folder. Clips are dropped into
// <song folder>\clips\ (unique names, duplicates found by content), removed clips go to
// clips\_removed\ (never deleted), and a replaced song, lyrics.txt, cover or hints.lrc is kept in
// .studio\replaced\. No rendering code is imported here, so the studio's server can use it directly.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { clip as clipTable, PHOTO_EXTENSION, probeMedia, project as projectTable, uniqueFileName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { HOOK_MARKER, normalizeLyric } from "../lrc";
import { cachedFileHash, SOURCE_FILE, syncCollection } from "./collection";
import { keepReplaced, storeCover, storeLyricsTxt } from "./project-settings";
import { moveEntry, songPathsById } from "./song-folder";
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
  lyrics: { file: string; lines: number } | null;
  cover: string | null;
  hints: (HintsCheck & { file: string }) | null;
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
  const out: SongAssets = { folder: paths.legacy ? null : paths.rel, folderPath: paths.legacy ? null : paths.root, song: null, lyrics: null, cover: null, hints: null, clips: [], removed: [], usable: { vertical: 0, horizontal: 0 } };
  if (paths.audio && existsSync(paths.audio)) out.song = { name: path.basename(paths.audio), file: rel(ws, paths.audio), durationMs: p.duration_ms ?? null, bpm: p.bpm ?? null };
  if (existsSync(paths.lyricsTxt)) out.lyrics = { file: rel(ws, paths.lyricsTxt), lines: readFileSync(paths.lyricsTxt, "utf8").split(/\r?\n/).filter((l) => l.replace(/^\*\s+/, "").trim()).length };
  if (paths.cover && existsSync(paths.cover)) out.cover = rel(ws, paths.cover);
  if (paths.hints && existsSync(paths.hints)) {
    out.hints = { file: rel(ws, paths.hints), ...checkHints(readFileSync(paths.hints, "utf8"), existsSync(paths.lyricsTxt) ? readFileSync(paths.lyricsTxt, "utf8") : "") };
  }
  if (!paths.clips || !existsSync(paths.clips)) return out;
  const removedDir = path.join(paths.clips, REMOVED_DIR);
  if (existsSync(removedDir)) out.removed = readdirSync(removedDir).filter((f) => SOURCE_FILE.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!readdirSync(paths.clips).some((f) => SOURCE_FILE.test(f))) return out;
  const sync = await syncCollection(ws, { name: songClipsCollection(projectId), folder: paths.clips, prepare: false });
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
    // The same rule as the render (sourceFit): 9:16 takes vertical and square sources (horizontal
    // ones only when at least twice the output height); 16:9 takes horizontal and square ones.
    if (o !== "horizontal" || s.clip.height >= 3840) out.usable.vertical += 1;
    if (o !== "vertical" || s.clip.width >= 3840) out.usable.horizontal += 1;
  }
  return out;
}

export type HintsCheck = {
  stamps: number; // every time stamp in the file
  timed: number; // stamps with a lyric line after them
  marks: number; // empty stamps: where the singing of the line before ends (pnpm tap writes one after the last line) or a pause
  orphans: string[]; // timed lines that match no line of lyrics.txt
  untapped: number; // lyric lines without a tapped time (the aligner times them on its own)
};

// hints.lrc against lyrics.txt (lines compared ignoring case, punctuation and "* " hook markers).
export function checkHints(hints: string, lyricsTxt: string): HintsCheck {
  const STAMP = /\[\d+:\d{1,2}(?:\.\d+)?\]/g;
  const out: HintsCheck = { stamps: 0, timed: 0, marks: 0, orphans: [], untapped: 0 };
  const lyrics = lyricsTxt
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(HOOK_MARKER, "").trim())
    .filter(Boolean);
  const known = new Set(lyrics.map(normalizeLyric));
  const tapped = new Set<string>();
  for (const raw of hints.replace(/^\uFEFF/, "").split(/\r?\n/)) {
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
  if (result.added.length) await syncCollection(ws, { name: songClipsCollection(projectId), folder: paths.clips, prepare: false });
  return result;
}

// "Remove": the clip moves to clips\_removed\ (never deleted); it can be put back by hand.
export async function removeSongClip(ws: Workspace, projectId: string, name: string): Promise<string> {
  const paths = songPathsById(ws, projectId);
  if (!paths.clips) throw new Error("This song has no folder yet.");
  const base = path.basename(name);
  const file = path.join(paths.clips, base);
  if (base !== name || !SOURCE_FILE.test(base) || !existsSync(file)) throw new Error(`No clip ${name} in this song.`);
  const removedDir = path.join(paths.clips, REMOVED_DIR);
  mkdirSync(removedDir, { recursive: true });
  const target = path.join(removedDir, uniqueFileName(removedDir, base));
  moveEntry(file, target);
  const stored = rel(ws, file);
  ws.db.delete(clipTable).where(eq(clipTable.path, stored)).run();
  return rel(ws, target);
}

export type AssetKind = "song" | "lyrics" | "cover" | "hints";

export function checkAsset(kind: AssetKind, file: string, name: string): string | null {
  const ext = path.extname(name).toLowerCase();
  if (kind === "song" && ![".wav", ".mp3"].includes(ext)) return `The song must be a WAV or MP3 file (got ${name}).`;
  if (kind === "lyrics") {
    if (ext !== ".txt") return `The lyrics must be a .txt file (got ${name}).`;
    if (!readFileSync(file, "utf8").split(/\r?\n/).some((l) => l.replace(/^\*\s+/, "").trim())) return "The lyrics file is empty.";
  }
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

