// The Style tab's tempo check. GET: the detected tempo and the likeliest other tempi with their ratio
// ("x2/3" = a 3:2 error), as "pnpm tempo:check" prints them. Reads the song only.
import { connection } from "next/server";

import { tempoCheck } from "@lyric/video/analysis";
import { songPathsById } from "@lyric/video/song-folder";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    const song = withWorkspace((ws) => songPathsById(ws, id).audio);
    if (!song) return Response.json({ error: "This song has no song file." }, { status: 400 });
    return Response.json(await tempoCheck(song));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
