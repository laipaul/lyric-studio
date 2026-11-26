// "Copy shot prompt" (Persona, 26 Nov 2026; node/persona.ts). POST { clip } (a Storyboard clip card) or { slot } (an
// accepted singing slot): the prompt text (identity + persona + the section's line + the song note + the lyric +
// lip-sync framing for a sung shot). Copy only: nothing is generated, no cut, timing or render changes.
import { clipShotPrompt, slotShotPrompt } from "@lyric/video/persona-node";

import { withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { clip?: unknown; slot?: unknown };
  try {
    if (typeof body.slot === "string" && body.slot) return Response.json(await withWorkspaceAsync((ws) => slotShotPrompt(ws, id, body.slot as string)));
    if (typeof body.clip === "string" && body.clip) return Response.json(await withWorkspaceAsync((ws) => clipShotPrompt(ws, id, body.clip as string)));
    throw new Error("Choose a clip or a singing slot.");
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
