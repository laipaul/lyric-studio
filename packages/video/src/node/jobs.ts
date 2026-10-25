// Render jobs whose process is gone (a "pnpm make" that was stopped, a PC that restarted) are marked
// "interrupted", so nothing shows "rendering" forever. Used by the worker (at start and every minute)
// and by the studio whenever it reads the jobs.
import { renderJob, type Workspace } from "@lyric/db";
import { inArray } from "drizzle-orm";

// Is a process with this id still running on this PC?
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // exists, but belongs to someone else
  }
}

export const INTERRUPTED_MESSAGE = "interrupted: the run stopped before this video was finished";

// Queued or rendering jobs without a living owner process -> "interrupted". Jobs from before this
// was recorded have no process id: they cannot still be running in this version, so they count too.
export function markInterruptedJobs(ws: Workspace, isAlive: (pid: number) => boolean = processAlive): number {
  const open = ws.db.select({ id: renderJob.id, pid: renderJob.pid }).from(renderJob).where(inArray(renderJob.status, ["queued", "rendering"])).all();
  const gone = open.filter((j) => j.pid === null || !isAlive(j.pid)).map((j) => j.id);
  if (gone.length) {
    ws.db.update(renderJob).set({ status: "interrupted", error: INTERRUPTED_MESSAGE, finished_at: new Date() }).where(inArray(renderJob.id, gone)).run();
  }
  return gone.length;
}
