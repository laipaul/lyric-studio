// The song's links (Assets tab): GET { links, postLinks }; PUT { links: [{ service, url, label? }] } saves
// the whole list to song.json; POST { platform, urls | null }: the links picked for that platform's posts
// (Post panel; null = back to the default).
import { connection } from "next/server";

import { setPostLinks, setSongLinks, songLinks } from "@lyric/video/song-links-node";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(withWorkspace((ws) => songLinks(ws, id)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { links?: unknown } | null;
  if (!body || !Array.isArray(body.links)) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return Response.json(
      withWorkspace((ws) => {
        setSongLinks(ws, id, body.links);
        return songLinks(ws, id);
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { platform?: unknown; urls?: unknown } | null;
  const urls = body?.urls === null ? null : Array.isArray(body?.urls) && body.urls.every((u) => typeof u === "string") ? (body.urls as string[]) : undefined;
  if (!body || typeof body.platform !== "string" || !body.platform || urls === undefined) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return Response.json(
      withWorkspace((ws) => {
        setPostLinks(ws, id, body.platform as string, urls);
        return songLinks(ws, id);
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
