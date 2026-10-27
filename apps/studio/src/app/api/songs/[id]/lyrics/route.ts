// The song page's Lyrics tab. GET: every line (stamp, start now, what the viewer sees, flags) and
// lyrics.txt with its label lines. POST { action: "times", changes: [{ number, ms | null }] }: hand-set
// starts into hints.lrc (the stored alignment is kept); { action: "text", text }: a new lyrics.txt (the
// old one kept in .studio\replaced\); { action: "restore", file }: an earlier lyrics.txt back;
// { action: "ear", number, checked }: "checked by ear" on a line (clears its timing warnings in QA).
import { connection } from "next/server";

import { lyricsView, restoreLyrics, saveHandTimes, saveLyricsText, setCheckedByEar } from "@lyric/video/lyrics-view";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(await withWorkspaceAsync((ws) => lyricsView(ws, id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { action?: string; changes?: { number: number; ms: number | null }[]; text?: string; file?: string; number?: number; checked?: boolean };
    if (body.action === "ear") {
      await withWorkspaceAsync((ws) => setCheckedByEar(ws, id, Number(body.number), body.checked === true));
      return Response.json({ ok: true });
    }
    if (body.action === "times") return Response.json({ handSet: await withWorkspaceAsync((ws) => saveHandTimes(ws, id, body.changes ?? [])) });
    if (body.action === "text") return Response.json(withWorkspace((ws) => saveLyricsText(ws, id, String(body.text ?? ""))));
    if (body.action === "restore") return Response.json(withWorkspace((ws) => restoreLyrics(ws, id, String(body.file ?? ""))));
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}
