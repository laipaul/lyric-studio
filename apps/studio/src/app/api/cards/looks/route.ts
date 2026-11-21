// Every character with its looks (the Wardrobe) and their pictures, for "From a character" in Creation: a look's
// picture is added to the song's pictures, to animate or to sing with. Read only.
import { connection } from "next/server";

import { cardRoot, listCards, listLooks, readCardFile } from "@lyric/video/characters";

import { withWorkspace } from "@/lib/workspace";

export async function GET() {
  await connection();
  try {
    const characters = withWorkspace((ws) =>
      listCards(ws)
        .filter((c) => c.kind === "character")
        .map((c) => {
          const root = cardRoot(ws, c);
          return { id: c.id, name: c.name, looks: listLooks(root, readCardFile(root)).map((l) => ({ id: l.id, name: l.name, locked: l.status === "locked", views: l.views.filter((v) => v.file) })).filter((l) => l.views.length) };
        })
        .filter((c) => c.looks.length),
    );
    return Response.json({ characters }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
