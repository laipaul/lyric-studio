// The card's pictures (form: picture; replace?). "Add a second picture" of the same character: sent as a second
// reference, checked at once. replace=reference: "Replace picture" (cleanup.ts): a new picture for the card, the old
// one kept under Earlier pictures with Restore; checked at once like a new card's picture.
import { addCardSecondPicture, cardFace, checkCardPicture, replaceReference } from "@lyric/video/characters";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const picture = form.get("picture");
    if (!(picture instanceof File) || !picture.size) throw new Error("Choose a picture.");
    const bytes = Buffer.from(await picture.arrayBuffer());
    if (form.get("replace") === "reference") {
      withWorkspace((ws) => replaceReference(ws, id, bytes, picture.name));
      let checkError: string | undefined;
      try {
        await withWorkspaceAsync((ws) => checkCardPicture(ws, id, cardFace()));
      } catch (error) {
        checkError = (error as Error).message; // the picture is in; "Check again" on the page
      }
      return Response.json({ ok: true, checkError });
    }
    await withWorkspaceAsync((ws) => addCardSecondPicture(ws, id, cardFace(), bytes, picture.name));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
