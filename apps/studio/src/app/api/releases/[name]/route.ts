// One release. GET: its grid. PATCH { name?, songs? }: rename / a new song list. DELETE: the release file
// moves to releases\_removed\ (the songs and their videos are not touched).
import { connection } from "next/server";

import { releaseView, removeRelease, updateRelease } from "@lyric/video/releases";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ name: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { name } = await params;
  try {
    return Response.json(withWorkspace((ws) => releaseView(ws, decodeURIComponent(name))));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { name } = await params;
  try {
    const body = (await request.json()) as { name?: string; songs?: string[] };
    return Response.json(withWorkspace((ws) => updateRelease(ws, decodeURIComponent(name), { ...(body.name !== undefined ? { name: String(body.name) } : {}), ...(Array.isArray(body.songs) ? { songs: body.songs.map(String) } : {}) })));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { name } = await params;
  try {
    return Response.json({ movedTo: withWorkspace((ws) => removeRelease(ws, decodeURIComponent(name))) });
  } catch (error) {
    return fail(error);
  }
}
