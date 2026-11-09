// pnpm storyboards (Theme v2 step 2d): writes the storyboard file of every planned video of every song
// (<song folder>\storyboards\<platform>-<n>.json, the plan Shape shows) and lists, by song and shot, every moved
// cut or slip of the Shape timeline that no video uses any more. Changes none of the song's own files.
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { storyboardsReport, writeAllStoryboards } from "../src/node/storyboards-report";

const ws = openWorkspace(resolveWorkspaceDir());
try {
  const songs = await writeAllStoryboards(ws, (m) => console.error(`planning ${m}`));
  console.log(storyboardsReport(songs));
} catch (error) {
  console.error(`\nError: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  ws.close();
}
