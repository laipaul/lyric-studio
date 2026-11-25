// The Film looks page (film-looks.ts). GET: every look, the removed ones and whether the app can write a line from a
// still. POST { action, ... } (answers with the same data):
//   create { name, line?, midjourney? }: "New film look";  save { name, newName?, line?, midjourney?, feel?, scope }: scope
//   "all" changes the look for every song that uses it (a new name renames it, the songs follow), "new" saves a copy;
//   write { name }: the app writes the line and the Midjourney words from the still (the user's Gemini key; saved
//   straight away, every song with the look gets it on its next take);  remove { name } (to _removed\, refused while a
//   song uses it);  restore { folder }.
import path from "node:path";

import { filmLooksPage, createFilmLook, readFilmLook, removeFilmLook, restoreFilmLook, saveFilmLook, filmLookFolder } from "@lyric/video/film-looks";
import { writeLookFromStill, writerReady } from "@lyric/video/film-look-writer";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

const page = () => withWorkspace((ws) => filmLooksPage(ws, writerReady()));
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET() {
  try {
    return Response.json(page());
  } catch (error) {
    return fail(error);
  }
}

type Body = { action?: string; name?: string; newName?: string; line?: string; midjourney?: string; feel?: string; scope?: string; folder?: string };

export async function POST(request: Request) {
  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const name = String(body.name ?? "").trim();
  try {
    if (body.action === "write") {
      await withWorkspaceAsync(async (ws) => {
        const look = readFilmLook(ws.dir, name);
        if (!look) throw new Error(`No Film look "${name}".`);
        if (!look.still) throw new Error("Drop a still first (a ShotDeck screenshot with its data block, a Midjourney frame or a photo).");
        const w = await writeLookFromStill(path.join(filmLookFolder(ws.dir, name), look.still));
        saveFilmLook(ws, name, { line: w.line, midjourney: w.midjourney, scope: "all" });
      });
      return Response.json(page());
    }
    withWorkspace((ws) => {
      if (body.action === "create") createFilmLook(ws.dir, { name, line: body.line, midjourney: body.midjourney });
      else if (body.action === "save") saveFilmLook(ws, name, { name: body.newName, line: body.line, midjourney: body.midjourney, feel: body.feel, scope: body.scope === "new" ? "new" : "all" });
      else if (body.action === "remove") removeFilmLook(ws, name);
      else if (body.action === "restore") restoreFilmLook(ws.dir, String(body.folder ?? ""));
      else throw new Error("Unknown action.");
    });
    return Response.json(page());
  } catch (error) {
    return fail(error);
  }
}
