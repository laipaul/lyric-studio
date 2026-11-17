// The song, its lyric lines and its files, read from the app's workspace. The database is opened READ-ONLY
// (the app can stay open), nothing in the song folder is written, and every file keeps the user's name: the
// vocal stem is the file the Vocals slot points to (.studio\files.json), as the app itself finds it.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { roleFile } from "../../../packages/video/src/node/file-links";
import type { Line } from "./plan";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// .env at the project root (KEY=value lines). Values already set in the environment win. Never printed.
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
  for (const k of Object.keys(env)) if (process.env[k]) env[k] = process.env[k]!;
  for (const k of ["FAL_KEY", "WORKSPACE_DIR", "FFMPEG_PATH", "FFPROBE_PATH"]) if (process.env[k] && !env[k]) env[k] = process.env[k]!;
  return env;
}

// .env must never reach git: true when the project's .gitignore covers it.
export function envIgnored(root = REPO_ROOT): boolean {
  try {
    return readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).some((l) => l.trim() === ".env" || l.trim() === "/.env");
  } catch {
    return false;
  }
}

export type Song = {
  id: string;
  title: string;
  artist: string;
  root: string; // the song folder
  audio: string; // the song (full mix)
  vocals: string | null; // the vocal stem (null: none in the Vocals slot)
  offsetMs: number; // the song's lyric offset (applied by the app at render time)
  durationS: number | null;
  lines: Line[];
};

type Row = { id: string; title: string; artist: string; audio_path: string | null; folder: string | null; lyrics_offset_ms: number; duration_ms: number | null };

function openReadOnly(dbFile: string) {
  // better-sqlite3 as the app installs it (packages/db).
  const req = createRequire(path.join(REPO_ROOT, "packages", "db", "package.json"));
  const Database = req("better-sqlite3") as new (file: string, opts: { readonly: boolean; fileMustExist: boolean }) => {
    prepare(sql: string): { all(...a: unknown[]): unknown[] };
    close(): void;
  };
  return new Database(dbFile, { readonly: true, fileMustExist: true });
}

const abs = (ws: string, rel: string) => (path.isAbsolute(rel) || /^[a-zA-Z]:[\\/]/.test(rel) ? path.resolve(rel) : path.join(ws, ...rel.split("/")));

export function workspaceDir(env: Record<string, string>): string {
  return path.resolve(REPO_ROOT, env.WORKSPACE_DIR?.trim() || "./workspace");
}

export function readSong(ws: string, query: string): Song {
  const dbFile = path.join(ws, "studio.db");
  if (!existsSync(dbFile)) throw new Error(`No Lyric Studio database at ${dbFile}. Is WORKSPACE_DIR in .env right?`);
  const db = openReadOnly(dbFile);
  try {
    const all = db.prepare("select id, title, artist, audio_path, folder, lyrics_offset_ms, duration_ms from project").all() as Row[];
    const q = query.trim().toLowerCase();
    const exact = all.filter((p) => p.id === query || p.title.toLowerCase() === q);
    const found = exact.length ? exact : all.filter((p) => p.title.toLowerCase().includes(q));
    if (!found.length) throw new Error(`No song matches "${query}". Songs: ${all.map((p) => p.title).join(", ") || "(none)"}`);
    if (found.length > 1) throw new Error(`"${query}" matches several songs: ${found.map((p) => p.title).join(", ")}. Type more of the title.`);
    const p = found[0];
    if (!p.folder) throw new Error(`"${p.title}" is still in the old folder layout (no Vocals slot): run pnpm songs:migrate --apply first.`);
    if (!p.audio_path) throw new Error(`"${p.title}" has no song file.`);
    const root = abs(ws, p.folder);
    const audio = abs(ws, p.audio_path);
    if (!existsSync(audio)) throw new Error(`The song file of "${p.title}" is missing: ${audio}`);
    const vocals = roleFile(root, "vocals");
    const rows = db
      .prepare('select "index" as i, text, start_ms, end_ms, is_hook from lyric_line where project_id = ? order by "index"')
      .all(p.id) as { i: number; text: string; start_ms: number | null; end_ms: number | null; is_hook: number }[];
    return {
      id: p.id,
      title: p.title,
      artist: p.artist,
      root,
      audio,
      vocals: existsSync(vocals) ? vocals : null,
      offsetMs: p.lyrics_offset_ms ?? 0,
      durationS: p.duration_ms ? p.duration_ms / 1000 : null,
      lines: rows.map((r) => ({ number: r.i + 1, text: r.text, startMs: r.start_ms, endMs: r.end_ms, isHook: !!r.is_hook })),
    };
  } finally {
    db.close();
  }
}
