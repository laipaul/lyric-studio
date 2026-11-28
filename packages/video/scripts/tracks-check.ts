// pnpm tracks:check (the two-layer timeline, Part A, 28 Nov 2026): every video of every song planned twice (the edit
// straight from song.json / clips.json, and through the tracks) without rendering; says "identical" or what differs.
// Changes no file.
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { tracksCheck, tracksCheckReport } from "../src/node/tracks-check";

const ws = openWorkspace(resolveWorkspaceDir());
try {
  const songs = await tracksCheck(ws, (m) => console.error(`checking ${m}`));
  const r = tracksCheckReport(songs);
  console.log(r.text);
  if (!r.ok) process.exitCode = 1;
} catch (error) {
  console.error(`\nError: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  ws.close();
}
