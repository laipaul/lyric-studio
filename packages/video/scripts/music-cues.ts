// pnpm music:cues "<song title>" [--fresh] [--no-stems]: the music cues of one of your songs as a table (time, section,
// line, level, trend, density, events, contrast), to check them by ear (Performance script, 26 Nov 2026). Local and
// free; caches the result in the song's .studio\music-cues.json (the Script panel and Shape's energy band use it).
import { openWorkspace, project as projectTable, resolveWorkspaceDir } from "@lyric/db";

import { cueTable, musicCues } from "../src/node/music-cues";

const args = process.argv.slice(2);
const wanted = args.filter((a) => !a.startsWith("--")).join(" ").trim().toLowerCase();
const ws = openWorkspace(resolveWorkspaceDir());
const songs = ws.db.select().from(projectTable).all();
const matches = wanted ? songs.filter((s) => s.title.toLowerCase() === wanted) : [];
const found = matches.length ? matches : songs.filter((s) => wanted && s.title.toLowerCase().includes(wanted));
if (found.length !== 1) {
  console.error(found.length ? `Several songs match "${wanted}": ${found.map((s) => s.title).join(", ")}. Type more of the title.` : `usage: pnpm music:cues "<song title>"\nYour songs: ${songs.map((s) => s.title).join(", ")}`);
  process.exit(1);
}
const song = found[0];
process.stderr.write(`Listening to "${song.title}" (the first time with stems can take a few minutes)…\n`);
const c = await musicCues(ws, song.id, { fresh: args.includes("--fresh"), stems: args.includes("--no-stems") ? "none" : "auto" });
console.log(`\n${song.title}\n${cueTable(c)}`);
console.log(`\nEvents in the whole song: ${c.events.map((e) => `${e.type} ${Math.floor(e.at_ms / 60000)}:${String(Math.floor((e.at_ms % 60000) / 1000)).padStart(2, "0")}`).join(", ") || "none"}`);
ws.close();
