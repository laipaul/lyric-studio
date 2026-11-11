// Prints a song's storyboard as JSON on stdout (the studio's Storyboard tab runs this in its own process,
// so the planner and its render code stay out of the studio's server). WORKSPACE_DIR as usual.
//   tsx packages/video/scripts/storyboard.ts <project id>                         what it can show
//   tsx packages/video/scripts/storyboard.ts <project id> <platform> [video]      a plan (dry run)
//   tsx packages/video/scripts/storyboard.ts <project id> <platform> <video> <run folder>   a past run
//   tsx packages/video/scripts/storyboard.ts <project id> <platform> <video> --clips song+wedding   a plan over other clips
//   tsx packages/video/scripts/storyboard.ts <project id> <platform> <video> --try reels-1~theme-night-drive   a Try other looks video (2e-1)
//   tsx packages/video/scripts/storyboard.ts <project id> <platform> --take-check <take>   "Make another": would take N
//       repeat a take the song has? { problem: null | "Take 3 would be identical to v1: …" } (take-check.ts)
//   tsx packages/video/scripts/storyboard.ts <project id> - --dup-check '<run request as JSON>'   a normal Make run: would a video
//       of it be identical to one the song already has? { problem: null | "Reels v4 would be identical to Reels v3 (made 11 Nov 15:05): …" }
//   tsx packages/video/scripts/storyboard.ts --serve      stays running (8 Nov 2026): one request per stdin line,
//       {"n": 1, "args": ["<project id>", "reels", "v1"]}, one answer per stdout line, {"n": 1, "out": {...}}.
//       The studio keeps one such planner warm, so an edit does not pay Node / tsx starting up and the song being
//       decoded again (the decoded song stays in memory, keyed by its file and modified time). Ends with its stdin.
import { createInterface } from "node:readline";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { storyboardChoices, storyboardPlan, storyboardRun } from "../src/node/storyboard";
import type { RunRequest } from "../src/node/runs";
import { duplicateProblem, takeProblem } from "../src/node/take-check";

async function storyboard(args: string[]): Promise<unknown> {
  const [id, platform, video = "v1", fourth, fifth] = args;
  const clipSet = fourth === "--clips" ? fifth : undefined;
  const tryId = fourth === "--try" ? fifth : undefined;
  const run = fourth === "--clips" || fourth === "--try" ? undefined : fourth;
  const ws = openWorkspace(resolveWorkspaceDir());
  try {
    if (!id) throw new Error("usage: storyboard.ts <project id> [platform] [video] [run folder]");
    if (video === "--take-check") return { problem: await takeProblem(ws, id, platform, Number(fourth)) };
    if (video === "--dup-check") return { problem: await duplicateProblem(ws, id, JSON.parse(fourth ?? "{}") as RunRequest) };
    return !platform ? storyboardChoices(ws, id) : run ? await storyboardRun(ws, id, run, platform, video) : await storyboardPlan(ws, id, platform, video, clipSet, tryId);
  } catch (error) {
    return { error: (error as Error).message };
  } finally {
    ws.close();
  }
}

if (process.argv[2] === "--serve") {
  // One request at a time, in the order they come (the studio sends one at a time anyway).
  let queue = Promise.resolve();
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    queue = queue.then(async () => {
      let n: unknown = null;
      try {
        const req = JSON.parse(line) as { n: unknown; args: string[] };
        n = req.n;
        const out = await storyboard(Array.isArray(req.args) ? req.args.map(String) : []);
        process.stdout.write(`${JSON.stringify({ n, out })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ n, out: { error: (error as Error).message } })}\n`);
      }
    });
  });
  lines.on("close", () => void queue.then(() => process.exit(0)));
} else {
  console.log(JSON.stringify(await storyboard(process.argv.slice(2))));
}
