// Favourite / approved / discarded on a video (discarded = hidden, never deleted).
import type { VideoMarkStatus } from "@lyric/db";
import { setVideoMark } from "@lyric/video/exports";

import { withWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const body = (await request.json()) as { projectId?: string; video?: string; favourite?: boolean; status?: VideoMarkStatus };
  if (!body.projectId || !body.video) return Response.json({ error: "projectId and video are needed" }, { status: 400 });
  if (body.status !== undefined && !["generated", "approved", "discarded"].includes(body.status)) return Response.json({ error: "status must be generated, approved or discarded" }, { status: 400 });
  try {
    return Response.json(withWorkspace((ws) => setVideoMark(ws, body.projectId!, body.video!, { favourite: body.favourite, status: body.status })));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
