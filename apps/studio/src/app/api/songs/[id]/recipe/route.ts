// The song page's Style tab. GET: every recipe setting with its value and source (per platform where
// it can differ), the fonts (with the French accents they lack) and the effects. POST { action:
// set | reset | lock | unlock, field, platform?, value? }: one change to the song's song.json.
import { connection } from "next/server";

import { applyStyleAction, styleData, type StyleAction } from "@lyric/video/style";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(withWorkspace((ws) => styleData(ws, id)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as StyleAction | null;
  if (!body || !["set", "reset", "lock", "unlock"].includes(body.action)) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    withWorkspace((ws) => applyStyleAction(ws, id, body));
    return Response.json(withWorkspace((ws) => styleData(ws, id)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
