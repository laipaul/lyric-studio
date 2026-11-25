// Film looks (22 Nov 2026, Paul: "the global look is correct like the Theme"). Clips feel like one film only when
// every generation shares the same camera, lens, grain and grade. A Film look is that, kept once and reused: a
// reference still (a ShotDeck frame with its data block, a Midjourney frame, a photo) and one short look line
// ("35mm film grain, ARRI Alexa 35 look, warm tungsten light, soft shallow depth of field"). A song picks one the way
// it picks a Theme (song.json "filmLook"), and the app adds the line to every Animate and singing take of the song,
// so Paul never retypes it and never needs camera words himself (film-look-writer.ts writes it from the still).
// It is called "Film look" on screen because "Looks" are Wardrobe outfits (characters).
//   WORKSPACE_DIR\film-looks\<name>\look.json    name, line, Midjourney words, the still's file name (versioned)
//   WORKSPACE_DIR\film-looks\<name>\still.<ext>  the reference still (optional)
//   WORKSPACE_DIR\film-looks\_removed\           deleted ones, with Restore (nothing is ever deleted)
// It sits next to Theme, not inside it: a Theme is the lyric text design (fonts, motion, colours; may be resold), a
// Film look is what the video engines are told about the pictures. The picture itself still decides colour and light
// (Animate is image-to-video); the line keeps grain, depth of field and camera feel the same from clip to clip.
// Each take keeps the line it was sent with (Take.filmLook / Take.look), so a later change remakes nothing.
// Scenes (planned): filmLookFor() is the one place that decides which look a take gets, so a scene can carry its own.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { project as projectTable, safeName, type Workspace } from "@lyric/db";

import { DEFAULT_FEEL, isFeel, type Feel } from "./realism";
import { readRecipe, writeRecipe } from "./recipe";
import { isRemovedSong, songPathsById } from "./song-folder";

export const FILM_LOOK_VERSION = 1;
export const FILM_LOOKS_DIR = "film-looks";
export const LOOK_LINE_MAX = 300;
export const MIDJOURNEY_MAX = 400;
export const STILL_FILE = /\.(jpe?g|png|webp)$/i;

export type FilmLook = {
  version: number;
  name: string;
  line: string; // the words added to every video prompt of a song with this look
  midjourney: string; // the same look for Midjourney, to copy (Paul's pictures start in the look)
  still: string | null; // the reference still in the folder ("still.jpg")
  feel: Feel; // the realism rules every take is sent with (realism.ts): natural (default) or dreamy
  createdAt: string;
};
export type FilmLookInfo = FilmLook & { folder: string; stillPath: string | null; songs: { id: string; title: string }[] };
export type RemovedFilmLook = { folder: string; name: string; removedAt: string };

export const filmLooksDir = (workspaceDir: string) => path.join(workspaceDir, FILM_LOOKS_DIR);
export const filmLookFolder = (workspaceDir: string, name: string) => path.join(filmLooksDir(workspaceDir), safeName(name));
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// A look.json as it is read: anything missing gets a plain default (a hand-edited file never blocks a song).
export function checkFilmLook(raw: unknown, fallbackName = ""): FilmLook {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    version: FILM_LOOK_VERSION,
    name: clean(r.name, 80) || fallbackName,
    line: clean(r.line, LOOK_LINE_MAX),
    midjourney: clean(r.midjourney, MIDJOURNEY_MAX),
    still: typeof r.still === "string" && STILL_FILE.test(r.still) ? path.basename(r.still) : null,
    feel: isFeel(r.feel) ? r.feel : DEFAULT_FEEL,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

function writeLook(workspaceDir: string, look: FilmLook): void {
  const dir = filmLookFolder(workspaceDir, look.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "look.json"), `${JSON.stringify({ _help: "A Film look of Lyric Studio: line = the words added to every Animate and singing take of the songs that use it.", ...look }, null, 2)}\n`);
}

export function readFilmLook(workspaceDir: string, name: string): FilmLook | null {
  const file = path.join(filmLookFolder(workspaceDir, name), "look.json");
  if (!existsSync(file)) return null;
  try {
    return checkFilmLook(JSON.parse(readFileSync(file, "utf8")), name);
  } catch {
    return checkFilmLook({}, name); // a broken file: listed with an empty line, to fix on the page
  }
}

function stillPath(workspaceDir: string, look: FilmLook): string | null {
  if (!look.still) return null;
  const p = path.join(filmLookFolder(workspaceDir, look.name), look.still);
  return existsSync(p) ? p : null;
}

// The songs that use a look (title and id).
export function filmLookUsers(ws: Workspace, name: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const p of ws.db.select({ id: projectTable.id, title: projectTable.title, folder: projectTable.folder }).from(projectTable).all()) {
    if (isRemovedSong(p.folder)) continue;
    const file = songPathsById(ws, p.id).recipe;
    if (!file || !existsSync(file)) continue;
    try {
      if (readRecipe(file).filmLook === name) out.push({ id: p.id, title: p.title });
    } catch {
      // a broken song.json is named where that song is opened
    }
  }
  return out;
}

export function listFilmLooks(ws: Workspace): FilmLookInfo[] {
  const dir = filmLooksDir(ws.dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(path.join(dir, d.name, "look.json")))
    .map((d) => readFilmLook(ws.dir, d.name)!)
    .map((l) => ({ ...l, folder: filmLookFolder(ws.dir, l.name), stillPath: stillPath(ws.dir, l), songs: filmLookUsers(ws, l.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function freeName(workspaceDir: string, wanted: string): string {
  const base = clean(wanted, 80) || "Film look";
  let name = base;
  for (let i = 2; existsSync(filmLookFolder(workspaceDir, name)); i++) name = `${base} ${i}`;
  return name;
}

// "New film look": a name first; the line can be written from the still afterwards.
export function createFilmLook(workspaceDir: string, o: { name: unknown; line?: unknown; midjourney?: unknown; feel?: unknown }): FilmLook {
  const wanted = clean(o.name, 80);
  if (!wanted) throw new Error("Give the Film look a name first (e.g. Warm wedding film).");
  if (existsSync(filmLookFolder(workspaceDir, wanted))) throw new Error(`There is already a Film look called "${wanted}": pick another name.`);
  const look: FilmLook = { version: FILM_LOOK_VERSION, name: wanted, line: clean(o.line, LOOK_LINE_MAX), midjourney: clean(o.midjourney, MIDJOURNEY_MAX), still: null, feel: isFeel(o.feel) ? o.feel : DEFAULT_FEEL, createdAt: new Date().toISOString() };
  writeLook(workspaceDir, look);
  return look;
}

// Edits on the Film looks page. scope "all": the look itself, for every song that uses it ("Update all N songs");
// "new": a copy under a new name, the songs stay on the old one ("Save as new"). A new name on scope "all" renames
// the look and every song follows it.
export function saveFilmLook(ws: Workspace, name: string, o: { name?: unknown; line?: unknown; midjourney?: unknown; feel?: unknown; scope?: "all" | "new" }): FilmLook {
  const look = readFilmLook(ws.dir, name);
  if (!look) throw new Error(`No Film look "${name}".`);
  const next: FilmLook = { ...look, line: o.line !== undefined ? clean(o.line, LOOK_LINE_MAX) : look.line, midjourney: o.midjourney !== undefined ? clean(o.midjourney, MIDJOURNEY_MAX) : look.midjourney, feel: isFeel(o.feel) ? o.feel : look.feel };
  const wanted = o.name !== undefined ? clean(o.name, 80) : look.name;
  if (!wanted) throw new Error("A Film look needs a name.");
  if (o.scope === "new") {
    const copy = { ...next, name: freeName(ws.dir, wanted === look.name ? `${look.name} copy` : wanted), createdAt: new Date().toISOString() };
    writeLook(ws.dir, copy);
    const s = stillPath(ws.dir, look);
    if (s) copyFileSync(s, path.join(filmLookFolder(ws.dir, copy.name), look.still!));
    return copy;
  }
  if (wanted !== look.name) {
    if (safeName(wanted) !== safeName(look.name) && existsSync(filmLookFolder(ws.dir, wanted))) throw new Error(`There is already a Film look called "${wanted}": pick another name.`);
    const users = filmLookUsers(ws, look.name);
    renameSync(filmLookFolder(ws.dir, look.name), filmLookFolder(ws.dir, wanted));
    next.name = wanted;
    for (const u of users) {
      const file = songPathsById(ws, u.id).recipe!;
      writeRecipe(file, { ...readRecipe(file), filmLook: wanted });
    }
  }
  writeLook(ws.dir, next);
  return next;
}

// The reference still (a dropped file); the old one is replaced (moved to .replaced\ inside the folder).
export function setFilmLookStill(workspaceDir: string, name: string, data: Buffer, fileName: string): FilmLook {
  const look = readFilmLook(workspaceDir, name);
  if (!look) throw new Error(`No Film look "${name}".`);
  const ext = (path.extname(fileName).toLowerCase() || ".jpg").replace(".jpeg", ".jpg");
  if (!STILL_FILE.test(ext)) throw new Error("Drop a JPG, PNG or WebP picture (a screenshot works).");
  const dir = filmLookFolder(workspaceDir, name);
  const old = stillPath(workspaceDir, look);
  if (old) {
    const keep = path.join(dir, ".replaced");
    mkdirSync(keep, { recursive: true });
    renameSync(old, path.join(keep, `${Date.now()} ${look.still}`));
  }
  const still = `still${ext}`;
  writeFileSync(path.join(dir, still), data);
  const next = { ...look, still };
  writeLook(workspaceDir, next);
  return next;
}

// Points a song to a look (null: no Film look; the prompts are as before).
export function chooseFilmLook(ws: Workspace, projectId: string, name: string | null): void {
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const song = readRecipe(file);
  if (name) {
    if (!readFilmLook(ws.dir, name)) throw new Error(`No Film look "${name}".`);
    writeRecipe(file, { ...song, filmLook: name });
  } else {
    const { filmLook: _gone, ...rest } = song;
    writeRecipe(file, rest);
  }
}

// The look a song's next take is sent with: its name and line (null: none, or a look without words yet, or one that
// is gone). Scenes (planned) will pass the scene, whose own look wins over the song's.
export function filmLookFor(ws: Workspace, projectId: string): { name: string; line: string } | null {
  let name: string | undefined;
  try {
    name = readRecipe(songPathsById(ws, projectId).recipe).filmLook;
  } catch {
    return null;
  }
  if (!name) return null;
  const look = readFilmLook(ws.dir, name);
  return look?.line ? { name: look.name, line: look.line } : null;
}

// The realism feel a song's next take is sent with (realism.ts): its Film look's, else natural. Unlike filmLookFor it
// does not need the look's words: a look with only a still and a feel still sets the feel.
export function feelFor(ws: Workspace, projectId: string): Feel {
  try {
    const name = readRecipe(songPathsById(ws, projectId).recipe).filmLook;
    return (name && readFilmLook(ws.dir, name)?.feel) || DEFAULT_FEEL;
  } catch {
    return DEFAULT_FEEL;
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const REMOVED = /^(.*) \(removed (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\)$/;

// "Delete": to film-looks\_removed\<name> (removed <date>), with Restore. A look that a song uses is refused.
export function removeFilmLook(ws: Workspace, name: string): string {
  const look = readFilmLook(ws.dir, name);
  if (!look) throw new Error(`No Film look "${name}".`);
  const users = filmLookUsers(ws, look.name);
  if (users.length) throw new Error(`${users.length} song${users.length === 1 ? "" : "s"} use${users.length === 1 ? "s" : ""} "${look.name}" (${users.map((u) => u.title).join(", ")}): pick another Film look for ${users.length === 1 ? "it" : "them"} first (Prepare → Creation).`);
  const at = new Date();
  const label = `${safeName(look.name)} (removed ${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())})`;
  const removed = path.join(filmLooksDir(ws.dir), "_removed");
  mkdirSync(removed, { recursive: true });
  renameSync(filmLookFolder(ws.dir, look.name), path.join(removed, label));
  return label;
}

export function removedFilmLooks(workspaceDir: string): RemovedFilmLook[] {
  const dir = path.join(filmLooksDir(workspaceDir), "_removed");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const m = REMOVED.exec(d.name);
      return m ? { folder: d.name, name: m[1], removedAt: new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]).toISOString() } : { folder: d.name, name: d.name, removedAt: "" };
    })
    .sort((a, b) => b.removedAt.localeCompare(a.removedAt));
}

// "Restore": back under its name ("<name> 2" when that name was taken since).
export function restoreFilmLook(workspaceDir: string, folder: string): string {
  const entry = removedFilmLooks(workspaceDir).find((r) => r.folder === folder);
  if (!entry) throw new Error(`No removed Film look "${folder}".`);
  const from = path.join(filmLooksDir(workspaceDir), "_removed", folder);
  let look: FilmLook;
  try {
    look = checkFilmLook(JSON.parse(readFileSync(path.join(from, "look.json"), "utf8")), entry.name);
  } catch {
    look = checkFilmLook({}, entry.name);
  }
  const name = freeName(workspaceDir, look.name);
  mkdirSync(filmLooksDir(workspaceDir), { recursive: true });
  renameSync(from, filmLookFolder(workspaceDir, name));
  if (name !== look.name) writeLook(workspaceDir, { ...look, name });
  return name;
}

// The Film looks page's data (stills as workspace-relative paths for /api/files).
export type FilmLooksPage = {
  looks: (Omit<FilmLookInfo, "folder" | "stillPath"> & { stillUrl: string | null })[];
  removed: RemovedFilmLook[];
  writer: { ready: boolean; how: string }; // can the app write the line from a still (a key in .env)
};
export function filmLooksPage(ws: Workspace, writer: FilmLooksPage["writer"]): FilmLooksPage {
  return {
    looks: listFilmLooks(ws).map(({ folder: _f, stillPath: s, ...l }) => ({ ...l, stillUrl: s ? path.relative(ws.dir, s).split(path.sep).join("/") : null })),
    removed: removedFilmLooks(ws.dir),
    writer,
  };
}
