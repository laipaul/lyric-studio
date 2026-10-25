// Serves files from the workspace to the studio: project covers (and, from Step 6.2, exports).
// Only files under projects/ are allowed; never the database or anything outside the workspace.
import { Readable } from "node:stream";

import { resolveWorkspaceDir } from "@lyric/db";
import { mediaResponse, resolveMediaPath } from "@lyric/video/media";

const ALLOWED = /^projects\/[0-9a-f-]{36}\/audio\/cover\.(jpg|jpeg|png|webp)$/i;

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const relative = parts.join("/");
  if (!ALLOWED.test(relative)) return new Response("Not found", { status: 404 });
  const file = resolveMediaPath(parts.map(encodeURIComponent).join("/"), { workspaceDir: resolveWorkspaceDir() });
  const response = mediaResponse(file, request.headers.get("range"));
  const body = response.stream ? (Readable.toWeb(response.stream) as ReadableStream) : null;
  return new Response(body, { status: response.status, headers: { ...response.headers, "Cache-Control": "no-cache" } });
}
