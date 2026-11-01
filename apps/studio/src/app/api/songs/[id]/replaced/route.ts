// Assets → Replaced files. GET: the files kept in the song folder's .studio\replaced\ and what each one was.
// POST { file }: Restore makes it that again (the one in use now is kept there in its place).
import { connection } from "next/server";

import { restoreReplacedFile, songReplacedFiles } from "@lyric/video/replaced-files";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json({ files: withWorkspace((ws) => songReplacedFiles(ws, id)) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { file?: unknown };
  try {
    return Response.json(await withWorkspaceAsync((ws) => restoreReplacedFile(ws, id, String(body.file ?? ""))));
  } catch (error) {
    return fail(error);
  }
}
