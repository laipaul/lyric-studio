// Lyrics Sync → Singer (21 Nov 2026): the singing lines, each with the Creation picture or video it is sung from.
// GET: the lines with their vocal piece, cost and newest singing clip; what is left to make and its cost.
// POST { action: "line", line, source|null }: tick a line (or untick it with null) and choose what it is sung from.
// POST { action: "script", line, script }: the little script of the singing block that starts on that line (empty: none).
// POST { action: "make", lines? }: checks the cost against your Creation cap and makes the singing clips (the request
//   does not wait); each comes back into Creation, the Storyboard and onto its line, in time with the song.
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";
import { readCreationDefaults } from "@lyric/video/animate";
import { runSinging, setSingerLine, setSingerScript, singerView, startSinging } from "@lyric/video/singer";
import { connection } from "next/server";

import { withWorkspaceAsync, withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });
const open = () => openWorkspace(resolveWorkspaceDir());

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    const singer = await withWorkspaceAsync((ws) => singerView(ws, id));
    return Response.json({ singer, cap: readCreationDefaults(resolveWorkspaceDir()).cap });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; line?: unknown; source?: unknown; lines?: unknown; script?: unknown };
    if (body.action === "line") return Response.json({ settings: withWorkspace((ws) => setSingerLine(ws, id, body.line, body.source)) });
    if (body.action === "script") return Response.json({ settings: withWorkspace((ws) => setSingerScript(ws, id, body.line, body.script)) });
    if (body.action === "make") {
      const cap = readCreationDefaults(resolveWorkspaceDir()).cap;
      const lines = Array.isArray(body.lines) ? body.lines.map(Number).filter(Number.isInteger) : undefined;
      const started = await withWorkspaceAsync((ws) => startSinging(ws, id, { capUsd: cap, ...(lines ? { lines } : {}) }));
      void runSinging(open, id, started.jobs);
      return Response.json(started);
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return fail(error);
  }
}
