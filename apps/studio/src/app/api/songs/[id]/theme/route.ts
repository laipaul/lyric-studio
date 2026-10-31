// The Shape page's Theme panel. POST { action: "use", name }: this song uses that theme (song.json
// "theme"); { action: "duplicate", name? }: a copy of the song's theme ("Name copy"), which this song then
// uses; { action: "rename", name }: the song's theme gets a new name (its folder and every song that uses
// it follow). Answers with the song's Style data (themes included).
import { duplicateTheme, renameTheme, chooseTheme } from "@lyric/video/themes";
import { loadFontCatalog } from "@lyric/video/font-catalog";
import { readRecipe } from "@lyric/video/recipe";
import { songPathsById } from "@lyric/video/song-folder";
import { styleData } from "@lyric/video/style";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string; name?: string } | null;
  const name = String(body?.name ?? "").trim();
  try {
    return Response.json(
      withWorkspace((ws) => {
        const catalog = loadFontCatalog(ws.dir);
        const current = () => {
          const file = songPathsById(ws, id).recipe;
          const theme = file ? readRecipe(file).theme : undefined;
          if (!theme) throw new Error("This song has no theme yet: open its Shape page once.");
          return theme;
        };
        if (body?.action === "use") {
          if (!name) throw new Error("Which theme?");
          chooseTheme(ws, id, name, catalog);
        } else if (body?.action === "duplicate") {
          chooseTheme(ws, id, duplicateTheme(ws.dir, current(), name || undefined), catalog);
        } else if (body?.action === "rename") {
          if (!name) throw new Error("Give the theme a name.");
          renameTheme(ws, current(), name);
        } else throw new Error("Unknown action.");
        return styleData(ws, id);
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
