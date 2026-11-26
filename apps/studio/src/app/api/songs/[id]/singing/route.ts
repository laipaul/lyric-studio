// Lip-sync readiness (Nextgen step 2, 26 Nov 2026; lipsync.ts). GET ?kind=short|full: the singing slots of that video
// (a Reel, or the whole song for YouTube / a Mini film; default by the song style) with their suggested clips, the meter
// and every clip's lip-sync check. POST { action }:
//   "check" { names?: [clip] }: check the clips (all when no names) for lip sync, locally (cached by content)
//   "accept" { slot, clip | null, kind }: mark (or clear) the clip that sings that slot (clips.json, display only)
//   "ignore" { slot, clip, undo? }: not this clip for that slot (or back)
//   "split" { line, undo? }: slots never continue past that sung line (or join again)
//   "export" { slot, kind }: the performance excerpt of an accepted slot (performance\<name>\), its folder name back
import { connection } from "next/server";
import path from "node:path";

import { cardFace } from "@lyric/video/characters";
import { acceptSlot, checkLipsync, exportExcerpt, ignoreSuggestion, singingView, splitAfterLine, type SingingKind } from "@lyric/video/lipsync";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });
const kindOf = (v: unknown): SingingKind | null => (v === "short" || v === "full" ? v : null);

export async function GET(request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    const kind = kindOf(new URL(request.url).searchParams.get("kind"));
    return Response.json(await withWorkspaceAsync((ws) => singingView(ws, id, kind)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string; names?: unknown; slot?: unknown; clip?: unknown; kind?: unknown; line?: unknown; undo?: unknown };
  try {
    const kind = kindOf(body.kind);
    switch (body.action) {
      case "check": {
        const names = Array.isArray(body.names) ? body.names.map(String) : null;
        await withWorkspaceAsync((ws) => checkLipsync(ws, id, cardFace(), names));
        break;
      }
      case "accept":
        await withWorkspaceAsync((ws) => acceptSlot(ws, id, String(body.slot ?? ""), body.clip ? String(body.clip) : null, kind));
        break;
      case "ignore":
        withWorkspace((ws) => ignoreSuggestion(ws, id, String(body.slot ?? ""), String(body.clip ?? ""), body.undo !== true));
        break;
      case "split":
        withWorkspace((ws) => splitAfterLine(ws, id, Number(body.line), body.undo !== true));
        break;
      case "export": {
        const r = await withWorkspaceAsync((ws) => exportExcerpt(ws, id, String(body.slot ?? ""), kind));
        return Response.json({ folder: path.basename(r.folder), files: r.files });
      }
      default:
        throw new Error("Unknown action.");
    }
    return Response.json(await withWorkspaceAsync((ws) => singingView(ws, id, kind)));
  } catch (error) {
    return fail(error);
  }
}
