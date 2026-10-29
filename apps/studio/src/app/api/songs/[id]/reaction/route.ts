// Reactions (Step C): POST { video, reaction, clip?, scope?, apply? }. Without apply: what it would change
// ("Next run: …"); with apply and scope "song" | "artist": the change is made (song.json or brand.json).
import { applyReaction, planReaction, REACTIONS, type Reaction, type ReactionScope } from "@lyric/video/reactions";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { video?: string; reaction?: Reaction; clip?: string; scope?: ReactionScope; apply?: boolean } | null;
  if (!body?.video || !body.reaction || !(body.reaction in REACTIONS)) return Response.json({ error: "video and a known reaction are needed" }, { status: 400 });
  try {
    if (!body.apply) return Response.json(withWorkspace((ws) => planReaction(ws, id, { video: body.video!, reaction: body.reaction!, clip: body.clip })));
    if (body.scope !== "song" && body.scope !== "artist") return Response.json({ error: "scope must be song or artist" }, { status: 400 });
    return Response.json(withWorkspace((ws) => applyReaction(ws, id, { video: body.video!, reaction: body.reaction!, clip: body.clip, scope: body.scope! })));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
