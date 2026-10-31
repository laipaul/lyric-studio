// The Shape page's Theme panel. POST { action, ... } (answers with the song's Style data, themes included):
//   use { name }: this song uses that theme;  create { name, from }: "+ New theme" (named first, started
//   from another theme; the song uses it);  save { look, perPlatform }: the editor's look into the song's
//   theme (every song that uses it);  saveAs { name, look, perPlatform }: the editor's look as a new theme
//   this song uses;  rename { from?, name }: a theme's new name (its folder and every song follow);
//   remove { name }: Delete (to themes\_removed\, refused while songs use it);  restore { folder }.
import { loadFontCatalog } from "@lyric/video/font-catalog";
import { readRecipe } from "@lyric/video/recipe";
import { songPathsById } from "@lyric/video/song-folder";
import { styleData } from "@lyric/video/style";
import { chooseTheme, createTheme, removeTheme, renameTheme, restoreTheme, saveTheme, saveThemeAs } from "@lyric/video/themes";

import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
type Body = { action?: string; name?: string; from?: string; folder?: string; theme?: string; look?: unknown; perPlatform?: unknown }; // theme: the theme being edited (default: the song's)

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const name = String(body.name ?? "").trim();
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
        if (body.action === "use") {
          if (!name) throw new Error("Which theme?");
          chooseTheme(ws, id, name, catalog);
        } else if (body.action === "create") createTheme(ws, { projectId: id, name, from: String(body.from ?? "") || current(), catalog });
        else if (body.action === "save") saveTheme(ws, { projectId: id, theme: body.theme, look: body.look, perPlatform: body.perPlatform, catalog });
        else if (body.action === "saveAs") saveThemeAs(ws, { projectId: id, theme: body.theme, name, look: body.look, perPlatform: body.perPlatform, catalog });
        else if (body.action === "rename") {
          if (!name) throw new Error("Give the theme a name.");
          renameTheme(ws, String(body.from ?? "") || current(), name);
        } else if (body.action === "remove") removeTheme(ws, name, catalog);
        else if (body.action === "restore") restoreTheme(ws.dir, String(body.folder ?? ""));
        else throw new Error("Unknown action.");
        return styleData(ws, id);
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
