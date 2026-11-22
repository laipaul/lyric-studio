// The song's sections (Lyrics Sync, Mini film): GET { sections (named), saved, suggestion, lineCount }; PUT
// { sections: [{ line, kind }] } saves song.json "sections"; { sections: null }: back to the app's suggestion.
import { connection } from "next/server";

import { setSongSections, songSections } from "@lyric/video/song-sections";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(withWorkspace((ws) => songSections(ws, id)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { sections?: unknown } | null;
  try {
    return Response.json(withWorkspace((ws) => setSongSections(ws, id, body?.sections ?? null)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
