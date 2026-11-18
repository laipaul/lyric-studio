// The Tasks menu: studio runs (queued, running, recent), terminal runs rendering right now, and the character /
// scene card jobs (Make pack, Remake, Get missing pictures).
import { connection } from "next/server";

import { listCardJobs } from "@lyric/video/characters";
import { listTasks } from "@lyric/video/runs";

import { withWorkspace } from "@/lib/workspace";

export async function GET() {
  await connection(); // always live (never prerendered)
  const tasks = withWorkspace((ws) => ({ ...listTasks(ws), cards: listCardJobs(ws) }));
  return Response.json(tasks, { headers: { "Cache-Control": "no-store" } });
}
