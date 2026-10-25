// Serves workspace files to the studio (covers, videos, captions, thumbnails, publish texts), with
// Range support so videos can seek. ?download=<name> saves the file under that name.
import { Readable } from "node:stream";

import { resolveWorkspaceDir } from "@lyric/db";
import { mediaResponse, resolveMediaPath } from "@lyric/video/media";

import { allowedFile } from "@/lib/files";

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  if (!allowedFile(parts.join("/"))) return new Response("Not found", { status: 404 });
  const file = resolveMediaPath(parts.map(encodeURIComponent).join("/"), { workspaceDir: resolveWorkspaceDir() });
  const response = mediaResponse(file, request.headers.get("range"));
  const body = response.stream ? (Readable.toWeb(response.stream) as ReadableStream) : null;
  const headers: Record<string, string> = { ...response.headers, "Cache-Control": "no-cache" };
  const download = new URL(request.url).searchParams.get("download");
  if (download) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(download.replace(/[\\/:*?"<>|]/g, "_"))}`;
  return new Response(body, { status: response.status, headers });
}
