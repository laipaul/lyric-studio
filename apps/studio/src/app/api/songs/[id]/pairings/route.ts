// The Style tab's Pairings row. GET: every pairing as a card (the song's own verse and hook line over a
// frame of its clips, the exact font files, warnings). POST { action: "apply", id }: the pair into this
// song's song.json (locked fields kept); { action: "reset" }: back to the inherited fonts; { action:
// "brand", id }: "Save to brand" (the artist's brand.json; an explicit action only).
import { connection } from "next/server";

import { applyPairing, pairingsView, resetPairing, savePairingToBrand } from "@lyric/video/pairings";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(await withWorkspaceAsync((ws) => pairingsView(ws, id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string; id?: string; scope?: string } | null;
  try {
    if (body?.action === "apply") return Response.json(withWorkspace((ws) => applyPairing(ws, id, String(body.id ?? ""), body.scope === "song" ? "song" : "all")));
    if (body?.action === "reset") return Response.json(withWorkspace((ws) => resetPairing(ws, id, body.scope === "song" ? "song" : "all")));
    if (body?.action === "brand") return Response.json(withWorkspace((ws) => savePairingToBrand(ws, id, String(body.id ?? ""))));
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}
