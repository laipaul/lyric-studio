// Prepare → Production (G1). GET: the song's production (cast linked from the shared library, which bible and its
// text, the shot list's state, the platform sizes). POST { action, … }:
//   "cast" { ids }: the cast (card ids from the Characters page, in order)
//   "bibleSource" { source: "song" | "ep" }: the song's own bible or its EP's shared one
//   "bible" { text }: saves the bible text (the earlier text goes to Replaced files)
//   "brief": the Song brief (Markdown) to copy into Claude
//   "paste" { text }: what a pasted answer is (a shot list, checked like an imported file, or a story bible)
import { connection } from "next/server";

import { productionData, readPasted, saveBible, setBibleSource, setCast, songBrief, timedLines } from "@lyric/video/production";
import { checkSongShotList } from "@lyric/video/shotlist";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json({ production: await withWorkspaceAsync(async (ws) => productionData(ws, id, await timedLines(ws, id))) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; ids?: unknown; source?: unknown; text?: unknown };
  try {
    switch (body.action) {
      case "cast":
        return Response.json({ cast: withWorkspace((ws) => setCast(ws, id, body.ids)) });
      case "bibleSource":
        return Response.json({ source: withWorkspace((ws) => setBibleSource(ws, id, body.source)) });
      case "bible":
        return Response.json(withWorkspace((ws) => saveBible(ws, id, body.text)));
      case "brief":
        return Response.json({ brief: await withWorkspaceAsync(async (ws) => songBrief(ws, id, await timedLines(ws, id))) });
      case "paste": {
        const pasted = readPasted(typeof body.text === "string" ? body.text : "");
        if (pasted.kind !== "shotlist") return Response.json({ pasted });
        return Response.json({ pasted, check: withWorkspace((ws) => checkSongShotList(ws, id, pasted.json)) });
      }
      default:
        throw new Error("Unknown action.");
    }
  } catch (error) {
    return fail(error);
  }
}
