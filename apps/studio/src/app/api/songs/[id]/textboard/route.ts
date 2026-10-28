// The song's textboard (Storyboard tab). GET: its cards (title, byline, tagline, every lyric line) with
// their overrides, the role rules, the template and the artist's templates. POST: { action: "card", id,
// overrides | null } | { action: "role", role, style | null } | { action: "save-template", name } |
// { action: "apply-template", name }; the tab then plans again.
import { connection } from "next/server";

import { textboardData, textboardEdit, type TextboardEdit } from "@lyric/video/textboard";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(withWorkspace((ws) => textboardData(ws, id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as TextboardEdit | null;
  if (!body || !["card", "role", "save-template", "apply-template"].includes(body.action)) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return Response.json(withWorkspace((ws) => textboardEdit(ws, id, body)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
