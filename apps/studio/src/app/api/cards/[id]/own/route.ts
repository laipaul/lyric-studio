// "Use my own picture" / "Add my pack" (form: picture, one or more; slot, optional): the user's own pictures into the
// draft's pack slots, free and local (face checks, neck crop for the body views). Answers where each one went.
import { cardFace, useOwnPictures } from "@lyric/video/characters";

import { withWorkspaceAsync } from "@/lib/workspace";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const slot = String(form.get("slot") ?? "") || null;
    const files = form.getAll("picture").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("Choose a picture.");
    const pictures = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()), slot: files.length === 1 ? slot : null })));
    return Response.json(await withWorkspaceAsync((ws) => useOwnPictures(ws, id, cardFace(), pictures)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
