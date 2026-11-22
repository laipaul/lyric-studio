// A Film look's reference still. POST (multipart): "name" (the look) and one "file" (JPG / PNG / WebP, a screenshot
// works): saved as film-looks\<name>\still.<ext>; the still it replaces goes to the folder's .replaced\. Answers with
// the Film looks page's data.
import { filmLooksPage, setFilmLookStill } from "@lyric/video/film-looks";
import { writerReady } from "@lyric/video/film-look-writer";

import { withWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const value = form.get("file");
    if (!(value instanceof File) || !value.size) throw new Error("Choose a picture.");
    const data = Buffer.from(await value.arrayBuffer());
    return Response.json(
      withWorkspace((ws) => {
        setFilmLookStill(ws.dir, name, data, value.name);
        return filmLooksPage(ws, writerReady());
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
