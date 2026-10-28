// Prints a song's storyboard as JSON on stdout (the studio's Storyboard tab runs this in its own process,
// so the planner and its render code stay out of the studio's server). WORKSPACE_DIR as usual.
//   tsx packages/video/scripts/storyboard.ts <project id>                         what it can show
//   tsx packages/video/scripts/storyboard.ts <project id> <platform> [video]      a plan (dry run)
//   tsx packages/video/scripts/storyboard.ts <project id> <platform> <video> <run folder>   a past run
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { storyboardChoices, storyboardPlan, storyboardRun } from "../src/node/storyboard";

const [id, platform, video = "v1", run] = process.argv.slice(2);
const ws = openWorkspace(resolveWorkspaceDir());
try {
  if (!id) throw new Error("usage: storyboard.ts <project id> [platform] [video] [run folder]");
  const out = !platform ? storyboardChoices(ws, id) : run ? await storyboardRun(ws, id, run, platform, video) : await storyboardPlan(ws, id, platform, video);
  console.log(JSON.stringify(out));
} catch (error) {
  console.log(JSON.stringify({ error: (error as Error).message }));
} finally {
  ws.close();
}
