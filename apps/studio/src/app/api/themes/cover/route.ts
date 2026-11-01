// The Theme cover (Themes page → a theme → Theme cover). POST (multipart): "name" (the theme) and one
// "file" (JPG / PNG / WebP): copied into themes\<name>\cover.<ext>; the cover it replaces goes to the theme
// folder's _replaced\. DELETE ?name= : the cover goes to _replaced\ too (the previews show a neutral
// backdrop again). Both answer with the Themes page's data.
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { themesPageWithFrames } from "@lyric/video/style";
import { removeThemeCover, setThemeCover } from "@lyric/video/themes";

import { withWorkspaceAsync } from "@/lib/workspace";

const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function POST(request: Request) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const value = form.get("file");
  if (!(value instanceof File) || !value.size) return fail(new Error("Choose a picture."));
  const tmp = path.join(resolveWorkspaceDir(), "cache", "uploads", randomUUID());
  mkdirSync(tmp, { recursive: true });
  try {
    const file = path.join(tmp, safeName(value.name) || "cover");
    writeFileSync(file, Buffer.from(await value.arrayBuffer()));
    return Response.json(
      await withWorkspaceAsync(async (ws) => {
        setThemeCover(ws.dir, name, file, value.name);
        return themesPageWithFrames(ws);
      }),
    );
  } catch (error) {
    return fail(error);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function DELETE(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  try {
    return Response.json(
      await withWorkspaceAsync(async (ws) => {
        removeThemeCover(ws.dir, name);
        return themesPageWithFrames(ws);
      }),
    );
  } catch (error) {
    return fail(error);
  }
}
