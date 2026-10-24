import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, describe, expect, it } from "vitest";

import { MIGRATIONS_DIR } from "../src";
import { tempDir } from "./helpers";

const temp = tempDir("migrations");
afterAll(() => temp.cleanup());

// A copy of the migrations folder that stops after the first `count` migrations.
function migrationsUpTo(count: number): string {
  const dir = path.join(temp.dir, `up-to-${count}`);
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.slice(0, count);
  for (const entry of journal.entries) cpSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`));
  writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal));
  return dir;
}

describe("database upgrades", () => {
  it("adding downbeat_offset and energy keeps existing projects, beats and sections", () => {
    const sqlite = new Database(path.join(temp.dir, "upgrade.db"));
    sqlite.pragma("foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder: migrationsUpTo(1) });
    sqlite.exec(`
      insert into project (id, title, artist, created_at) values ('p', 'Song', 'Life Lyrics', 0);
      insert into beat (project_id, time_ms, strength, is_downbeat) values ('p', 100, 1, 1), ('p', 600, 0.5, 0);
      insert into section (id, project_id, name, start_ms, end_ms) values ('s', 'p', 'Verse', 0, 1000);
    `);

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });

    expect(sqlite.prepare("select downbeat_offset from project where id = 'p'").get()).toEqual({ downbeat_offset: 0 });
    expect(sqlite.prepare("select count(*) as n from beat").get()).toEqual({ n: 2 });
    expect(sqlite.prepare("select energy from section where id = 's'").get()).toEqual({ energy: "medium" });
    expect(() => sqlite.exec("update project set downbeat_offset = 4")).toThrow();
    expect(() => sqlite.exec("update section set energy = 'extreme'")).toThrow();
    sqlite.close();
  });
});
