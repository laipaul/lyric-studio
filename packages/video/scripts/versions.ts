// pnpm versions <song title or id>: prints what each video of the song is called now. Song-wide version names per platform
// (v1, v2, v3... in the order the videos were made, never reused) live in <song folder>\.studio\versions.json, written the
// first time a song's videos are read (the studio, or this command); the video files keep their names. Changes no video,
// approval, favourite or posted state.
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { findSongByTitleOrId, versionsReport } from "../src/node/versions-report";

const query = process.argv.slice(2).join(" ");
const ws = openWorkspace(resolveWorkspaceDir());
try {
  if (!query.trim()) throw new Error('usage: pnpm versions "<song title or id>"');
  const song = findSongByTitleOrId(ws, query);
  console.log(versionsReport(ws, song.id, song.title));
} catch (error) {
  console.error(`\nError: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  ws.close();
}
