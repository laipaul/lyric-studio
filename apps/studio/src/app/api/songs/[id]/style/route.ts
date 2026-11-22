// The song's style (Prepare → Song Details → Song style): GET { style, chosen, singingLines }; PUT { style } saves
// song.json "songStyle" ("cut" | "singing" | "film"). It only decides which tools the studio shows.
import { connection } from "next/server";

import { setSongStyle, songStyle } from "@lyric/video/song-style-node";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(withWorkspace((ws) => songStyle(ws, id)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { style?: unknown } | null;
  try {
    return Response.json(withWorkspace((ws) => setSongStyle(ws, id, body?.style)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
