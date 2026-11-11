// The song's YouTube tags (Prepare → Song Details → Tags): GET { tags, suggested }; PUT { tags: [..] } saves them in
// song.json "tags" (an empty list: back to the template's tags, the suggestion).
import { connection } from "next/server";

import { setSongBrandTags, setSongTags, songTags } from "@lyric/video/song-links-node";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(withWorkspace((ws) => songTags(ws, id)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { tags?: unknown; brand?: { tags?: unknown; starters?: unknown } } | null;
  try {
    return Response.json(
      withWorkspace((ws) => {
        // { brand: { tags?, starters? } }: the artist's brand tags / starter set (Edit brand tags), for all their songs.
        if (body?.brand) setSongBrandTags(ws, id, body.brand);
        else setSongTags(ws, id, body?.tags ?? []);
        return songTags(ws, id);
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
