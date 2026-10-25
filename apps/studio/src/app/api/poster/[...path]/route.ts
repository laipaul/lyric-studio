// A still frame of a finished video (made once with FFmpeg, cached).
import { readFileSync } from "node:fs";

import { videoPoster } from "@lyric/video/posters";

import { VIDEO_FILE } from "@/lib/files";
import { withWorkspaceAsync } from "@/lib/workspace";

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const relative = (await params).path.join("/");
  if (!VIDEO_FILE.test(relative) || relative.includes("..")) return new Response("Not found", { status: 404 });
  try {
    const file = await withWorkspaceAsync((ws) => videoPoster(ws, relative));
    return new Response(readFileSync(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
