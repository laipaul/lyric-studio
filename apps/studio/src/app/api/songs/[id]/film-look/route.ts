// A song's Film look (Prepare → Creation, the "Film look" dropdown). GET: the song's look and every look to pick from.
// PUT { name }: the song uses that look (null or "": none). Takes already made keep the line they were sent with.
import { chooseFilmLook, listFilmLooks } from "@lyric/video/film-looks";
import { readRecipe } from "@lyric/video/recipe";
import { songPathsById } from "@lyric/video/song-folder";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

const view = (id: string) =>
  withWorkspace((ws) => ({
    current: readRecipe(songPathsById(ws, id).recipe).filmLook ?? null,
    looks: listFilmLooks(ws).map((l) => ({ name: l.name, line: l.line, songs: l.songs.length })),
  }));

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    return Response.json(view(id));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as { name?: string | null };
  try {
    withWorkspace((ws) => chooseFilmLook(ws, id, String(body.name ?? "").trim() || null));
    return Response.json(view(id));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
