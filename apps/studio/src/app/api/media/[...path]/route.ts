// Serves songs, clips and fonts to the preview player (with Range support for seeking).
import { Readable } from "node:stream";

import { mediaResponse, resolveMediaPath } from "@lyric/video/media";

import { getPreviewData } from "@/lib/preview-data";

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const { media } = await getPreviewData();
  const response = mediaResponse(resolveMediaPath(path.map(encodeURIComponent).join("/"), media), request.headers.get("range"));
  const body = response.stream ? (Readable.toWeb(response.stream) as ReadableStream) : null;
  return new Response(body, { status: response.status, headers: response.headers });
}
