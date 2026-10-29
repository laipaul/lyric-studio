// The card editor's "Use as the brand's title font": POST { artist, family } -> the artist's brand.json
// titleFont (every title card, YouTube title and thumbnail of that artist).
import { setBrandTitleFont } from "@lyric/video/style";

import { withWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { artist?: string; family?: string } | null;
  if (!body?.artist || !body.family) return Response.json({ error: "artist and family are needed" }, { status: 400 });
  try {
    return Response.json(withWorkspace((ws) => setBrandTitleFont(ws, { artist: body.artist!, family: body.family! })));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
