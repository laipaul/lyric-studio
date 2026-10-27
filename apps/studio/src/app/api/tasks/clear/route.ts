// "Clear finished" in the Tasks menu: hides finished entries (never videos or files).
import { clearFinished } from "@lyric/video/runs";

import { withWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { includeStopped?: boolean };
  const result = withWorkspace((ws) => clearFinished(ws, { includeStopped: body.includeStopped === true }));
  return Response.json(result);
}
