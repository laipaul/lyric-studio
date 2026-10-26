// "pnpm songs:migrate" (Step 6.2c): the songs made before song folders move from
// WORKSPACE_DIR\projects\<id>\ to WORKSPACE_DIR\songs\<artist>\<title>\, and shared collections from
// WORKSPACE_DIR\clips\<name>\ to WORKSPACE_DIR\collections\<name>\.
//   pnpm songs:migrate           a dry run: prints what would move, changes nothing
//   pnpm songs:migrate --apply   moves (a light backup first: the database, the JSON files, a journal)
//   pnpm songs:migrate --undo    puts everything back as it was before the last --apply
// Nothing is deleted: files are moved (same drive), the database paths follow, and every move is
// recorded in WORKSPACE_DIR\.studio\moved-paths.json so old manifests still re-render.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, makeRun, openWorkspace, project as projectTable, videoMark, type Project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { processAlive } from "./jobs";
import { recipeJson, type SongRecipe } from "./recipe";
import { keepReplaced } from "./project-settings";
import { COLLECTIONS_DIR, SONGS_DIR, holdsNoFiles, movesSince, resolveMoved, moveEntry, readMoves, relocatePaths, removeEmptyDirs, songBusy, songFolderFor, STUDIO_DIR, writeMoves } from "./song-folder";

export const MIGRATIONS_DIR = "migrations"; // WORKSPACE_DIR\migrations\<date>\: backups and journals
export const BACKUP_REMINDER = "Make sure your regular backup is recent before continuing (y/n)";

export type PlannedMove = { from: string; to: string; what: string }; // workspace-relative
export type PlannedSong = {
  projectId: string;
  title: string;
  artist: string;
  from: string; // projects/<id>
  staging: string; // songs/.migrating-<id>: the song is built here, then renamed once
  to: string; // songs/<artist>/<title>
  resumed: boolean; // an interrupted run had started it
  moves: PlannedMove[];
  creates: string[]; // files written into the song folder (lyrics.txt, hints.lrc, song.json)
};
// One song split over two folders (by an interrupted migration before this fix): `from` is merged
// into `to` (the plain name), nothing overwritten (a name clash keeps both).
export type PlannedMerge = { projectId: string; title: string; from: string; to: string; moves: PlannedMove[]; marks: number; runs: number };
// A piece of a migrated song folder that is missing and can be made from what the song has.
export type PlannedRepair = { projectId: string; title: string; folder: string; kind: "lyrics" | "hints" | "recipe"; file: string; source: string; recipe?: SongRecipe };
export type MigrationPlan = {
  songs: PlannedSong[];
  collections: PlannedMove[];
  merges: PlannedMerge[];
  renames: PlannedMove[]; // song folders that got " (2)" because the name was taken, now free again
  lyricsFixes: { title: string; file: string; from: string }[]; // lyrics.txt written by an earlier migration from the wrong copy
  repairs: PlannedRepair[];
  emptyRecipes: { title: string; folder: string | null; reason: string }[]; // song.json without settings, and why
  problems: string[]; // things that stop --apply
  notes: string[]; // left as they are
};

const STAGING_PREFIX = ".migrating-";
const stagingFor = (projectId: string) => `${SONGS_DIR}/${STAGING_PREFIX}${projectId}`;
const win = (rel: string) => rel.split("/").join("\\");

// A folder Lyric Studio made: it has the tool's .studio\ or a song.json.
export function madeByLyricStudio(dir: string): boolean {
  return existsSync(path.join(dir, STUDIO_DIR)) || existsSync(path.join(dir, "song.json"));
}

// ---- the plan (the dry run) ------------------------------------------------------------------------

export function planMigration(ws: Workspace): MigrationPlan {
  const plan: MigrationPlan = { songs: [], collections: [], merges: [], renames: [], lyricsFixes: [], repairs: [], emptyRecipes: [], problems: [], notes: [] };
  const projects = ws.db.select().from(projectTable).all().sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  const owner = (rel: string) => projects.find((p) => p.folder === rel);

  // Collections: clips\<name>\ -> collections\<name>\.
  const clipsDir = absPath(ws, "clips");
  if (existsSync(clipsDir)) {
    for (const d of readdirSync(clipsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const to = `${COLLECTIONS_DIR}/${d.name}`;
      if (existsSync(absPath(ws, to)) && !holdsNoFiles(absPath(ws, to))) plan.problems.push(`collection ${d.name}: both clips\\${d.name} and collections\\${d.name} exist; merge them by hand first`);
      else plan.collections.push({ from: `clips/${d.name}`, to, what: `collection ${d.name}` });
    }
  }

  // Migrated songs: split over two folders -> merged; "<title> (2)" -> renamed when the name is free.
  const claimed = new Set<string>();
  for (const p of projects) {
    if (!p.folder) continue;
    claimed.add(p.folder);
    if (songBusy(ws, p.id)) continue; // tidied on a later run
    const other = splitHalf(ws, p, owner);
    if (other) {
      // Merge into the plain name: the "(2)" half moves into the other one (or the other way round).
      const plainIsOther = !/ \(\d+\)$/.test(other) || / \(\d+\)$/.test(p.folder);
      const [from, to] = plainIsOther ? [p.folder, other] : [other, p.folder];
      claimed.add(other);
      plan.merges.push({
        projectId: p.id,
        title: p.title,
        from,
        to,
        moves: mergeMoves(ws, from, to),
        marks: ws.db.select().from(videoMark).all().filter((m) => m.video.startsWith(`${p.folder}/`) || m.video.startsWith(`${other}/`)).length,
        runs: [from, to].reduce((n, f) => n + runFoldersIn(absPath(ws, `${f}/exports`)).length, 0),
      });
      continue;
    }
    if (!/ \(\d+\)$/.test(p.folder)) continue;
    const base = p.folder.replace(/ \(\d+\)$/, "");
    const preferred = songFolderFor(ws, p.artist, p.title, p.id);
    if (preferred !== p.folder && preferred === base) plan.renames.push({ from: p.folder, to: preferred, what: `"${p.title}"` });
    else if (existsSync(absPath(ws, base)) && !owner(base) && !madeByLyricStudio(absPath(ws, base))) {
      plan.notes.push(`${win(base)}\\ was not made by Lyric Studio and has files in it, so "${p.title}" is in ${win(p.folder)}\\. Move what you need from it, delete or rename it, then run pnpm songs:migrate --apply again to tidy the name.`);
    }
  }
  plan.lyricsFixes = lyricsFixes(ws).filter((f) => !plan.merges.some((m) => f.file.startsWith(`${m.from}/`) || f.file.startsWith(`${m.to}/`)));

  // Songs not migrated yet: projects\<id>\ -> (staging) -> songs\<artist>\<title>\.
  const taken = new Set<string>();
  for (const p of projects) {
    if (p.folder) continue;
    // An interrupted run of the first version of the migration may already have moved the audio
    // into the song folder: finish into that folder.
    const audioDir = p.audio_path ? path.posix.dirname(p.audio_path) : "";
    const started = /^songs\/[^/]+\/[^/]+$/.test(audioDir) && !audioDir.split("/")[1].startsWith(".") && !owner(audioDir) ? audioDir : null;
    let to = started ?? songFolderFor(ws, p.artist, p.title, p.id);
    for (let n = 2; !started && taken.has(to); n++) to = `${songFolderFor(ws, p.artist, p.title, p.id)} (${n})`;
    taken.add(to);
    claimed.add(to);
    plan.songs.push(planSong(ws, p, to));
  }

  // Missing pieces of migrated songs (after the merges above).
  for (const p of projects) {
    if (!p.folder) continue;
    const merge = plan.merges.find((m) => m.projectId === p.id);
    const folder = merge ? merge.to : p.folder;
    plan.repairs.push(...planRepairs(ws, p, folder, merge ? [merge.from] : []));
  }
  // song.json without settings of its own, and why.
  for (const p of projects) {
    const planned = plan.songs.find((x) => x.projectId === p.id);
    const merge = plan.merges.find((m) => m.projectId === p.id);
    const folder = planned?.to ?? merge?.to ?? p.folder;
    if (!folder) continue;
    const recipeFile = [folder, merge?.from].filter(Boolean).map((f) => absPath(ws, `${f}/song.json`)).find((f) => existsSync(f));
    const own = recipeFile ? Object.keys(readRecipeLoose(recipeFile)).length : 0;
    if (own) continue;
    const fix = plan.repairs.find((r) => r.projectId === p.id && r.kind === "recipe");
    if (planned && settingsCandidates(ws, p.id, [planned.from, planned.staging]).some((c) => c.values)) continue; // gets them when it moves
    const reason = fix
      ? `filled by --apply from ${fix.source}`
      : planned
        ? "not migrated yet; it had no settings of its own (EP or collection) before"
        : "no settings of its own before the migration (no EP, no remembered collection): it uses the artist's brand and the collection given with --collection or in Generate";
    plan.emptyRecipes.push({ title: p.title, folder, reason });
  }

  // Song folders no song uses, and staging folders left behind.
  const songsDir = absPath(ws, SONGS_DIR);
  if (existsSync(songsDir)) {
    for (const a of readdirSync(songsDir, { withFileTypes: true })) {
      if (!a.isDirectory()) continue;
      if (a.name.startsWith(".") && !a.name.startsWith(STAGING_PREFIX)) continue; // .adding-<id>: finished the next time that song is used
      if (a.name.startsWith(STAGING_PREFIX)) {
        const id = a.name.slice(STAGING_PREFIX.length);
        if (!plan.songs.some((x) => x.projectId === id)) plan.notes.push(`${win(`${SONGS_DIR}/${a.name}`)}\\ is left from an interrupted migration of a song that is no longer waiting; look inside and move what you need.`);
        continue;
      }
      for (const t of readdirSync(path.join(songsDir, a.name), { withFileTypes: true })) {
        const rel = `${SONGS_DIR}/${a.name}/${t.name}`;
        if (!t.isDirectory() || claimed.has(rel) || owner(rel)) continue;
        if (madeByLyricStudio(absPath(ws, rel)) || readdirSync(absPath(ws, rel)).some((f) => /^song\.(wav|mp3)$/i.test(f))) {
          plan.notes.push(`${win(rel)}\\ looks like a song folder, but no song in the Library uses it.`);
        }
      }
    }
  }

  if (ws.db.select().from(makeRun).all().some((r) => r.status === "queued" || (r.status === "running" && r.pid !== null && processAlive(r.pid)))) {
    plan.problems.push("a Generate run is queued or rendering; wait until the Tasks menu is empty");
  }
  for (const s of plan.songs) if (songBusy(ws, s.projectId)) plan.problems.push(`"${s.title}" is being rendered right now`);
  return plan;
}

// The other half of a song split over two folders, or null: the folder its song file is in (when that
// is not its own folder), or its plain-named sibling ("<title>" for "<title> (2)") that Lyric Studio
// made and no song uses.
function splitHalf(ws: Workspace, p: Project, owner: (rel: string) => Project | undefined): string | null {
  const folder = p.folder!;
  const audioDir = p.audio_path ? path.posix.dirname(p.audio_path) : "";
  if (/^songs\/[^/]+\/[^/]+$/.test(audioDir) && audioDir !== folder && !owner(audioDir) && existsSync(absPath(ws, audioDir))) return audioDir;
  const base = folder.replace(/ \(\d+\)$/, "");
  if (base !== folder && existsSync(absPath(ws, base)) && !owner(base) && madeByLyricStudio(absPath(ws, base))) return base;
  return null;
}

// The moves that merge folder `from` into `to`: whatever is not in `to` moves over; folders in both
// are merged inside; a file with the same name keeps both ("name (from <folder>).ext").
function mergeMoves(ws: Workspace, from: string, to: string): PlannedMove[] {
  const moves: PlannedMove[] = [];
  const label = path.posix.basename(from);
  const walk = (f: string, t: string) => {
    for (const e of readdirSync(absPath(ws, f), { withFileTypes: true })) {
      const src = `${f}/${e.name}`;
      const dst = `${t}/${e.name}`;
      const target = absPath(ws, dst);
      if (!existsSync(target) || holdsNoFiles(target)) moves.push({ from: src, to: dst, what: e.isDirectory() ? "folder" : "file" });
      else if (e.isDirectory() && statSync(target).isDirectory()) walk(src, dst);
      else {
        const ext = path.posix.extname(e.name);
        const stem = e.name.slice(0, e.name.length - ext.length);
        let alt = `${t}/${stem} (from ${label})${ext}`;
        for (let n = 2; existsSync(absPath(ws, alt)); n++) alt = `${t}/${stem} (from ${label}) ${n}${ext}`;
        moves.push({ from: src, to: alt, what: "same name in both: both kept" });
      }
    }
  };
  walk(from, to);
  return moves;
}

const runFoldersIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(d)) : []);

function planSong(ws: Workspace, p: Project, to: string): PlannedSong {
  const from = `projects/${p.id}`;
  const staging = stagingFor(p.id);
  const moves: PlannedMove[] = [];
  const has = (rel: string) => existsSync(absPath(ws, rel));
  const inside = (rel: string | null) => !!rel && rel.startsWith(`${from}/`) && has(rel);
  const used = new Set<string>();
  if (inside(p.audio_path)) {
    moves.push({ from: p.audio_path!, to: `${staging}/song${path.extname(p.audio_path!).toLowerCase()}`, what: "the song" });
    used.add(p.audio_path!);
  }
  if (inside(p.cover_path)) {
    moves.push({ from: p.cover_path!, to: `${staging}/cover${path.extname(p.cover_path!).toLowerCase()}`, what: "the cover" });
    used.add(p.cover_path!);
  }
  if (has(`${from}/lyrics`)) moves.push({ from: `${from}/lyrics`, to: `${staging}/${STUDIO_DIR}/lyrics`, what: "alignments, stored hints and lyrics copies" });
  if (has(`${from}/exports`)) moves.push({ from: `${from}/exports`, to: `${staging}/exports`, what: "the videos" });
  if (has(`${from}/settings.json`)) moves.push({ from: `${from}/settings.json`, to: `${staging}/${STUDIO_DIR}/settings.json`, what: "settings" });
  // Anything else of the old folder (e.g. a replaced cover) is kept in .studio\project-files\.
  const root = absPath(ws, from);
  if (existsSync(root)) {
    for (const top of readdirSync(root)) {
      if (["lyrics", "exports", "settings.json"].includes(top)) continue;
      const sub = `${from}/${top}`;
      const entries = statSync(absPath(ws, sub)).isDirectory() ? readdirSync(absPath(ws, sub)).map((e) => `${sub}/${e}`) : [sub];
      for (const e of entries) if (!used.has(e)) moves.push({ from: e, to: `${staging}/${STUDIO_DIR}/project-files/${e.slice(from.length + 1)}`, what: "kept" });
    }
  }
  const stores = [`${from}/lyrics`, `${staging}/${STUDIO_DIR}/lyrics`, `${to}/${STUDIO_DIR}/lyrics`].map((r) => absPath(ws, r));
  const creates = [`${to}/lyrics.txt`, `${to}/song.json`];
  if (stores.some((d) => storedHintIn(d))) creates.push(`${to}/hints.lrc`);
  return { projectId: p.id, title: p.title, artist: p.artist, from, staging, to, resumed: has(staging), moves, creates };
}

// The stored hints in a lyrics store (hint.json -> its copy).
function storedHintIn(dir: string): string | null {
  try {
    const record = JSON.parse(readFileSync(path.join(dir, "hint.json"), "utf8")) as { copy: string };
    const file = path.join(dir, record.copy);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

type OldSettings = { ep?: string; collection?: { name: string; folder?: string }; lyricsTxt?: string };

// The song's settings, newest first: its settings.json files, then the copies in migration backups.
function settingsCandidates(ws: Workspace, projectId: string, folders: string[]): { source: string; settings: OldSettings; values: SongRecipe | null }[] {
  const files = folders.flatMap((f) => [absPath(ws, `${f}/settings.json`), absPath(ws, `${f}/${STUDIO_DIR}/settings.json`)]);
  const backups = path.join(ws.dir, MIGRATIONS_DIR);
  if (existsSync(backups)) {
    for (const d of readdirSync(backups).sort().reverse()) files.push(path.join(backups, d, "projects", projectId, "settings.json"));
  }
  return files
    .filter((f) => existsSync(f))
    .map((f) => {
      const settings = readJson(f) as OldSettings;
      const values: SongRecipe = {};
      if (settings.ep) values.ep = settings.ep;
      if (settings.collection?.name) values.collections = [settings.collection.name];
      return { source: win(path.relative(ws.dir, f).split(path.sep).join("/")), settings, values: Object.keys(values).length ? values : null };
    });
}

function readRecipeLoose(file: string): SongRecipe {
  const raw = readJson(file);
  delete raw._help;
  return raw as SongRecipe;
}

// What a migrated song folder misses and can get back: lyrics.txt (the lyrics of its newest video),
// hints.lrc (its stored hints), song.json settings (from its settings or a migration backup).
function planRepairs(ws: Workspace, p: Project, folder: string, extra: string[]): PlannedRepair[] {
  const out: PlannedRepair[] = [];
  const all = [folder, ...extra];
  const stores = all.map((f) => absPath(ws, `${f}/${STUDIO_DIR}/lyrics`));
  const exportsDirs = all.map((f) => absPath(ws, `${f}/exports`));
  const base = { projectId: p.id, title: p.title, folder };
  if (all.every((f) => !existsSync(absPath(ws, `${f}/lyrics.txt`)))) {
    const newest = newestVideoLyricsIn(exportsDirs, stores);
    if (newest) out.push({ ...base, kind: "lyrics", file: `${folder}/lyrics.txt`, source: newest.file });
  }
  if (all.every((f) => !existsSync(absPath(ws, `${f}/hints.lrc`)))) {
    const hint = stores.map((d) => storedHintIn(d)).find(Boolean);
    if (hint) out.push({ ...base, kind: "hints", file: `${folder}/hints.lrc`, source: hint });
  }
  const recipeFile = all.map((f) => absPath(ws, `${f}/song.json`)).find((f) => existsSync(f));
  if (!recipeFile || !Object.keys(readRecipeLoose(recipeFile)).length) {
    const found = settingsCandidates(ws, p.id, all).find((c) => c.values);
    if (found) out.push({ ...base, kind: "recipe", file: `${folder}/song.json`, source: found.source, recipe: found.values! });
  }
  return out;
}

// The lyrics.txt an old project uses: the lyrics its newest video was made with (its manifest names
// them); a lyrics.txt given later in the studio ("+ New song") wins when it is newer than that video;
// else the newest copy.
function songLyrics(ws: Workspace, exportsDirs: string[], stores: string[], settings: OldSettings): Buffer | null {
  const newest = newestVideoLyricsIn(exportsDirs, stores);
  const given = settings.lyricsTxt ? absPath(ws, resolveMoved(readMoves(ws.dir), settings.lyricsTxt)) : null;
  if (given && existsSync(given) && (!newest || statSync(given).mtimeMs > newest.madeAt)) return readFileSync(given);
  if (newest) return readFileSync(newest.file);
  const copies = stores
    .filter((d) => existsSync(d))
    .flatMap((d) => readdirSync(d).filter((f) => /^lyrics(-[0-9a-f]{12})?\.txt$/.test(f)).map((f) => path.join(d, f)))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return copies.length ? readFileSync(copies[0]) : null;
}

// The stored copy of the lyrics.txt the newest video of a song was made with (from its manifest's
// lyrics.txt_sha256), or null.
export function newestVideoLyrics(exportsDir: string, storeDir: string, before = Infinity): { file: string; madeAt: number } | null {
  return newestVideoLyricsIn([exportsDir], [storeDir], before);
}

function newestVideoLyricsIn(exportsDirs: string[], storeDirs: string[], before = Infinity): { file: string; madeAt: number } | null {
  const manifests = exportsDirs
    .flatMap((exportsDir) =>
      runFoldersIn(exportsDir).flatMap((run) => {
        const dir = path.join(exportsDir, run);
        return [dir, ...readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name))];
      }),
    )
    .flatMap((d) => readdirSync(d).filter((f) => /^v\d+\.manifest\.json$/.test(f)).map((f) => path.join(d, f)))
    .map((f) => readJson(f) as { created_at?: string; lyrics?: { txt_sha256?: string } })
    .filter((m) => m.lyrics?.txt_sha256 && (Date.parse(m.created_at ?? "") || 0) < before)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const m of manifests) {
    for (const store of storeDirs) {
      const file = path.join(store, `lyrics-${m.lyrics!.txt_sha256!.slice(0, 12)}.txt`);
      if (existsSync(file)) return { file, madeAt: Date.parse(m.created_at ?? "") || 0 };
    }
  }
  return null;
}

// Earlier migrations wrote lyrics.txt from the newest lyrics copy, which is not always the version the
// newest video used. A lyrics.txt that no one changed since the migration wrote it, and that differs
// from the lyrics of the song's newest video made before that migration, is put right.
function lyricsFixes(ws: Workspace): MigrationPlan["lyricsFixes"] {
  const fixes: MigrationPlan["lyricsFixes"] = [];
  const base = path.join(ws.dir, MIGRATIONS_DIR);
  if (!existsSync(base)) return fixes;
  for (const d of readdirSync(base)) {
    const journal = readJson(path.join(base, d, "journal.json")) as unknown as Journal;
    if (!journal.steps || journal.undone_at || !journal.finished_at) continue;
    const since = movesSince(readMoves(ws.dir), journal.finished_at);
    for (const step of journal.steps) {
      if (step.op !== "create" || !step.file.endsWith("/lyrics.txt")) continue;
      const rel = resolveMoved(since, step.file);
      const file = absPath(ws, rel);
      if (!existsSync(file) || statSync(file).mtimeMs > Date.parse(journal.finished_at) + 5000) continue; // changed since: the user's
      const folder = rel.slice(0, -"/lyrics.txt".length);
      const p = ws.db.select().from(projectTable).where(eq(projectTable.folder, folder)).get();
      if (!p) continue;
      const newest = newestVideoLyrics(absPath(ws, `${folder}/exports`), absPath(ws, `${folder}/${STUDIO_DIR}/lyrics`), Date.parse(journal.started_at));
      if (newest && !readFileSync(newest.file).equals(readFileSync(file))) fixes.push({ title: p.title, file: rel, from: newest.file });
    }
  }
  return fixes;
}

const nothingToDo = (plan: MigrationPlan) =>
  !plan.songs.length && !plan.collections.length && !plan.merges.length && !plan.renames.length && !plan.lyricsFixes.length && !plan.repairs.length;
export const hasWork = (plan: MigrationPlan) => !nothingToDo(plan);

export function migrationText(plan: MigrationPlan): string[] {
  const out: string[] = [];
  if (nothingToDo(plan)) out.push("Nothing to migrate: every song has its own folder in songs\\ and collections are in collections\\.");
  for (const c of plan.collections) out.push(`Collection: ${win(c.from)}\\  ->  ${win(c.to)}\\`);
  for (const m of plan.merges) {
    out.push(`Split song "${m.title}": ${win(m.from)}\\ is merged into ${win(m.to)}\\ (${m.runs} export run${m.runs === 1 ? "" : "s"}, ${m.marks} mark${m.marks === 1 ? "" : "s"} follow)`);
    for (const mv of m.moves) out.push(`    ${win(mv.from.slice(m.from.length + 1))}  ->  ${win(mv.to.slice(m.to.length + 1))}${mv.what.startsWith("same name") ? `  (${mv.what})` : ""}`);
  }
  for (const r of plan.renames) out.push(`Rename ${r.what}: ${win(r.from)}\\  ->  ${win(r.to)}\\`);
  for (const f of plan.lyricsFixes) out.push(`Lyrics "${f.title}": ${win(f.file)} gets the lyrics of its newest video (${path.basename(f.from)}); the current one is kept in .studio\\replaced\\`);
  for (const s of plan.songs) {
    out.push(`Song "${s.title}" (${s.artist}): ${win(s.from)}\\  ->  ${win(s.to)}\\${s.resumed ? "  (finishing an interrupted migration)" : ""}`);
    for (const m of s.moves) out.push(`    ${win(m.from.slice(s.from.length + 1))}  ->  ${win(m.to.slice(s.staging.length + 1))}  (${m.what})`);
    for (const c of s.creates) out.push(`    new: ${path.basename(c)}`);
  }
  for (const r of plan.repairs) {
    const what = r.kind === "lyrics" ? `lyrics.txt from the lyrics of its newest video (${path.basename(r.source)})` : r.kind === "hints" ? `hints.lrc from its stored hints (${path.basename(r.source)})` : `song.json gets ${Object.keys(r.recipe ?? {}).join(" and ")} from ${r.source}`;
    out.push(`Repair "${r.title}": ${what}`);
  }
  if (plan.emptyRecipes.length) {
    out.push("song.json without settings of its own:");
    for (const e of plan.emptyRecipes) out.push(`    "${e.title}"${e.folder ? ` (${win(e.folder)}\\)` : ""}: ${e.reason}`);
  }
  for (const n of plan.notes) out.push(`Note: ${n}`);
  for (const p of plan.problems) out.push(`Cannot migrate now: ${p}`);
  return out;
}

// ---- --apply ---------------------------------------------------------------------------------------

type JournalStep =
  | { op: "move"; from: string; to: string }
  | { op: "create"; file: string }
  | { op: "mkdir"; dir: string }
  | { op: "replace"; file: string; kept: string }; // file's earlier content is in `kept` (workspace-relative)
export type Journal = {
  version: 1;
  started_at: string;
  finished_at: string | null;
  undone_at: string | null;
  had_moves_file: boolean;
  steps: JournalStep[];
};

const stampOf = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export type MigrationResult = { backupDir: string; songs: number; collections: number; merges: number; renames: number; repairs: number; lines: string[] };

export async function applyMigration(
  ws: Workspace,
  options: { log?: (m: string) => void; now?: Date; failAfter?: (step: JournalStep) => boolean } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  const plan = planMigration(ws);
  if (plan.problems.length) throw new Error(`Cannot migrate now:\n  - ${plan.problems.join("\n  - ")}`);
  const result = { songs: plan.songs.length, collections: plan.collections.length, merges: plan.merges.length, renames: plan.renames.length, repairs: plan.repairs.length, lines: migrationText(plan) };
  if (nothingToDo(plan)) return { backupDir: "", ...result };

  // The light backup: the database, every settings.json and the move log, plus the journal of this run.
  const now = options.now ?? new Date();
  let backupDir = path.join(ws.dir, MIGRATIONS_DIR, stampOf(now));
  for (let n = 2; existsSync(backupDir); n++) backupDir = path.join(ws.dir, MIGRATIONS_DIR, `${stampOf(now)}-${n}`);
  mkdirSync(backupDir, { recursive: true });
  await ws.db.$client.backup(path.join(backupDir, "studio.db"));
  const movesFile = path.join(ws.dir, STUDIO_DIR, "moved-paths.json");
  const hadMoves = existsSync(movesFile);
  if (hadMoves) copyFileSync(movesFile, path.join(backupDir, "moved-paths.json"));
  for (const s of plan.songs) {
    const settings = absPath(ws, `${s.from}/settings.json`);
    if (existsSync(settings)) {
      mkdirSync(path.join(backupDir, "projects", s.projectId), { recursive: true });
      copyFileSync(settings, path.join(backupDir, "projects", s.projectId, "settings.json"));
    }
  }
  const journal: Journal = { version: 1, started_at: now.toISOString(), finished_at: null, undone_at: null, had_moves_file: hadMoves, steps: [] };
  const journalFile = path.join(backupDir, "journal.json");
  const record = (step: JournalStep) => {
    journal.steps.push(step);
    writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    if (options.failAfter?.(step)) throw new Error("stopped by a test"); // tests: an interrupted run
  };
  writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
  log(`backup: ${backupDir}`);

  const move = (from: string, to: string) => {
    moveEntry(absPath(ws, from), absPath(ws, to));
    relocatePaths(ws, from, to);
    record({ op: "move", from, to });
  };
  const write = (rel: string, content: string | Buffer) => {
    const file = absPath(ws, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file)) {
      const kept = keepReplaced(path.dirname(file), file, true);
      writeFileSync(file, content);
      record({ op: "replace", file: rel, kept: path.relative(ws.dir, kept).split(path.sep).join("/") });
    } else {
      writeFileSync(file, content);
      record({ op: "create", file: rel });
    }
  };

  try {
    migrateAll();
  } catch (error) {
    throw new Error(
      `The migration stopped: ${(error as Error).message}\n` +
        "Nothing is lost and no song is split: run pnpm songs:migrate --apply again to finish (close any program that uses these files first, " +
        "e.g. a video player or Explorer in that folder), or pnpm songs:migrate --undo (with Lyric Studio stopped) to put everything back.",
    );
  }
  journal.finished_at = new Date().toISOString();
  writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
  return { backupDir, ...result };

  function migrateAll() {
    for (const c of plan.collections) {
      move(c.from, c.to);
      log(`moved ${win(c.from)}\\ -> ${win(c.to)}\\`);
    }
    for (const m of plan.merges) {
      for (const mv of mergeMoves(ws, m.from, m.to)) move(mv.from, mv.to); // planned again: the folders are as they are now
      ws.db.update(projectTable).set({ folder: m.to }).where(eq(projectTable.id, m.projectId)).run();
      record({ op: "mkdir", dir: m.from });
      if (existsSync(absPath(ws, m.from)) && holdsNoFiles(absPath(ws, m.from))) rmSync(absPath(ws, m.from), { recursive: true });
      log(`merged "${m.title}": ${win(m.from)}\\ -> ${win(m.to)}\\`);
    }
    for (const f of plan.lyricsFixes) {
      write(f.file, readFileSync(f.from)); // before the renames below
      log(`lyrics.txt of "${f.title}" now holds the lyrics of its newest video`);
    }
    for (const r of plan.renames) {
      move(r.from, r.to);
      removeEmptyDirs(path.dirname(absPath(ws, r.from)), absPath(ws, SONGS_DIR));
      log(`renamed ${r.what}: ${win(r.from)}\\ -> ${win(r.to)}\\`);
    }
    for (const s of plan.songs) migrateSong(s);
    // Missing pieces, as the folders are now.
    for (const p of ws.db.select().from(projectTable).all()) {
      if (!p.folder) continue;
      for (const r of planRepairs(ws, p, p.folder, [])) {
        if (r.kind === "recipe") {
          const file = absPath(ws, r.file);
          const current = existsSync(file) ? readRecipeLoose(file) : {};
          write(r.file, recipeJson({ ...current, ...r.recipe }));
        } else write(r.file, readFileSync(r.source));
        log(`repaired "${r.title}": ${path.basename(r.file)}`);
      }
    }
    for (const dir of ["projects", "clips"]) removeEmptyDirs(absPath(ws, dir), ws.dir);
  }

  // One song: everything moves into its staging folder, which becomes the song folder in one rename
  // (merged into it when an earlier interrupted run left files there). The database names the folder
  // only then, so an interrupted run never leaves a song split: the next --apply finishes it.
  function migrateSong(s: PlannedSong) {
    record({ op: "mkdir", dir: s.staging });
    mkdirSync(absPath(ws, `${s.staging}/clips`), { recursive: true });
    mkdirSync(absPath(ws, `${s.staging}/exports`), { recursive: true });
    for (const m of s.moves) move(m.from, m.to);
    const target = absPath(ws, s.to);
    if (!existsSync(target) || holdsNoFiles(target)) move(s.staging, s.to);
    else {
      for (const mv of mergeMoves(ws, s.staging, s.to)) move(mv.from, mv.to);
      if (holdsNoFiles(absPath(ws, s.staging))) rmSync(absPath(ws, s.staging), { recursive: true });
    }
    ws.db.update(projectTable).set({ folder: s.to }).where(eq(projectTable.id, s.projectId)).run();

    const stores = [absPath(ws, `${s.to}/${STUDIO_DIR}/lyrics`)];
    const settingsFile = absPath(ws, `${s.to}/${STUDIO_DIR}/settings.json`);
    const settings = readJson(settingsFile) as OldSettings;
    const lyrics = songLyrics(ws, [absPath(ws, `${s.to}/exports`)], stores, settings);
    if (lyrics && !existsSync(absPath(ws, `${s.to}/lyrics.txt`))) write(`${s.to}/lyrics.txt`, lyrics);
    const hint = storedHintIn(stores[0]);
    if (hint && !existsSync(absPath(ws, `${s.to}/hints.lrc`))) write(`${s.to}/hints.lrc`, readFileSync(hint));
    if (!existsSync(absPath(ws, `${s.to}/song.json`))) {
      const values = settingsCandidates(ws, s.projectId, [s.to]).find((c) => c.values)?.values ?? {};
      write(`${s.to}/song.json`, recipeJson(values));
    }
    // The tool's settings now point into the song folder (the remembered collection's old clips\ folder too).
    if (existsSync(settingsFile)) {
      const next = { ...settings };
      if (lyrics) next.lyricsTxt = `${s.to}/lyrics.txt`;
      const folder = next.collection?.folder?.replace(/\\/g, "/");
      const oldClips = absPath(ws, "clips").replace(/\\/g, "/");
      if (folder && next.collection && (folder === oldClips || folder.startsWith(`${oldClips}/`))) {
        next.collection = { ...next.collection, folder: absPath(ws, COLLECTIONS_DIR + folder.slice(oldClips.length)) };
      }
      writeFileSync(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
    }
    removeEmptyDirs(absPath(ws, `${s.from}/audio`), absPath(ws, "projects"));
    removeEmptyDirs(absPath(ws, s.from), absPath(ws, "projects"));
    log(`moved "${s.title}": ${win(s.from)}\\ -> ${win(s.to)}\\`);
  }
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---- --undo ----------------------------------------------------------------------------------------

export function latestMigration(workspaceDir: string): { dir: string; journal: Journal } | null {
  const base = path.join(workspaceDir, MIGRATIONS_DIR);
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base)
    .filter((d) => existsSync(path.join(base, d, "journal.json")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const d of dirs.reverse()) {
    const journal = JSON.parse(readFileSync(path.join(base, d, "journal.json"), "utf8")) as Journal;
    if (!journal.undone_at) return { dir: path.join(base, d), journal };
  }
  return null;
}

// Puts the files back, restores the database and the move log from the backup. Lyric Studio must be
// stopped (the database file is replaced). Files the migration wrote are moved into the backup folder.
export function undoMigration(workspaceDir: string, options: { log?: (m: string) => void } = {}): { dir: string; steps: number } {
  const log = options.log ?? (() => {});
  const last = latestMigration(workspaceDir);
  if (!last) throw new Error("Nothing to undo: no migration in WORKSPACE_DIR\\migrations.");
  const ws = openWorkspace(workspaceDir);
  try {
    if (
      ws.db
        .select()
        .from(makeRun)
        .all()
        .some((r) => r.status === "running" && r.pid !== null && processAlive(r.pid))
    ) {
      throw new Error("A Generate run is rendering; wait until it has finished.");
    }
  } finally {
    ws.close();
  }
  const abs = (rel: string) => path.join(workspaceDir, ...rel.split("/"));
  const steps = [...last.journal.steps].reverse();
  for (const s of steps) {
    if (s.op === "replace") {
      if (existsSync(abs(s.kept))) {
        copyFileSync(abs(s.kept), abs(s.file));
        const keep = path.join(last.dir, "undone", ...s.kept.split("/"));
        mkdirSync(path.dirname(keep), { recursive: true });
        renameSync(abs(s.kept), keep);
        removeEmptyDirs(path.dirname(abs(s.kept)), path.join(workspaceDir, "songs"));
      }
    } else if (s.op === "move") {
      if (!existsSync(abs(s.to))) throw new Error(`Cannot undo: ${abs(s.to)} is missing (moved or renamed since the migration?).`);
      mkdirSync(path.dirname(abs(s.from)), { recursive: true });
      renameSync(abs(s.to), abs(s.from));
      removeEmptyDirs(path.dirname(abs(s.to)), path.join(workspaceDir, SONGS_DIR)); // e.g. the artist folder, when empty now
      log(`back: ${win(s.to)} -> ${win(s.from)}`);
    } else if (s.op === "create") {
      if (!existsSync(abs(s.file))) continue;
      const keep = path.join(last.dir, "undone", ...s.file.split("/"));
      mkdirSync(path.dirname(keep), { recursive: true });
      renameSync(abs(s.file), keep);
    } else if (existsSync(abs(s.dir))) {
      pruneEmpty(abs(s.dir));
      removeEmptyDirs(path.dirname(abs(s.dir)), path.join(workspaceDir, "songs")); // the artist folder too, when empty
    }
  }
  // The database and the move log as they were before.
  const db = path.join(workspaceDir, "studio.db");
  for (const extra of ["-wal", "-shm"]) if (existsSync(db + extra)) rmSync(db + extra);
  copyFileSync(path.join(last.dir, "studio.db"), db);
  const movesFile = path.join(workspaceDir, STUDIO_DIR, "moved-paths.json");
  if (last.journal.had_moves_file) copyFileSync(path.join(last.dir, "moved-paths.json"), movesFile);
  else if (existsSync(movesFile)) renameSync(movesFile, path.join(last.dir, "moved-paths.after.json"));
  // The settings files as they were (they were rewritten in the song folders).
  const backupProjects = path.join(last.dir, "projects");
  if (existsSync(backupProjects)) {
    for (const id of readdirSync(backupProjects)) {
      const target = path.join(workspaceDir, "projects", id, "settings.json");
      if (existsSync(path.dirname(target))) copyFileSync(path.join(backupProjects, id, "settings.json"), target);
    }
  }
  last.journal.undone_at = new Date().toISOString();
  writeFileSync(path.join(last.dir, "journal.json"), `${JSON.stringify(last.journal, null, 2)}\n`);
  return { dir: last.dir, steps: steps.length };
}

// Removes the empty folders inside `dir` (and `dir` itself when it ends up empty).
function pruneEmpty(dir: string): void {
  for (const d of readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) pruneEmpty(path.join(dir, d.name));
  if (!readdirSync(dir).length) rmdirSync(dir);
}

// For the studio's banner: songs and collections still in the old layout, and migrated songs that
// need tidying (split over two folders, "(2)" names, missing lyrics.txt / hints.lrc / settings).
export function migrationStatus(ws: Workspace): { songs: number; collections: number; tidy: number } {
  const plan = planMigration(ws);
  const tidy = new Set([...plan.merges.map((m) => m.projectId), ...plan.repairs.map((r) => r.projectId), ...plan.renames.map((r) => r.what), ...plan.lyricsFixes.map((f) => f.file)]);
  return { songs: plan.songs.length, collections: plan.collections.length, tidy: tidy.size };
}

export { readMoves, writeMoves };
