// Stop: a queued run is cancelled; a running one stops after the video it is making.
import { requestStop } from "@lyric/video/runs";

import { withWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const { id } = (await request.json()) as { id?: string };
  if (!id) return Response.json({ error: "id is needed" }, { status: 400 });
  try {
    const run = withWorkspace((ws) => requestStop(ws, id));
    return Response.json({ status: run.status, stopRequested: run.stop_requested });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
