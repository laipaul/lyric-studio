// Render worker. Step 6.2a: at start and every minute it marks render jobs whose process is gone as
// "interrupted" (a stopped "pnpm make" never shows "rendering" forever). Step 6.2b adds the queue of
// runs started from the studio.
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";
import { markInterruptedJobs } from "@lyric/video/jobs";

function checkJobs() {
  try {
    const ws = openWorkspace(resolveWorkspaceDir());
    try {
      const n = markInterruptedJobs(ws);
      if (n) console.log(`marked ${n} render job(s) as interrupted (their process is gone)`);
    } finally {
      ws.close();
    }
  } catch (error) {
    console.error(`could not check the render jobs: ${(error as Error).message}`);
  }
}

checkJobs();
console.log("worker ready");
const timer = setInterval(checkJobs, 60_000);

function shutdown() {
  clearInterval(timer);
  console.log("worker stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
