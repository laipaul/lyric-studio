// One folder per song (Step 6.2c): WORKSPACE_DIR\songs\<artist>\<title>\ with song.wav|mp3, lyrics.txt,
// cover.jpg|png, hints.lrc, clips\, exports\, song.json (the recipe) and .studio\ (the tool's own
// files: alignments, stored hints and lyrics copies, settings). Songs not migrated yet keep the old
// layout (projects\<id>\); every path goes through songPaths(), so both work.
//
// Moving a folder (migration, renaming a song) rewrites the paths stored in the database and records
// the move in WORKSPACE_DIR\.studio\moved-paths.json, so old manifests (never edited) still find their
// files: resolveMoved() follows the moves.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, clip, makeRun, project as projectTable, renderJob, variation, videoMark, type Project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { linkFile, readLinks, roleFile } from "./file-links";
import { processAlive } from "./jobs";

export const SONGS_DIR = "songs";
export const COLLECTIONS_DIR = "collections";
export const REMOVED_COLLECTIONS_DIR = "_removed"; // deleted collections: collections\_removed\<name> (removed <date>)
export const STUDIO_DIR = ".studio";
export const NAME_MAX = 60;

// A readable folder name: accents and spaces stay; characters Windows forbids become "_"; no
// trailing dots or spaces; not a reserved device name; at most NAME_MAX characters.
export function folderName(text: string, max = NAME_MAX): string {
  let name = text
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  name = [...name].slice(0, max).join("").replace(/[. ]+$/, "").trim();
  if (!name) name = "untitled";
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = `_${name}`;
  return name;
}

// songs/<artist>/<title>, with " (2)", " (3)" ... when another song already has that folder.
export function songFolderFor(ws: Workspace, artist: string, title: string, projectId?: string): string {
  const base = `${SONGS_DIR}/${folderName(artist || "Life Lyrics")}/${folderName(title)}`;
  const taken = (rel: string) => {
    const owner = ws.db.select({ id: projectTable.id }).from(projectTable).where(eq(projectTable.folder, rel)).get();
    if (owner) return owner.id !== projectId;
    return existsSync(absPath(ws, rel)) && !holdsNoFiles(absPath(ws, rel)); // an empty folder (made by hand) is free
  };
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base} (${n})`)) return `${base} (${n})`;
}

export const STORY_FILE = "story.txt";
// Suno's vocal stems (analysis only: never edited, never mixed back, never in any output).
export const VOCALS_FILE = "vocals.wav";
export const BACKING_VOCALS_FILE = "backing-vocals.wav";
const STEM_FILE = /^(backing-)?vocals\.(wav|mp3|flac)$/i;
// A stem by its name (any name): "Lead Vocal", "Vocals", "Vox", "Acapella", "Backing Vocals", "Harmonies", "BGV".
export const STEM_NAME = /vocal|(?<![a-z])vox(?![a-z])|acapella|a cappella|backing|harmon|(?<![a-z])bgv(?![a-z])|(?<![a-z])stem/i;
// A WAV by its content (RIFF/RF64 ... WAVE), for files that lost their extension.
export function isWavFile(file: string): boolean {
  try {
    const fd = openSync(file, "r");
    const head = Buffer.alloc(12);
    try {
      readSync(fd, head, 0, 12, 0);
    } finally {
      closeSync(fd);
    }
    return /^(RIFF|RF64)$/.test(head.toString("latin1", 0, 4)) && head.toString("latin1", 8, 12) === "WAVE";
  } catch {
    return false;
  }
}
export const BACKING_NAME = /backing|harmon|(?<![a-z])(bgv|bvs?)(?![a-z])|choir/i;

// song.json "instrumental": true (read directly: song paths are needed before the recipe is).
export function isInstrumental(recipeFile: string): boolean {
  try {
    return existsSync(recipeFile) && (JSON.parse(readFileSync(recipeFile, "utf8")) as { instrumental?: unknown }).instrumental === true;
  } catch {
    return false;
  }
}

export type SongPaths = {
  legacy: boolean; // still in projects\<id>\
  rel: string; // the song's folder, workspace-relative
  root: string;
  audio: string | null;
  cover: string | null;
  lyricsTxt: string; // the song's lyrics (any name, linked in .studio\files.json; else lyrics.txt; an instrumental: its story.txt)
  instrumental: boolean; // song.json "instrumental": true (no sung lyrics; the text is story.txt)
  hints: string | null; // hints.lrc (song folders only)
  vocals: string | null; // the vocal stem (any name, linked; else vocals.wav), the main guide for lyric timing (song folders only; analysis only)
  backingVocals: string | null; // the backing vocals (any name, linked; else backing-vocals.wav) (optional; never used for alignment)
  clips: string | null; // the song's own clips (song folders only)
  exports: string;
  exportsRel: string;
  store: string; // alignments, stored hints, lyrics copies
  storeRel: string;
  settings: string; // the tool's settings for the song
  recipe: string | null; // song.json (song folders only)
};

type ProjectPaths = Pick<Project, "id" | "folder" | "audio_path" | "cover_path">;

export function songPaths(ws: Workspace, p: ProjectPaths): SongPaths {
  const audio = p.audio_path ? absPath(ws, p.audio_path) : null;
  const cover = p.cover_path ? absPath(ws, p.cover_path) : null;
  if (!p.folder) {
    const rel = `projects/${p.id}`;
    return {
      legacy: true,
      rel,
      root: absPath(ws, rel),
      audio,
      cover,
      lyricsTxt: absPath(ws, `${rel}/lyrics/lyrics.txt`),
      instrumental: false,
      hints: null,
      vocals: null,
      backingVocals: null,
      clips: null,
      exports: absPath(ws, `${rel}/exports`),
      exportsRel: `${rel}/exports`,
      store: absPath(ws, `${rel}/lyrics`),
      storeRel: `${rel}/lyrics`,
      settings: absPath(ws, `${rel}/settings.json`),
      recipe: null,
    };
  }
  const rel = p.folder;
  const instrumental = isInstrumental(absPath(ws, `${rel}/song.json`));
  // Each file keeps the user's own name: the roles are linked in .studio\files.json (old fixed names as fallback).
  const root = absPath(ws, rel);
  const links = readLinks(root);
  return {
    legacy: false,
    rel,
    root: absPath(ws, rel),
    audio,
    cover,
    lyricsTxt: instrumental ? absPath(ws, `${rel}/${STORY_FILE}`) : roleFile(root, "lyrics", links),
    instrumental,
    hints: absPath(ws, `${rel}/hints.lrc`),
    vocals: roleFile(root, "vocals", links),
    backingVocals: roleFile(root, "backingVocals", links),
    clips: absPath(ws, `${rel}/clips`),
    exports: absPath(ws, `${rel}/exports`),
    exportsRel: `${rel}/exports`,
    store: absPath(ws, `${rel}/${STUDIO_DIR}/lyrics`),
    storeRel: `${rel}/${STUDIO_DIR}/lyrics`,
    settings: absPath(ws, `${rel}/${STUDIO_DIR}/settings.json`),
    recipe: absPath(ws, `${rel}/song.json`),
  };
}

export function songPathsById(ws: Workspace, projectId: string): SongPaths {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error(`Song not found: ${projectId}`);
  return songPaths(ws, p);
}

// ---- moves -----------------------------------------------------------------------------------------

export type Move = { from: string; to: string; at: string }; // workspace-relative files or folders ("projects/<id>/exports")
const movesFile = (workspaceDir: string) => path.join(workspaceDir, STUDIO_DIR, "moved-paths.json");

export function readMoves(workspaceDir: string): Move[] {
  try {
    return JSON.parse(readFileSync(movesFile(workspaceDir), "utf8")) as Move[];
  } catch {
    return [];
  }
}

export function writeMoves(workspaceDir: string, moves: Move[]): void {
  mkdirSync(path.dirname(movesFile(workspaceDir)), { recursive: true });
  writeFileSync(movesFile(workspaceDir), `${JSON.stringify(moves, null, 2)}\n`);
}

const bare = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

export { movesSince, resolveMoved } from "./media";

// A file or folder of the workspace moved from `fromRel` to `toRel` (workspace-relative): every path
// stored in the database is updated, and the move is recorded for old manifests.
export function relocatePaths(ws: Workspace, fromRel: string, toRel: string): void {
  const from = bare(fromRel);
  const to = bare(toRel);
  const fromAbs = bare(absPath(ws, from));
  const toAbs = bare(absPath(ws, to));
  const under = (v: string, base: string) => v === base || v.startsWith(`${base}/`);
  const rel = (v: string | null) => {
    if (!v) return v;
    const norm = v.replace(/\\/g, "/");
    return under(norm, from) ? to + norm.slice(from.length) : v;
  };
  // Absolute paths (run options) may use either separator.
  const abs = (v: unknown) => {
    if (typeof v !== "string") return v;
    const norm = v.replace(/\\/g, "/");
    if (!under(norm, fromAbs)) return v;
    const moved = toAbs + norm.slice(fromAbs.length);
    return v.includes("\\") ? moved.replace(/\//g, "\\") : moved;
  };
  const db = ws.db;
  for (const p of db.select().from(projectTable).all()) {
    const next = { audio_path: rel(p.audio_path), cover_path: rel(p.cover_path), folder: p.folder ? rel(p.folder) : p.folder };
    if (next.audio_path !== p.audio_path || next.cover_path !== p.cover_path || next.folder !== p.folder) db.update(projectTable).set(next).where(eq(projectTable.id, p.id)).run();
  }
  for (const c of db.select().from(clip).all()) {
    const next = { path: rel(c.path)!, thumb_path: rel(c.thumb_path) };
    if (next.path !== c.path || next.thumb_path !== c.thumb_path) db.update(clip).set(next).where(eq(clip.id, c.id)).run();
  }
  for (const m of db.select().from(videoMark).all()) {
    const video = rel(m.video)!;
    if (video !== m.video) db.update(videoMark).set({ video }).where(eq(videoMark.id, m.id)).run();
  }
  for (const r of db.select().from(makeRun).all()) {
    const options = Object.fromEntries(Object.entries(r.options_json).map(([k, v]) => [k, abs(v)]));
    const export_dir = rel(r.export_dir);
    if (export_dir !== r.export_dir || JSON.stringify(options) !== JSON.stringify(r.options_json)) db.update(makeRun).set({ export_dir, options_json: options }).where(eq(makeRun.id, r.id)).run();
  }
  for (const v of db.select().from(variation).all()) {
    if (!v.overrides_json) continue;
    const o = { ...v.overrides_json };
    for (const k of ["run", "lrc"]) if (typeof o[k] === "string") o[k] = rel(o[k] as string);
    if (JSON.stringify(o) !== JSON.stringify(v.overrides_json)) db.update(variation).set({ overrides_json: o }).where(eq(variation.id, v.id)).run();
  }
  for (const j of db.select().from(renderJob).all()) {
    const output_path = rel(j.output_path);
    if (output_path !== j.output_path) db.update(renderJob).set({ output_path }).where(eq(renderJob.id, j.id)).run();
  }
  writeMoves(ws.dir, [...readMoves(ws.dir), { from, to, at: new Date().toISOString() }]);
}

// A folder without any file in it (empty sub-folders only), e.g. made by hand in advance.
export function holdsNoFiles(dir: string): boolean {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return readdirSync(dir, { withFileTypes: true }).every((e) => e.isDirectory() && holdsNoFiles(path.join(dir, e.name)));
}

// Moves a file or folder inside the workspace (same drive: a rename), creating the target's parent.
// An existing target is never overwritten (only an empty folder is replaced).
export function moveEntry(fromAbs: string, toAbs: string): void {
  mkdirSync(path.dirname(toAbs), { recursive: true });
  if (holdsNoFiles(toAbs)) rmSync(toAbs, { recursive: true });
  if (existsSync(toAbs)) throw new Error(`Cannot move ${fromAbs}: ${toAbs} already exists.`);
  renameSync(fromAbs, toAbs);
}

// Removes `dir` and its parents up to (not including) `stop` while they are empty.
export function removeEmptyDirs(dir: string, stop: string): void {
  let current = path.resolve(dir);
  const end = path.resolve(stop);
  while (current.startsWith(end) && current !== end && existsSync(current) && statSync(current).isDirectory()) {
    if (readdirSync(current).length) return;
    rmdirSync(current);
    current = path.dirname(current);
  }
}

// Deleted songs (31 Oct 2026): the song's folder moves to songs\_removed\<artist> - <title> (removed <date>) and
// its row stays (so its videos, marks and runs come back with Restore); the Library, Themes, Collections and
// Releases skip it.
export const REMOVED_SONGS = `${SONGS_DIR}/_removed`;
export const isRemovedSong = (folder: string | null | undefined): boolean => !!folder && (folder === REMOVED_SONGS || folder.startsWith(`${REMOVED_SONGS}/`));

// Is anything rendering for this song right now (a studio run or a terminal "pnpm make")?
// `selfPid`: this process (a run renaming its own song) does not count.
export function songBusy(ws: Workspace, projectId: string, selfPid?: number): boolean {
  const alive = (pid: number | null) => pid !== null && pid !== selfPid && processAlive(pid);
  if (ws.db.select().from(makeRun).where(eq(makeRun.project_id, projectId)).all().some((r) => r.status === "running" && alive(r.pid))) return true;
  const jobs = ws.db
    .select({ status: renderJob.status, pid: renderJob.pid })
    .from(renderJob)
    .innerJoin(variation, eq(renderJob.variation_id, variation.id))
    .where(eq(variation.project_id, projectId))
    .all();
  return jobs.some((j) => (j.status === "queued" || j.status === "rendering") && alive(j.pid));
}

// Renaming a song (title / artist) renames its folder. Not while it is rendering.
export function renameSongFolder(ws: Workspace, projectId: string, opts: { selfPid?: number } = {}): string | null {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p?.folder) return null;
  const target = songFolderFor(ws, p.artist, p.title, p.id);
  if (target === p.folder) return null;
  if (songBusy(ws, projectId, opts.selfPid)) throw new Error(`"${p.title}" is being rendered right now; rename it when the run has finished.`);
  const oldRoot = absPath(ws, p.folder);
  moveEntry(oldRoot, absPath(ws, target));
  relocatePaths(ws, p.folder, target);
  removeEmptyDirs(path.dirname(oldRoot), absPath(ws, SONGS_DIR));
  return target;
}

// A new song goes straight into its own folder: the song file (under its own name) and cover are moved there from the
// place createProject put them. A song file that already sits in a song folder nobody owns yet
// (songs\<artist>\<title>\ made by hand) adopts that folder (title and artist from its names).
// The folder is built in songs\.adding-<id>\ and renamed once at the end; the database names the
// folder only then, so an interrupted adoption is simply finished the next time (never split).
export const ADDING_PREFIX = ".adding-";
export function adoptIntoSongFolder(ws: Workspace, projectId: string, songFile?: string): string {
  let p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()!;
  if (p.folder) return p.folder;
  const own = songFile ? unownedSongFolder(ws, songFile) : null;
  if (own) {
    // The folder's own song file stays; the copy createProject made is not needed.
    // It is kept in the folder's .studio\replaced\ (never deleted, 1 Nov 2026), named after where it was.
    if (p.audio_path && existsSync(absPath(ws, p.audio_path)) && path.resolve(absPath(ws, p.audio_path)) !== path.resolve(songFile!)) {
      const spare = path.join(absPath(ws, own.rel), STUDIO_DIR, "replaced", `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-copy-${path.basename(p.audio_path)}`);
      mkdirSync(path.dirname(spare), { recursive: true });
      moveEntry(absPath(ws, p.audio_path), spare);
    }
    const folderCover = ["cover.jpg", "cover.jpeg", "cover.png"].find((c) => existsSync(path.join(absPath(ws, own.rel), c)));
    mkdirSync(path.join(absPath(ws, own.rel), "clips"), { recursive: true });
    mkdirSync(path.join(absPath(ws, own.rel), "exports"), { recursive: true });
    ws.db
      .update(projectTable)
      .set({ title: own.title, artist: own.artist, folder: own.rel, audio_path: `${own.rel}/${path.basename(songFile!)}`, cover_path: folderCover ? `${own.rel}/${folderCover}` : p.cover_path })
      .where(eq(projectTable.id, p.id))
      .run();
    linkFile(absPath(ws, own.rel), "song", path.basename(songFile!));
    removeOldProjectDirs(ws, p.id);
    return own.rel;
  }
  const stage = `${SONGS_DIR}/${ADDING_PREFIX}${p.id}`;
  const stageAbs = absPath(ws, stage);
  mkdirSync(path.join(stageAbs, "clips"), { recursive: true });
  mkdirSync(path.join(stageAbs, "exports"), { recursive: true });
  // The song keeps its own name (the role is linked in .studio\files.json); the cover becomes cover.<ext>.
  const into = (rel: string | null, name: string | null) => {
    if (!rel || rel.startsWith(`${stage}/`) || !existsSync(absPath(ws, rel))) return rel;
    const to = name ? `${stage}/${name}${path.extname(rel).toLowerCase()}` : `${stage}/${path.basename(rel)}`;
    moveEntry(absPath(ws, rel), absPath(ws, to));
    return to;
  };
  const audio = into(p.audio_path, null);
  if (audio) linkFile(stageAbs, "song", path.basename(audio));
  const cover = into(p.cover_path, "cover");
  p = ws.db.update(projectTable).set({ audio_path: audio, cover_path: cover }).where(eq(projectTable.id, p.id)).returning().get();
  const target = songFolderFor(ws, p.artist, p.title, p.id);
  moveEntry(stageAbs, absPath(ws, target));
  const moved = (rel: string | null) => (rel && rel.startsWith(`${stage}/`) ? target + rel.slice(stage.length) : rel);
  ws.db.update(projectTable).set({ folder: target, audio_path: moved(p.audio_path), cover_path: moved(p.cover_path) }).where(eq(projectTable.id, p.id)).run();
  removeOldProjectDirs(ws, p.id);
  return target;
}

function removeOldProjectDirs(ws: Workspace, projectId: string): void {
  const old = absPath(ws, `projects/${projectId}`);
  for (const sub of ["audio", "exports"]) removeEmptyDirs(path.join(old, sub), absPath(ws, "projects"));
}

// songs/<artist>/<title>/ holding `songFile`, when no song owns that folder yet.
function unownedSongFolder(ws: Workspace, songFile: string): { rel: string; artist: string; title: string } | null {
  const rel = path.relative(ws.dir, path.dirname(path.resolve(songFile))).split(path.sep);
  if (rel.length !== 3 || rel[0] !== SONGS_DIR) return null;
  const folder = rel.join("/");
  if (ws.db.select({ id: projectTable.id }).from(projectTable).where(eq(projectTable.folder, folder)).get()) return null;
  return { rel: folder, artist: rel[1], title: rel[2] };
}

// The files of a song folder for "pnpm make <folder>": the files linked in .studio\files.json (any
// names), else song.wav|mp3 (or the only audio file besides the vocal stems), lyrics.txt (or the only
// other .txt), hints.lrc when there is one.
export const RESERVED_TXT = /^(story|stills|pins|publish|qa)\.txt$/i;
export const AUDIO_FILE = /\.(wav|mp3|flac|aiff?|m4a)$/i;
export function songFolderFiles(dir: string): { song: string; lyrics: string; hints?: string } {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Song folder not found: ${dir}`);
  const links = readLinks(dir);
  const files = readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(path.join(dir, f)).isFile());
  const has = (name: string | undefined) => !!name && files.includes(name);
  const other = new Set([links.vocals, links.backingVocals, ...(links.notUsed ?? [])].filter((n): n is string => !!n));
  const audio = files.filter((f) => /\.(wav|mp3)$/i.test(f) && !STEM_FILE.test(f) && !other.has(f)); // the vocal stems are not the song
  const notStems = audio.length > 1 ? audio.filter((f) => !STEM_NAME.test(f)) : audio; // "… (Lead Vocal).wav" is not the song
  const song = has(links.song) ? links.song : (audio.find((f) => /^song\.(wav|mp3)$/i.test(f)) ?? (notStems.length === 1 ? notStems[0] : undefined));
  if (!song) {
    throw new Error(audio.length ? `${dir} has several audio files (${audio.join(", ")}); add the song in the studio (+ New song) so it knows which one is the song.` : `No song (WAV or MP3) in ${dir}`);
  }
  const texts = files.filter((f) => /\.txt$/i.test(f) && !RESERVED_TXT.test(f) && !other.has(f));
  const lyrics = has(links.lyrics) ? links.lyrics : (texts.find((f) => f.toLowerCase() === "lyrics.txt") ?? (texts.length === 1 ? texts[0] : undefined));
  if (!lyrics) throw new Error(texts.length ? `${dir} has several text files (${texts.join(", ")}); add the song in the studio (+ New song) so it knows which one has the lyrics.` : `No lyrics (.txt) in ${dir}`);
  const hints = files.find((f) => f.toLowerCase() === "hints.lrc");
  return { song: path.join(dir, song!), lyrics: path.join(dir, lyrics!), ...(hints ? { hints: path.join(dir, hints) } : {}) };
}

// Shared collections: the folders in WORKSPACE_DIR\collections (and in the old clips\ until migrated).
export function sharedCollections(ws: Workspace): string[] {
  const names = new Set<string>();
  for (const dir of [COLLECTIONS_DIR, "clips"]) {
    const abs = absPath(ws, dir);
    // collections\_removed\ holds deleted collections (Restore brings them back): not a collection itself.
    if (existsSync(abs)) for (const d of readdirSync(abs, { withFileTypes: true })) if (d.isDirectory() && d.name !== REMOVED_COLLECTIONS_DIR) names.add(d.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

