// pnpm db:show — prints what is in the database. Needs no extra tools.
import { existsSync } from "node:fs";
import { asc, count } from "drizzle-orm";

import { TABLES, dbFile, openWorkspace, resolveWorkspaceDir, stylePreset } from "../src";

const dir = resolveWorkspaceDir();
if (!existsSync(dbFile(dir))) {
  console.log(`No database yet at ${dbFile(dir)}`);
  console.log("Create it with: pnpm db:setup");
  process.exit(0);
}

const ws = openWorkspace(dir);
console.log("Lyric Studio database");
console.log(`  Workspace: ${ws.dir}`);
console.log(`  Database:  ${dbFile(ws.dir)}`);
console.log("");
console.log("  Table          Rows");
console.log("  -------------  ----");
for (const [name, table] of Object.entries(TABLES)) {
  const [{ rows }] = ws.db.select({ rows: count() }).from(table).all();
  console.log(`  ${name.padEnd(13)}  ${String(rows).padStart(4)}`);
}

const styles = ws.db.select().from(stylePreset).orderBy(asc(stylePreset.name)).all();
console.log("");
console.log(`  Style presets (${styles.length}):`);
for (const s of styles) {
  console.log(`    - ${s.name.padEnd(9)} ${s.font} ${s.weight}, ${s.effect}, ${s.animation}, ${s.default_size}px`);
}
ws.close();
