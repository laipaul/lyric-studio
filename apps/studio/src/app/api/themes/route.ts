// The Themes page. GET: every theme with its songs, the fonts, sample lyric lines, the songs and the
// deleted themes. POST { action }: use { projectId, name } (a song uses the theme) · duplicate { name,
// newName? } · rename { from, name } · details { name, description?, author? } · remove { name } (to
// themes\_removed\) · restore { folder } · create { name, from } (a new theme, named first). Each answers with the page's data.
import { connection } from "next/server";

import { loadFontCatalog } from "@lyric/video/font-catalog";
import { themesPageData } from "@lyric/video/style";
import { chooseTheme, duplicateTheme, newTheme, removeTheme, renameTheme, restoreTheme, setThemeDetails } from "@lyric/video/themes";

import { withWorkspace } from "@/lib/workspace";

type Body = { action?: string; projectId?: string; name?: string; newName?: string; from?: string; folder?: string; description?: string; author?: string };

export async function GET() {
  await connection();
  try {
    return Response.json(withWorkspace((ws) => themesPageData(ws)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const name = String(body.name ?? "").trim();
  try {
    return Response.json(
      withWorkspace((ws) => {
        const catalog = loadFontCatalog(ws.dir);
        if (body.action === "use") chooseTheme(ws, String(body.projectId ?? ""), name, catalog);
        else if (body.action === "create") newTheme(ws.dir, name, String(body.from ?? ""));
        else if (body.action === "duplicate") duplicateTheme(ws.dir, name, body.newName);
        else if (body.action === "rename") renameTheme(ws, String(body.from ?? ""), name);
        else if (body.action === "details") setThemeDetails(ws.dir, name, { description: body.description, author: body.author });
        else if (body.action === "remove") removeTheme(ws, name, catalog);
        else if (body.action === "restore") restoreTheme(ws.dir, String(body.folder ?? ""));
        else throw new Error("Unknown action.");
        return themesPageData(ws);
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
