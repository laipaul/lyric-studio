// pnpm brand:set <platform> <setting> <value> [--artist "Life Lyrics"]
//   e.g. pnpm brand:set youtube verseEffect cinematic-fade
// Sets a per-platform value in the artist's brand.json (all of that artist's songs get it). Songs that
// set the same value themselves lose their own copy (they inherit it now). "-" as the value removes it.
import { parseArgs } from "node:util";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { setBrandPerPlatform } from "../src/node";

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { artist: { type: "string", default: "Life Lyrics" } } });
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
}
const [platform, field, value] = parsed.positionals;
if (!platform || !field || value === undefined) {
  console.error('Usage: pnpm brand:set <platform> <setting> <value> [--artist "Life Lyrics"]   (e.g. pnpm brand:set youtube verseEffect cinematic-fade)');
  process.exit(1);
}
const ws = openWorkspace(resolveWorkspaceDir());
try {
  const v = value === "-" ? null : field === "length" ? Number(value) : value;
  const r = setBrandPerPlatform(ws, { artist: parsed.values.artist!, platform, field, value: v });
  console.log(`${r.file}: ${platform} ${field} ${v === null ? "removed" : `= ${v}`} (every ${parsed.values.artist} song gets it)`);
  for (const t of r.tidied) console.log(`  "${t}": its own ${platform} ${field} was the same, removed (it inherits it from the brand now)`);
  for (const t of r.kept) console.log(`  "${t}": keeps its own ${platform} ${field} (Style tab, Per platform, to change it)`);
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  ws.close();
}
