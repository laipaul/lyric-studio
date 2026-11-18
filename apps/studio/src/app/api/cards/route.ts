// The Characters page. GET: every character and scene card. POST (form: kind, name, picture): a new card from one
// picture; its reference check (or location check) runs at once, locally and for free.
import { connection } from "next/server";

import { cardFace, checkCardPicture, createCard, listCards } from "@lyric/video/characters";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET() {
  await connection();
  try {
    return Response.json(withWorkspace((ws) => ({ cards: listCards(ws) })), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const kind = form.get("kind") === "scene" ? "scene" : "character";
    const picture = form.get("picture");
    if (!(picture instanceof File) || !picture.size) throw new Error("Choose a picture.");
    const bytes = Buffer.from(await picture.arrayBuffer());
    const row = withWorkspace((ws) => createCard(ws, { kind, name: String(form.get("name") ?? ""), picture: bytes, fileName: picture.name }));
    let checkError: string | undefined;
    try {
      await withWorkspaceAsync((ws) => checkCardPicture(ws, row.id, cardFace()));
    } catch (error) {
      checkError = (error as Error).message; // the card exists; "Check again" on its page
    }
    return Response.json({ id: row.id, checkError });
  } catch (error) {
    return fail(error);
  }
}
