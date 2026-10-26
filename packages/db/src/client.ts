import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { DB_FILENAME } from "./config";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

export function dbFile(workspaceDir: string): string {
  return path.join(workspaceDir, DB_FILENAME);
}

// Opens (and creates if needed) <workspaceDir>/studio.db.
export function openDb(workspaceDir: string): Db {
  mkdirSync(workspaceDir, { recursive: true });
  const sqlite = new Database(dbFile(workspaceDir));
  sqlite.pragma("journal_mode = WAL");
  // The studio, the worker and a "pnpm make" in the terminal share the file: wait for a moment
  // instead of failing when another one is writing.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema }) as Db;
}

// Applies any migrations in packages/db/drizzle that have not run yet.
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
