// Resume: queues the missing videos of a run (studio or terminal run) into its own folder.
import { enqueueRun, resumeOptions } from "@lyric/video/runs";

import { withWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const { projectId, folder } = (await request.json()) as { projectId?: string; folder?: string };
  if (!projectId || !folder) return Response.json({ error: "projectId and folder are needed" }, { status: 400 });
  try {
    const run = withWorkspace((ws) => enqueueRun(ws, projectId, resumeOptions(ws, projectId, folder)));
    return Response.json({ id: run.id, label: run.label });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
