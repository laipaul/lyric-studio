// Serves workspace files to the studio (covers, videos, captions, thumbnails, publish texts), with
// Range support so videos can seek. ?download=<name> saves the file under that name.
import { Readable } from "node:stream";

import { project, resolveWorkspaceDir } from "@lyric/db";
import { eq } from "drizzle-orm";
import { mediaResponse, resolveMediaPath } from "@lyric/video/media";

import { allowedFile } from "@/lib/files";
import { withWorkspace } from "@/lib/workspace";

// A song's own file under its own name (the database's audio_path).
const isSongAudio = (relative: string) => withWorkspace((ws) => !!ws.db.select({ id: project.id }).from(project).where(eq(project.audio_path, relative)).get());

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  if (!allowedFile(parts.join("/"), isSongAudio)) return new Response("Not found", { status: 404 });
  const file = resolveMediaPath(parts.map(encodeURIComponent).join("/"), { workspaceDir: resolveWorkspaceDir() });
  const response = mediaResponse(file, request.headers.get("range"));
  const body = response.stream ? (Readable.toWeb(response.stream) as ReadableStream) : null;
  const headers: Record<string, string> = { ...response.headers, "Cache-Control": "no-cache" };
  const download = new URL(request.url).searchParams.get("download");
  if (download) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(download.replace(/[\\/:*?"<>|]/g, "_"))}`;
  return new Response(body, { status: response.status, headers });
}
