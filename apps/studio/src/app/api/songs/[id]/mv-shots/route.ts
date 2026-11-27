// GET /api/songs/[id]/mv-shots: the music videos found in the song and every singing shot of them, scored, with the
// best of each line (mv-best.ts), for Lyrics Sync's "From your music videos" on each line (27 Nov 2026). best: null
// when no music video is found in the song (or the lyrics are not timed). The actions are on /api/songs/[id]/pictures
// (mv-best, mv-best-pick).
import { bestShotsView } from "@lyric/video/mv-best";
import { connection } from "next/server";

import { withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json({ best: await withWorkspaceAsync((ws) => bestShotsView(ws, id).catch(() => null)) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
