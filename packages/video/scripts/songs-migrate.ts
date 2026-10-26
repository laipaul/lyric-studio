// pnpm songs:migrate            a dry run: shows what would move (changes nothing)
// pnpm songs:migrate --apply    moves the songs into WORKSPACE_DIR\songs\<artist>\<title>\ and the
//                               collections into WORKSPACE_DIR\collections\<name>\ (light backup first)
// pnpm songs:migrate --undo     puts everything back as before the last --apply (stop Lyric Studio first)
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { applyMigration, BACKUP_REMINDER, migrationText, planMigration, undoMigration } from "../src/node";

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

let values;
try {
  ({ values } = parseArgs({ options: { apply: { type: "boolean", default: false }, undo: { type: "boolean", default: false }, yes: { type: "boolean", default: false } } }));
} catch (error) {
  fail((error as Error).message);
}
if (values.apply && values.undo) fail("Use --apply or --undo, not both.");
const dir = resolveWorkspaceDir();

if (values.undo) {
  if (!values.yes && !(await ask("Lyric Studio must be stopped (Stop Lyric Studio.cmd) while undoing. Is it stopped? (y/n)"))) fail("Nothing changed.");
  try {
    const r = undoMigration(dir, { log: (m) => console.log(`  ${m}`) });
    console.log(`\nUndone: ${r.steps} step(s) reversed; the database is back as it was before the migration.\nBackup folder (kept): ${r.dir}`);
  } catch (error) {
    fail((error as Error).message);
  }
  process.exit(0);
}

const ws = openWorkspace(dir);
try {
  const plan = planMigration(ws);
  const lines = migrationText(plan);
  console.log(lines.join("\n"));
  if (!values.apply) {
    if (plan.songs.length || plan.collections.length) console.log("\nDry run: nothing was changed. Run pnpm songs:migrate --apply to move.");
    process.exit(0);
  }
  if (!plan.songs.length && !plan.collections.length) process.exit(0);
  if (plan.problems.length) fail("fix the problems above first; nothing was changed.");
  if (!values.yes && !(await ask(`\n${BACKUP_REMINDER}`))) fail("Nothing changed.");
  const r = await applyMigration(ws, { log: (m) => console.log(`  ${m}`) });
  console.log(`\nDone: ${r.songs} song(s) and ${r.collections} collection(s) moved.`);
  console.log(`Backup of the database and settings: ${r.backupDir}`);
  console.log("Old manifests still re-render (the moves are recorded). To undo: pnpm songs:migrate --undo");
} catch (error) {
  fail((error as Error).message);
} finally {
  ws.close();
}
