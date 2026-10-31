// One song. PATCH { title }: a new title (the song folder follows). DELETE: "Delete song" (the folder moves to
// songs\_removed\, nothing is deleted). POST { action: "restore" }: back in the Library.
import { removeSong, renameSong, restoreSong } from "@lyric/video/library";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  try {
    return Response.json({ title: withWorkspace((ws) => renameSong(ws, id, String(body?.title ?? ""))) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    return Response.json({ movedTo: withWorkspace((ws) => removeSong(ws, id)) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  try {
    if (body?.action !== "restore") throw new Error("Unknown action.");
    return Response.json({ folder: withWorkspace((ws) => restoreSong(ws, id)) });
  } catch (error) {
    return fail(error);
  }
}
