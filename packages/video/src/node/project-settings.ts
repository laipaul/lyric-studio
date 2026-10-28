// Per-project settings that are not in the database: <song folder>\.studio\settings.json (songs not
// migrated yet: WORKSPACE_DIR\projects\<id>\settings.json).
// The clip collection last used ("--collection" becomes optional), the EP name, the project's own
// lyrics.txt (from "+ New song" in the studio). Also where a project's cover is stored.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { readRecipe, writeRecipe } from "./recipe";
import { songPathsById, STUDIO_DIR } from "./song-folder";

export type ProjectSettings = {
  collection?: { name: string; folder?: string };
  ep?: string;
  lyricsTxt?: string; // workspace-relative
};

const settingsFile = (ws: Workspace, projectId: string) => songPathsById(ws, projectId).settings;

export function readProjectSettings(ws: Workspace, projectId: string): ProjectSettings {
  try {
    return JSON.parse(readFileSync(settingsFile(ws, projectId), "utf8")) as ProjectSettings;
  } catch {
    return {};
  }
}

export function updateProjectSettings(ws: Workspace, projectId: string, changes: Partial<ProjectSettings>): ProjectSettings {
  const file = settingsFile(ws, projectId);
  mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...readProjectSettings(ws, projectId), ...changes };
  for (const k of Object.keys(next) as (keyof ProjectSettings)[]) if (next[k] === undefined) delete next[k];
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function rememberedCollection(ws: Workspace, projectId: string): { name: string; folder?: string } | null {
  const c = readProjectSettings(ws, projectId).collection as { name?: unknown; folder?: unknown } | undefined;
  return c && typeof c.name === "string" ? { name: c.name, ...(typeof c.folder === "string" ? { folder: c.folder } : {}) } : null;
}

export function rememberCollection(ws: Workspace, projectId: string, collection: { name: string; folder?: string }): void {
  updateProjectSettings(ws, projectId, { collection });
}

// The song's cover: <song folder>\cover.<ext> (songs not migrated yet: projects/<id>/audio/cover.<ext>).
export function storeCover(ws: Workspace, projectId: string, file: string): string {
  const paths = songPathsById(ws, projectId);
  const relative = paths.legacy ? `projects/${projectId}/audio/cover${path.extname(file).toLowerCase()}` : `${paths.rel}/cover${path.extname(file).toLowerCase()}`;
  // A cover replaced by another one is kept (in .studio\replaced\ of a song folder), never deleted.
  const previous = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()?.cover_path;
  if (!paths.legacy && previous && existsSync(absPath(ws, previous)) && path.resolve(absPath(ws, previous)) !== path.resolve(file)) keepReplaced(paths.root, absPath(ws, previous));
  mkdirSync(path.dirname(absPath(ws, relative)), { recursive: true });
  if (path.resolve(file) !== path.resolve(absPath(ws, relative))) copyFileSync(file, absPath(ws, relative));
  ws.db.update(projectTable).set({ cover_path: relative }).where(eq(projectTable.id, projectId)).run();
  return relative;
}

// The song's own lyrics.txt: <song folder>\lyrics.txt (songs not migrated yet: projects/<id>/lyrics/lyrics.txt).
export function storeLyricsTxt(ws: Workspace, projectId: string, file: string): string {
  const paths = songPathsById(ws, projectId);
  const relative = path.relative(ws.dir, paths.lyricsTxt).split(path.sep).join("/");
  mkdirSync(path.dirname(absPath(ws, relative)), { recursive: true });
  if (!existsSync(file)) throw new Error(`Lyrics file not found: ${file}`);
  if (!paths.legacy && existsSync(paths.lyricsTxt) && path.resolve(paths.lyricsTxt) !== path.resolve(file) && readFileSync(paths.lyricsTxt, "utf8") !== readFileSync(file, "utf8")) keepReplaced(paths.root, paths.lyricsTxt, true);
  if (path.resolve(file) !== path.resolve(absPath(ws, relative))) copyFileSync(file, absPath(ws, relative));
  updateProjectSettings(ws, projectId, { lyricsTxt: relative });
  return relative;
}

// A file of a song folder that is replaced (cover, lyrics.txt, hints.lrc) is kept in
// .studio\replaced\<date>-<name>: nothing the user made is ever deleted.
export function keepReplaced(songRoot: string, file: string, copy = false): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  // Two replacements in the same second keep both ("<stamp>.2-…" sorts after "<stamp>-…": newest last).
  const at = (n: number) => path.join(songRoot, STUDIO_DIR, "replaced", `${stamp}${n > 1 ? `.${n}` : ""}-${path.basename(file)}`);
  let n = 1;
  while (existsSync(at(n))) n += 1;
  const target = at(n);
  mkdirSync(path.dirname(target), { recursive: true });
  if (copy) copyFileSync(file, target);
  else renameSync(file, target);
  return target;
}

// The song's EP: song.json (song folders), else the remembered one (songs not migrated yet).
export function songEp(ws: Workspace, projectId: string): string | undefined {
  const paths = songPathsById(ws, projectId);
  const fromRecipe = paths.recipe ? readRecipe(paths.recipe).ep : undefined;
  return (fromRecipe ?? readProjectSettings(ws, projectId).ep) || undefined;
}

export function setSongEp(ws: Workspace, projectId: string, ep: string | undefined): void {
  const paths = songPathsById(ws, projectId);
  if (!paths.recipe) {
    updateProjectSettings(ws, projectId, { ep: ep || undefined });
    return;
  }
  const recipe = readRecipe(paths.recipe);
  if (recipe.locked?.includes("ep")) return;
  const next = { ...recipe };
  if (ep) next.ep = ep;
  else delete next.ep;
  writeRecipe(paths.recipe, next);
}

// The shared collections a song uses: song.json, else the one it used last time.
export function songCollections(ws: Workspace, projectId: string): string[] {
  const paths = songPathsById(ws, projectId);
  const fromRecipe = paths.recipe ? readRecipe(paths.recipe).collections : undefined;
  if (fromRecipe) return fromRecipe;
  const remembered = rememberedCollection(ws, projectId);
  return remembered ? [remembered.name] : [];
}
