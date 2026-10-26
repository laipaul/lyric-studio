// Render worker: makes the runs queued by the studio (Generate, Resume), one at a time, with the same
// code as "pnpm make", and keeps the jobs honest: render jobs and runs whose process is gone become
// "interrupted" (at start and every minute), so nothing shows "rendering" forever.
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";
import { markInterruptedJobs, markInterruptedRuns, workOnce } from "@lyric/video/run-worker";

let busy = false;
let stopping = false;

function checkJobs() {
  try {
    const ws = openWorkspace(resolveWorkspaceDir());
    try {
      const jobs = markInterruptedJobs(ws);
      const runs = markInterruptedRuns(ws);
      if (jobs || runs) console.log(`marked ${jobs} render job(s) and ${runs} run(s) as interrupted (their process is gone)`);
    } finally {
      ws.close();
    }
  } catch (error) {
    console.error(`could not check the render jobs: ${(error as Error).message}`);
  }
}

async function poll() {
  if (busy || stopping) return;
  busy = true;
  try {
    const ws = openWorkspace(resolveWorkspaceDir());
    try {
      const run = await workOnce(ws, undefined, { log: (m) => console.log(`  ${m}`) });
      if (run) console.log(`run ${run.label} for project ${run.project_id}: ${run.status}${run.message ? ` (${run.message.split("\n")[0]})` : ""}`);
    } finally {
      ws.close();
    }
  } catch (error) {
    console.error(`run failed: ${(error as Error).message}`);
  } finally {
    busy = false;
  }
}

checkJobs();
console.log("worker ready");
const pollTimer = setInterval(poll, 1500);
const checkTimer = setInterval(checkJobs, 60_000);

function shutdown() {
  stopping = true;
  clearInterval(pollTimer);
  clearInterval(checkTimer);
  console.log("worker stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
