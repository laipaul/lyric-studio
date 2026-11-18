// Prepare → Storyboard → Import shot list (C2). GET: the song's imported shot list (or null).
// POST { text, source?, import? }: checks the shot list (errors and warnings in plain words, what changes);
// with import: true it is imported (refused while the check finds errors).
import { connection } from "next/server";

import { checkSongShotList, importShotList, readShotList } from "@lyric/video/shotlist";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json({ shotlist: withWorkspace((ws) => readShotList(ws, id)) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; source?: unknown; import?: unknown };
  try {
    if (typeof body.text !== "string" || !body.text.trim()) throw new Error("Choose a shot list file (.json).");
    const text = body.text;
    const source = typeof body.source === "string" && body.source.trim() ? body.source : "shot list";
    if (body.import === true) return Response.json({ check: await withWorkspaceAsync((ws) => importShotList(ws, id, text, source)), imported: true });
    return Response.json({ check: withWorkspace((ws) => checkSongShotList(ws, id, text)), imported: false });
  } catch (error) {
    return fail(error);
  }
}
