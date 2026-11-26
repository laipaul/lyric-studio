// Performance script (Part B, 26 Nov 2026; node/performance-script.ts, node/music-cues.ts).
// GET: the script with each entry's staleness, and the cached music cues (energy curve and events, for Shape's band).
// POST { action }:
//   "analyse" { fresh? }: measure the music cues now (local; minutes the first time when Demucs makes the stems)
//   "request" { scope: song | reel | slots }: the "Copy script request" text for claude.ai (measures the cues if needed)
//   "paste" { text }: Claude's answer into the script (unrecognised parts listed)
//   "edit" { key, patch }: one entry (or key "song": Sings to / Objective) edited, or marked checked
import { connection } from "next/server";

import { cachedMusicCues, musicCues } from "@lyric/video/music-cues";
import { editScript, pasteScript, scriptRequestFor, scriptView, setAllChecked } from "@lyric/video/performance-script-node";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

function cuesSummary(id: string) {
  return withWorkspace((ws) => {
    const c = cachedMusicCues(ws, id);
    return c ? { stems: c.stems, vocals: c.vocals, block_s: c.block_s, duration_ms: c.duration_ms, energy: c.energy, events: c.events, made_at: c.made_at, segments: c.segments.map((s) => ({ key: s.key, cue: s.cue })) } : null;
  });
}

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    const view = await withWorkspaceAsync((ws) => scriptView(ws, id));
    return Response.json({ ...view, cues: cuesSummary(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; scope?: unknown; text?: unknown; key?: unknown; patch?: unknown; fresh?: unknown; checked?: unknown };
  try {
    switch (body.action) {
      case "analyse":
        await withWorkspaceAsync((ws) => musicCues(ws, id, { fresh: body.fresh === true }));
        return Response.json({ cues: cuesSummary(id) });
      case "request": {
        const scope = body.scope === "reel" || body.scope === "slots" ? body.scope : "song";
        const r = await withWorkspaceAsync((ws) => scriptRequestFor(ws, id, scope));
        return Response.json({ ...r, cues: cuesSummary(id) });
      }
      case "paste": {
        const r = await withWorkspaceAsync((ws) => pasteScript(ws, id, String(body.text ?? "")));
        return Response.json({ ...r, ...(await withWorkspaceAsync((ws) => scriptView(ws, id))) });
      }
      case "check-all": // Mark all checked (stale entries excepted) / Untick all
        await withWorkspaceAsync((ws) => setAllChecked(ws, id, body.checked === true));
        return Response.json(await withWorkspaceAsync((ws) => scriptView(ws, id)));
      case "edit":
        await withWorkspaceAsync((ws) => editScript(ws, id, String(body.key ?? ""), (body.patch ?? {}) as Record<string, unknown>));
        return Response.json(await withWorkspaceAsync((ws) => scriptView(ws, id)));
      default:
        throw new Error(`Unknown action "${String(body.action)}".`);
    }
  } catch (error) {
    return fail(error);
  }
}
