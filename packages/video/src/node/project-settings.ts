// Per-project settings that are not in the database: WORKSPACE_DIR\projects\<id>\settings.json.
// The clip collection last used ("--collection" becomes optional), the EP name, the project's own
// lyrics.txt (from "+ New song" in the studio). Also where a project's cover is stored.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

export type ProjectSettings = {
  collection?: { name: string; folder?: string };
  ep?: string;
  lyricsTxt?: string; // workspace-relative
};

const settingsFile = (ws: Workspace, projectId: string) => absPath(ws, `projects/${projectId}/settings.json`);

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

// The project's cover: projects/<id>/audio/cover.<ext> (the same place "pnpm make --cover" uses).
export function storeCover(ws: Workspace, projectId: string, file: string): string {
  const relative = `projects/${projectId}/audio/cover${path.extname(file).toLowerCase()}`;
  mkdirSync(path.dirname(absPath(ws, relative)), { recursive: true });
  if (path.resolve(file) !== path.resolve(absPath(ws, relative))) copyFileSync(file, absPath(ws, relative));
  ws.db.update(projectTable).set({ cover_path: relative }).where(eq(projectTable.id, projectId)).run();
  return relative;
}

// The project's own lyrics.txt: projects/<id>/lyrics/lyrics.txt.
export function storeLyricsTxt(ws: Workspace, projectId: string, file: string): string {
  const relative = `projects/${projectId}/lyrics/lyrics.txt`;
  mkdirSync(path.dirname(absPath(ws, relative)), { recursive: true });
  if (!existsSync(file)) throw new Error(`Lyrics file not found: ${file}`);
  copyFileSync(file, absPath(ws, relative));
  updateProjectSettings(ws, projectId, { lyricsTxt: relative });
  return relative;
}
