// Lyrics Sync → Singer (21 Nov 2026): the singing lines, each with the Creation picture or video it is sung from.
// GET: the lines with their vocal piece, cost and newest singing clip; what is left to make and its cost.
// POST { action: "line", line, source|null }: tick a line (or untick it with null) and choose what it is sung from.
// POST { action: "script", line, script }: the little script of the singing block that starts on that line (empty: none).
// POST { action: "resolution", resolution }: "480p" or "720p" for the takes made from now on (singer.json).
// POST { action: "retake", line }: the group that starts on that line again, as a new take (cost against the cap).
// POST { action: "use", source, n }: that take on its lines now (nothing re-made); { action: "seen", source, n }: watched.
// POST { action: "make", lines? }: checks the cost against your Creation cap and makes the singing clips (the request
//   does not wait); each comes back into Creation, the Storyboard and onto its line, in time with the song.
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";
import { readCreationDefaults } from "@lyric/video/animate";
import { runSinging, seenSingingTake, setSingerLine, setSingerResolution, setSingerScript, singerView, startRetake, startSinging, chooseSingingTake, nudgeSingingTake, setSingerVoice, setSingingReview, trimSingingTake } from "@lyric/video/singer";
import { runFinal, startFinal } from "@lyric/video/final";
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
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; line?: unknown; source?: unknown; lines?: unknown; script?: unknown; resolution?: unknown; n?: unknown; draft?: unknown; verdict?: unknown; reasons?: unknown; note?: unknown; ms?: unknown; voice?: unknown };
    // The lip-sync review (26 Nov 2026): a verdict on a take, the free nudge, the audio per group, Make final.
    if (body.action === "review") return Response.json({ review: withWorkspace((ws) => setSingingReview(ws, id, body.source, body.n, body.verdict, body.reasons, body.note)) });
    if (body.action === "nudge") return Response.json({ nudge_ms: withWorkspace((ws) => nudgeSingingTake(ws, id, body.source, body.n, body.ms)) });
    // Takes QA: a new take of the good stretch (nothing deleted).
    if (body.action === "trim") return Response.json({ take: await withWorkspaceAsync((ws) => trimSingingTake(ws, id, body.source, body.n)) });
    if (body.action === "voice") return Response.json({ settings: withWorkspace((ws) => setSingerVoice(ws, id, body.line, body.voice)) });
    if (body.action === "final") {
      const take = withWorkspace((ws) => startFinal(ws, id, String(body.source ?? ""), body.n));
      void runFinal(open, id, String(body.source ?? ""), take.n);
      return Response.json({ take });
    }
    if (body.action === "line") return Response.json({ settings: withWorkspace((ws) => setSingerLine(ws, id, body.line, body.source)) });
    if (body.action === "script") return Response.json({ settings: withWorkspace((ws) => setSingerScript(ws, id, body.line, body.script)) });
    if (body.action === "resolution") return Response.json({ settings: withWorkspace((ws) => setSingerResolution(ws, id, body.resolution)) });
    if (body.action === "use") return Response.json(await withWorkspaceAsync((ws) => chooseSingingTake(ws, id, body.source, body.n)));
    if (body.action === "seen") return Response.json({ ok: withWorkspace((ws) => (seenSingingTake(ws, id, body.source, body.n), true)) });
    if (body.action === "retake") {
      const cap = readCreationDefaults(resolveWorkspaceDir()).cap;
      const started = await withWorkspaceAsync((ws) => startRetake(ws, id, { capUsd: cap, line: body.line, draft: body.draft === true }));
      void runSinging(open, id, started.jobs);
      return Response.json(started);
    }
    if (body.action === "make") {
      const cap = readCreationDefaults(resolveWorkspaceDir()).cap;
      const lines = Array.isArray(body.lines) ? body.lines.map(Number).filter(Number.isInteger) : undefined;
      const started = await withWorkspaceAsync((ws) => startSinging(ws, id, { capUsd: cap, draft: body.draft === true, ...(lines ? { lines } : {}) }));
      void runSinging(open, id, started.jobs);
      return Response.json(started);
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return fail(error);
  }
}
