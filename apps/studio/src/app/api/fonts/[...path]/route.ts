// Font files for the Style tab's live preview: the bundled fonts (_fonts/<file>.woff2) and the user's
// own (fonts/<file> in WORKSPACE_DIR\fonts). Nothing else.
import { Readable } from "node:stream";

import { resolveWorkspaceDir } from "@lyric/db";
import { bundledFontDirs } from "@lyric/video/font-catalog";
import { mediaResponse, resolveMediaPath } from "@lyric/video/media";

const FONT = /^(_fonts\/[a-z0-9-]+\.woff2|fonts\/[^/]+\.(ttf|otf|woff2?))$/i;

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const relative = path.join("/");
  if (!FONT.test(relative)) return new Response("Not found", { status: 404 });
  const file = resolveMediaPath(path.map(encodeURIComponent).join("/"), { workspaceDir: resolveWorkspaceDir(), fontDirs: bundledFontDirs() });
  const response = mediaResponse(file, request.headers.get("range"));
  const body = response.stream ? (Readable.toWeb(response.stream) as ReadableStream) : null;
  return new Response(body, { status: response.status, headers: { ...response.headers, "Cache-Control": "max-age=3600" } });
}
