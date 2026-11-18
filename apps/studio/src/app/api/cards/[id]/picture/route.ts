// "Add a second picture" of the same character (form: picture): sent as a second reference, checked at once.
import { addCardSecondPicture, cardFace } from "@lyric/video/characters";

import { withWorkspaceAsync } from "@/lib/workspace";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const picture = (await request.formData()).get("picture");
    if (!(picture instanceof File) || !picture.size) throw new Error("Choose a picture.");
    const bytes = Buffer.from(await picture.arrayBuffer());
    await withWorkspaceAsync((ws) => addCardSecondPicture(ws, id, cardFace(), bytes, picture.name));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
