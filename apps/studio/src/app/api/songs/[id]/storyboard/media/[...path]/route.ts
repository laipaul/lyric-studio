// The storyboard preview's files (prepared clips, the song, fonts), found as a render finds them.
import { Readable } from "node:stream";

import { resolveWorkspaceDir } from "@lyric/db";
import { bundledFontDirs } from "@lyric/video/font-catalog";
import { mediaResponse, resolveMediaPath } from "@lyric/video/media";
import { readMoves } from "@lyric/video/song-folder";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { path } = await params;
  const workspaceDir = resolveWorkspaceDir();
  const roots = { workspaceDir, fontDirs: bundledFontDirs(), moves: readMoves(workspaceDir) };
  const response = mediaResponse(resolveMediaPath(path.map(encodeURIComponent).join("/"), roots), request.headers.get("range"));
  const body = response.stream ? (Readable.toWeb(response.stream) as ReadableStream) : null;
  return new Response(body, { status: response.status, headers: response.headers });
}
