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

import { absPath, makeRun, openWorkspace, project as projectTable, type Project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { processAlive } from "./jobs";
import { writeRecipe, type SongRecipe } from "./recipe";
import { keepReplaced } from "./project-settings";
import { COLLECTIONS_DIR, holdsNoFiles, movesSince, resolveMoved, moveEntry, readMoves, relocatePaths, removeEmptyDirs, songBusy, songFolderFor, STUDIO_DIR, writeMoves } from "./song-folder";

export const MIGRATIONS_DIR = "migrations"; // WORKSPACE_DIR\migrations\<date>\: backups and journals
export const BACKUP_REMINDER = "Make sure your regular backup is recent before continuing (y/n)";

export type PlannedMove = { from: string; to: string; what: string }; // workspace-relative
export type PlannedSong = {
  projectId: string;
  title: string;
  artist: string;
  from: string; // projects/<id>
  to: string; // songs/<artist>/<title>
  moves: PlannedMove[];
  creates: string[]; // files written into the song folder (lyrics.txt, hints.lrc, song.json)
};
export type MigrationPlan = {
  songs: PlannedSong[];
  collections: PlannedMove[];
  renames: PlannedMove[]; // song folders that got " (2)" because the name was taken, now free again
  lyricsFixes: { title: string; file: string; from: string }[]; // lyrics.txt written by an earlier migration from the wrong copy
  problems: string[]; // things that stop --apply
  notes: string[]; // left as they are
};

// ---- the plan (the dry run) ------------------------------------------------------------------------

export function planMigration(ws: Workspace): MigrationPlan {
  const plan: MigrationPlan = {
    songs: [],
    collections: [],
    renames: [],
    lyricsFixes: [],
    problems: [],
    notes: [],
  };
  // Collections: clips\<name>\ -> collections\<name>\.
  const clipsDir = absPath(ws, "clips");
  if (existsSync(clipsDir)) {
    for (const d of readdirSync(clipsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const to = `${COLLECTIONS_DIR}/${d.name}`;
      if (existsSync(absPath(ws, to)) && !holdsNoFiles(absPath(ws, to))) plan.problems.push(`collection ${d.name}: both clips\\${d.name} and collections\\${d.name} exist; merge them by hand first`);
      else
        plan.collections.push({
          from: `clips/${d.name}`,
          to,
          what: `collection ${d.name}`,
        });
    }
  }
  // Song folders named "<title> (2)" because "<title>" was taken (e.g. a folder made by hand): renamed
  // when that name is free (or holds no files); a folder with files is never touched, only named.
  for (const p of ws.db.select().from(projectTable).all()) {
    if (!p.folder || !/ \(\d+\)$/.test(p.folder)) continue;
    if (songBusy(ws, p.id)) continue; // renamed on a later run
    const base = p.folder.replace(/ \(\d+\)$/, "");
    const preferred = songFolderFor(ws, p.artist, p.title, p.id);
    if (preferred !== p.folder && preferred === base) plan.renames.push({ from: p.folder, to: preferred, what: `"${p.title}"` });
    else if (existsSync(absPath(ws, base)) && !ws.db.select({ id: projectTable.id }).from(projectTable).where(eq(projectTable.folder, base)).get()) {
      plan.notes.push(`${win(base)}\\ was not made by Lyric Studio and has files in it, so "${p.title}" is in ${win(p.folder)}\\. Move what you need from it, delete or rename it, then run pnpm songs:migrate --apply again to tidy the name.`);
    }
  }
  plan.lyricsFixes = lyricsFixes(ws);
  // Songs: projects\<id>\ -> songs\<artist>\<title>\.
  const taken = new Set<string>();
  for (const p of ws.db
    .select()
    .from(projectTable)
    .all()
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
    if (p.folder) continue;
    const from = `projects/${p.id}`;
    let to = songFolderFor(ws, p.artist, p.title, p.id);
    for (let n = 2; taken.has(to); n++) to = `${songFolderFor(ws, p.artist, p.title, p.id)} (${n})`;
    taken.add(to);
    plan.songs.push(planSong(ws, p, from, to));
  }
  if (
    ws.db
      .select()
      .from(makeRun)
      .all()
      .some((r) => r.status === "queued" || (r.status === "running" && r.pid !== null && processAlive(r.pid)))
  ) {
    plan.problems.push("a Generate run is queued or rendering; wait until the Tasks menu is empty");
  }
  for (const s of plan.songs) if (songBusy(ws, s.projectId)) plan.problems.push(`"${s.title}" is being rendered right now`);
  return plan;
}

function planSong(ws: Workspace, p: Project, from: string, to: string): PlannedSong {
  const moves: PlannedMove[] = [];
  const has = (rel: string) => existsSync(absPath(ws, rel));
  const inside = (rel: string | null) => !!rel && rel.startsWith(`${from}/`) && has(rel);
  const used = new Set<string>();
  if (inside(p.audio_path)) {
    moves.push({
      from: p.audio_path!,
      to: `${to}/song${path.extname(p.audio_path!).toLowerCase()}`,
      what: "the song",
    });
    used.add(p.audio_path!);
  }
  if (inside(p.cover_path)) {
    moves.push({
      from: p.cover_path!,
      to: `${to}/cover${path.extname(p.cover_path!).toLowerCase()}`,
      what: "the cover",
    });
    used.add(p.cover_path!);
  }
  if (has(`${from}/lyrics`))
    moves.push({
      from: `${from}/lyrics`,
      to: `${to}/${STUDIO_DIR}/lyrics`,
      what: "alignments, stored hints and lyrics copies",
    });
  if (has(`${from}/exports`))
    moves.push({
      from: `${from}/exports`,
      to: `${to}/exports`,
      what: "the videos",
    });
  if (has(`${from}/settings.json`))
    moves.push({
      from: `${from}/settings.json`,
      to: `${to}/${STUDIO_DIR}/settings.json`,
      what: "settings",
    });
  // Anything else of the old folder (e.g. a replaced cover) is kept in .studio\project-files\.
  const root = absPath(ws, from);
  if (existsSync(root)) {
    for (const top of readdirSync(root)) {
      if (["lyrics", "exports", "settings.json"].includes(top)) continue;
      const sub = `${from}/${top}`;
      const entries = statSync(absPath(ws, sub)).isDirectory() ? readdirSync(absPath(ws, sub)).map((e) => `${sub}/${e}`) : [sub];
      for (const e of entries)
        if (!used.has(e))
          moves.push({
            from: e,
            to: `${to}/${STUDIO_DIR}/project-files/${e.slice(from.length + 1)}`,
            what: "kept",
          });
    }
  }
  const creates = [`${to}/lyrics.txt`, `${to}/song.json`];
  if (storedHint(ws, from)) creates.push(`${to}/hints.lrc`);
  return {
    projectId: p.id,
    title: p.title,
    artist: p.artist,
    from,
    to,
    moves,
    creates,
  };
}

// The stored hints of an old project folder (projects/<id>/lyrics/hint.json -> its copy).
function storedHint(ws: Workspace, from: string): string | null {
  try {
    const record = JSON.parse(readFileSync(absPath(ws, `${from}/lyrics/hint.json`), "utf8")) as { copy: string };
    const file = absPath(ws, `${from}/lyrics/${record.copy}`);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

// The lyrics.txt an old project uses: settings.json, else the newest copy in its lyrics folder.
function legacyLyrics(ws: Workspace, from: string): Buffer | null {
  // The lyrics the newest video was made with (its manifest names them); a lyrics.txt given later in
  // the studio ("+ New song") wins when it is newer than that video.
  const newest = newestVideoLyrics(absPath(ws, `${from}/exports`), absPath(ws, `${from}/lyrics`));
  try {
    const s = JSON.parse(readFileSync(absPath(ws, `${from}/settings.json`), "utf8")) as { lyricsTxt?: string };
    const given = s.lyricsTxt ? absPath(ws, s.lyricsTxt) : null;
    if (given && existsSync(given) && (!newest || statSync(given).mtimeMs > newest.madeAt)) return readFileSync(given);
  } catch {
    // no settings
  }
  if (newest) return readFileSync(newest.file);
  const dir = absPath(ws, `${from}/lyrics`);
  if (!existsSync(dir)) return null;
  const copies = readdirSync(dir)
    .filter((f) => /^lyrics(-[0-9a-f]{12})?\.txt$/.test(f))
    .map((f) => path.join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return copies.length ? readFileSync(copies[0]) : null;
}

// The stored copy of the lyrics.txt the newest video of a song was made with (from its manifest's
// lyrics.txt_sha256), or null.
export function newestVideoLyrics(exportsDir: string, storeDir: string, before = Infinity): { file: string; madeAt: number } | null {
  if (!existsSync(exportsDir)) return null;
  const runs = readdirSync(exportsDir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(d))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const run of runs) {
    const dir = path.join(exportsDir, run);
    const manifests = [dir, ...readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name))]
      .flatMap((d) => readdirSync(d).filter((f) => /^v\d+\.manifest\.json$/.test(f)).map((f) => path.join(d, f)))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(f, "utf8")) as { created_at?: string; lyrics?: { txt_sha256?: string } };
        } catch {
          return null;
        }
      })
      .filter((m) => m?.lyrics?.txt_sha256 && (Date.parse(m.created_at ?? "") || 0) < before)
      .sort((a, b) => String(b!.created_at).localeCompare(String(a!.created_at)));
    for (const m of manifests) {
      const file = path.join(storeDir, `lyrics-${m!.lyrics!.txt_sha256!.slice(0, 12)}.txt`);
      if (existsSync(file)) return { file, madeAt: Date.parse(m!.created_at ?? "") || 0 };
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
    let journal: Journal;
    try {
      journal = JSON.parse(readFileSync(path.join(base, d, "journal.json"), "utf8")) as Journal;
    } catch {
      continue;
    }
    if (journal.undone_at || !journal.finished_at) continue;
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

const win = (rel: string) => rel.split("/").join("\\");

export function migrationText(plan: MigrationPlan): string[] {
  const out: string[] = [];
  if (!plan.songs.length && !plan.collections.length && !plan.renames.length && !plan.lyricsFixes.length) out.push("Nothing to migrate: every song has its own folder in songs\\ and collections are in collections\\.");
  for (const c of plan.collections) out.push(`Collection: ${win(c.from)}\\  ->  ${win(c.to)}\\`);
  for (const r of plan.renames) out.push(`Rename ${r.what}: ${win(r.from)}\\  ->  ${win(r.to)}\\`);
  for (const f of plan.lyricsFixes) out.push(`Lyrics "${f.title}": ${win(f.file)} gets the lyrics of its newest video (${path.basename(f.from)}); the current one is kept in .studio\\replaced\\`);
  for (const s of plan.songs) {
    out.push(`Song "${s.title}" (${s.artist}): ${win(s.from)}\\  ->  ${win(s.to)}\\`);
    for (const m of s.moves) out.push(`    ${win(m.from.slice(s.from.length + 1))}  ->  ${win(m.to.slice(s.to.length + 1))}  (${m.what})`);
    for (const c of s.creates) out.push(`    new: ${path.basename(c)}`);
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

export type MigrationResult = {
  backupDir: string;
  songs: number;
  collections: number;
  renames: number;
  lines: string[];
};

export async function applyMigration(ws: Workspace, options: { log?: (m: string) => void; now?: Date } = {}): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  const plan = planMigration(ws);
  if (plan.problems.length) throw new Error(`Cannot migrate now:\n  - ${plan.problems.join("\n  - ")}`);
  if (!plan.songs.length && !plan.collections.length && !plan.renames.length && !plan.lyricsFixes.length)
    return {
      backupDir: "",
      songs: 0,
      collections: 0,
      renames: 0,
      lines: migrationText(plan),
    };

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
      mkdirSync(path.join(backupDir, "projects", s.projectId), {
        recursive: true,
      });
      copyFileSync(settings, path.join(backupDir, "projects", s.projectId, "settings.json"));
    }
  }
  const journal: Journal = {
    version: 1,
    started_at: now.toISOString(),
    finished_at: null,
    undone_at: null,
    had_moves_file: hadMoves,
    steps: [],
  };
  const journalFile = path.join(backupDir, "journal.json");
  const save = () => writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
  save();
  log(`backup: ${backupDir}`);

  const move = (from: string, to: string) => {
    moveEntry(absPath(ws, from), absPath(ws, to));
    journal.steps.push({ op: "move", from, to });
    save();
    relocatePaths(ws, from, to);
  };
  const create = (rel: string, content: string | Buffer) => {
    mkdirSync(path.dirname(absPath(ws, rel)), { recursive: true });
    if (existsSync(absPath(ws, rel))) return;
    writeFileSync(absPath(ws, rel), content);
    journal.steps.push({ op: "create", file: rel });
    save();
  };

  try {
    await migrateAll();
  } catch (error) {
    throw new Error(
      `The migration stopped: ${(error as Error).message}\n` +
        "Nothing is lost. Close any program that uses these files (a video player, Explorer in that folder), " +
        "then run pnpm songs:migrate --undo (with Lyric Studio stopped) and try again.",
    );
  }
  journal.finished_at = new Date().toISOString();
  save();
  return {
    backupDir,
    songs: plan.songs.length,
    collections: plan.collections.length,
    renames: plan.renames.length,
    lines: migrationText(plan),
  };

  async function migrateAll() {
    for (const c of plan.collections) {
      move(c.from, c.to);
      log(`moved ${win(c.from)}\\ -> ${win(c.to)}\\`);
    }
    for (const f of plan.lyricsFixes) {
      const file = absPath(ws, f.file); // before the renames below
      const kept = keepReplaced(path.dirname(file), file, true);
      copyFileSync(f.from, file);
      journal.steps.push({ op: "replace", file: f.file, kept: path.relative(ws.dir, kept).split(path.sep).join("/") });
      save();
      log(`lyrics.txt of "${f.title}" now holds the lyrics of its newest video`);
    }
    for (const r of plan.renames) {
      move(r.from, r.to);
      removeEmptyDirs(path.dirname(absPath(ws, r.from)), absPath(ws, "songs"));
      log(`renamed ${r.what}: ${win(r.from)}\\ -> ${win(r.to)}\\`);
    }
    for (const s of plan.songs) {
      // Read what the new files need before anything moves.
      const lyrics = legacyLyrics(ws, s.from);
      const hintFile = storedHint(ws, s.from);
      const hint = hintFile ? readFileSync(hintFile) : null;
      const settings = readJson(absPath(ws, `${s.from}/settings.json`)) as {
        ep?: string;
        collection?: { name: string; folder?: string };
        lyricsTxt?: string;
      };

      mkdirSync(absPath(ws, `${s.to}/clips`), { recursive: true });
      journal.steps.push({ op: "mkdir", dir: s.to });
      save();
      for (const m of s.moves) move(m.from, m.to);
      if (!existsSync(absPath(ws, `${s.to}/exports`))) mkdirSync(absPath(ws, `${s.to}/exports`), { recursive: true });
      ws.db.update(projectTable).set({ folder: s.to }).where(eq(projectTable.id, s.projectId)).run();

      if (lyrics) create(`${s.to}/lyrics.txt`, lyrics);
      if (hint) create(`${s.to}/hints.lrc`, hint);
      const recipe: SongRecipe = {};
      if (settings.ep) recipe.ep = settings.ep;
      if (settings.collection?.name) recipe.collections = [settings.collection.name];
      const recipeFile = absPath(ws, `${s.to}/song.json`);
      if (!existsSync(recipeFile)) {
        writeRecipe(recipeFile, recipe);
        journal.steps.push({ op: "create", file: `${s.to}/song.json` });
        save();
      }
      // The tool's settings now point into the song folder (the remembered collection's old clips\ folder too).
      const newSettings = absPath(ws, `${s.to}/${STUDIO_DIR}/settings.json`);
      if (existsSync(newSettings)) {
        const next = { ...settings };
        if (lyrics) next.lyricsTxt = `${s.to}/lyrics.txt`;
        const folder = next.collection?.folder?.replace(/\\/g, "/");
        const oldClips = absPath(ws, "clips").replace(/\\/g, "/");
        if (folder && next.collection && (folder === oldClips || folder.startsWith(`${oldClips}/`))) {
          next.collection = {
            ...next.collection,
            folder: absPath(ws, COLLECTIONS_DIR + folder.slice(oldClips.length)),
          };
        }
        writeFileSync(newSettings, `${JSON.stringify(next, null, 2)}\n`);
      }
      removeEmptyDirs(absPath(ws, `${s.from}/audio`), absPath(ws, "projects"));
      removeEmptyDirs(absPath(ws, s.from), absPath(ws, "projects"));
      log(`moved "${s.title}": ${win(s.from)}\\ -> ${win(s.to)}\\`);
    }
    for (const dir of ["projects", "clips"]) removeEmptyDirs(absPath(ws, dir), ws.dir);
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

// For the studio's banner: how many songs and collections still use the old layout.
export function migrationStatus(ws: Workspace): {
  songs: number;
  collections: number;
} {
  const songs = ws.db
    .select()
    .from(projectTable)
    .all()
    .filter((p) => !p.folder).length;
  const clipsDir = absPath(ws, "clips");
  const collections = existsSync(clipsDir) ? readdirSync(clipsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length : 0;
  return { songs, collections };
}

export { readMoves, writeMoves };
