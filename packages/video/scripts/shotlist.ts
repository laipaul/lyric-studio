// pnpm shotlist "<song title or id>" <shot list file.json> [--check]: imports a shot list into the song's story line as
// planned slots (C2), the same as Prepare → Storyboard → Import shot list. --check only says what the import would do.
// The pictures of the slots are made later (C3); until then Make skips them, so the videos do not change.
import { readFileSync, existsSync } from "node:fs";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { changesText, checkSongShotList, importShotList } from "../src/node/shotlist";
import { findSongByTitleOrId } from "../src/node/versions-report";

const args = process.argv.slice(2);
const onlyCheck = args.includes("--check");
const rest = args.filter((a) => a !== "--check");
const ws = openWorkspace(resolveWorkspaceDir());
try {
  if (rest.length < 2) throw new Error('usage: pnpm shotlist "<song title or id>" <shot list file.json> [--check]');
  const file = rest[rest.length - 1];
  const song = findSongByTitleOrId(ws, rest.slice(0, -1).join(" "));
  if (!existsSync(file)) throw new Error(`No file ${file}.`);
  const text = readFileSync(file, "utf8");
  const check = checkSongShotList(ws, song.id, text);
  console.log(`${song.title}: ${check.slots.length} slot(s) in ${file}`);
  for (const p of check.problems) console.log(`  ${p.level === "error" ? "✗" : "!"} ${p.slot ? `${p.slot}: ` : ""}${p.text}`);
  if (!check.ok) throw new Error("Fix the lines marked ✗ in the shot list, then run this again. Nothing was imported.");
  if (onlyCheck) console.log(`Ready to import: ${changesText(check.changes)}. (Only checked: run again without --check to import.)`);
  else {
    await importShotList(ws, song.id, text, file);
    console.log(`Imported: ${changesText(check.changes)}. See Prepare → Storyboard.`);
  }
} catch (error) {
  console.error(`\nError: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  ws.close();
}
