// .env (FAL_KEY, WORKSPACE_DIR; never printed) and the song's clips folder, read from the app's database READ-ONLY.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function loadEnv(file = path.join(REPO_ROOT, ".env")): Record<string, string> {
  const env: Record<string, string> = {};
  if (existsSync(file)) {
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(raw);
      if (!m || raw.trim().startsWith("#")) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "");
      env[m[1]] = v;
    }
  }
  for (const k of ["FAL_KEY", "WORKSPACE_DIR"]) if (process.env[k]) env[k] = process.env[k]!;
  return env;
}

export function envIgnored(root = REPO_ROOT): boolean {
  try {
    return readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).some((l) => l.trim() === ".env" || l.trim() === "/.env");
  } catch {
    return false;
  }
}

export function workspaceDir(env: Record<string, string>): string {
  return path.resolve(REPO_ROOT, env.WORKSPACE_DIR?.trim() || "./workspace");
}

// The song's own clips folder (workspace\songs\<artist>\<title>\clips), found by title in the database (read-only).
export function songClipsFolder(ws: string, query: string): { title: string; clips: string } {
  const dbFile = path.join(ws, "studio.db");
  if (!existsSync(dbFile)) throw new Error(`No Lyric Studio database at ${dbFile}. Is WORKSPACE_DIR in .env right?`);
  const req = createRequire(path.join(REPO_ROOT, "packages", "db", "package.json"));
  const Database = req("better-sqlite3") as new (f: string, o: { readonly: boolean; fileMustExist: boolean }) => { prepare(s: string): { all(): unknown[] }; close(): void };
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const all = db.prepare("select title, folder from project").all() as { title: string; folder: string | null }[];
    const q = query.trim().toLowerCase();
    const exact = all.filter((p) => p.title.toLowerCase() === q);
    const found = exact.length ? exact : all.filter((p) => p.title.toLowerCase().includes(q));
    if (!found.length) throw new Error(`No song matches "${query}".`);
    if (found.length > 1) throw new Error(`"${query}" matches several songs: ${found.map((p) => p.title).join(", ")}.`);
    if (!found[0].folder) throw new Error(`"${found[0].title}" is still in the old folder layout: give the clips folder with --others instead.`);
    return { title: found[0].title, clips: path.join(ws, ...found[0].folder.split("/"), "clips") };
  } finally {
    db.close();
  }
}
