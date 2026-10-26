// The Tasks menu: studio runs (queued, running, recent) and terminal runs rendering right now.
import { connection } from "next/server";

import { listTasks } from "@lyric/video/runs";

import { withWorkspace } from "@/lib/workspace";

export async function GET() {
  await connection(); // always live (never prerendered)
  const tasks = withWorkspace((ws) => listTasks(ws));
  return Response.json(tasks, { headers: { "Cache-Control": "no-store" } });
}
