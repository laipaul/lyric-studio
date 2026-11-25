// pnpm draft-test "<song title or id>" "<picture file, or the start of its name, or a full path>" [--yes]: the one-off
// Draft test (src/node/draft-test.ts). A full path to a picture elsewhere on the PC adds it to the song's Creation first.
// Without --yes it only says what it would make and what it costs. With --yes it spends about $2.40 on WaveSpeed
// (the key in D:\videomaker\.env) and puts four takes on the picture in Prepare → Creation.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { addPictures, keyFor } from "../src/node/animate";
import { checkDraftTestPicture, DRAFT_TEST_PARTS, draftTestUsd, runDraftTest } from "../src/node/draft-test";
import { findSongByTitleOrId } from "../src/node/versions-report";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides what is already set; the key is never printed

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const rest = args.filter((a) => a !== "--yes");
const ws = openWorkspace(resolveWorkspaceDir());
try {
  if (rest.length < 2) throw new Error('usage: pnpm draft-test "<song title or id>" "<picture file>" [--yes]');
  const song = findSongByTitleOrId(ws, rest.slice(0, -1).join(" "));
  let picture = rest[rest.length - 1];
  // A picture file anywhere on the PC (a full path, e.g. dragged into the terminal): added to the song's Creation first.
  const outside = path.resolve(process.env.INIT_CWD ?? process.cwd(), picture);
  if (/[\\/]/.test(picture) && existsSync(outside)) {
    const r = await addPictures(ws, song.id, [{ file: outside, name: path.basename(outside) }]);
    picture = r.added[0] ?? path.basename(outside);
    console.log(r.added.length ? `Added ${picture} to ${song.title} → Creation.` : `${picture} is already in ${song.title} → Creation.`);
  }
  const { name } = checkDraftTestPicture(ws, song.id, picture);
  console.log(`${song.title}, picture ${name}: four takes, about $${draftTestUsd().toFixed(2)} in total`);
  for (const p of DRAFT_TEST_PARTS) console.log(`  ${p.label.padEnd(20)} ${p.model.padEnd(26)} about $${p.usd.toFixed(2)}`);
  const key = keyFor("wavespeed");
  if (!key) throw new Error("No WAVESPEED_API_KEY in D:\\videomaker\\.env. Nothing was sent.");
  if (!yes) console.log("\nOnly checked, nothing was sent. Run it again with --yes at the end to make the four takes.");
  else {
    console.log("\nMaking them (usually 2 to 5 minutes)…");
    const out = await runDraftTest(ws, song.id, name, { key, log: (l) => console.log(l) });
    const failed = out.filter((r) => r.error);
    console.log(`\n${out.length - failed.length} of 4 takes made. Open ${song.title} → Prepare → Creation, picture ${name}, and play them side by side.`);
    if (failed.length) process.exitCode = 1;
  }
} catch (error) {
  console.error(`\nError: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  ws.close();
}
