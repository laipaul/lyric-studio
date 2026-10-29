// One collection. GET: its clips (thumbnails, orientation, length, duplicates), what was removed and the
// songs that use it. POST (multipart "clips"): files copied in (content already there is not copied).
// DELETE ?clip=: the clip moves to _removed\ (never deleted). DELETE ?whole=1: the whole collection moves to
// collections\_removed\ and the songs stop naming it. PATCH { restore }: a removed clip comes back;
// PATCH { rename }: the collection gets a new name (the songs follow).
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { collectionDetail, importCollectionClips, removeCollection, removeCollectionClip, renameCollection, restoreCollectionClip } from "@lyric/video/collections";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ name: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { name } = await params;
  try {
    return Response.json(await withWorkspaceAsync((ws) => collectionDetail(ws, decodeURIComponent(name))));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { name } = await params;
  const form = await request.formData();
  const tmp = path.join(resolveWorkspaceDir(), "cache", "uploads", randomUUID());
  mkdirSync(tmp, { recursive: true });
  try {
    const files = form.getAll("clips").filter((v): v is File => v instanceof File && v.size > 0);
    if (!files.length) return Response.json({ error: "Drop one or more videos or photos." }, { status: 400 });
    const saved = await Promise.all(
      files.map(async (value, n) => {
        const file = path.join(tmp, `${n}-${safeName(value.name)}`);
        writeFileSync(file, Buffer.from(await value.arrayBuffer()));
        return { file, name: value.name };
      }),
    );
    return Response.json(await withWorkspaceAsync((ws) => importCollectionClips(ws, decodeURIComponent(name), saved)));
  } catch (error) {
    return fail(error);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { name } = await params;
  const query = new URL(request.url).searchParams;
  const clip = query.get("clip") ?? "";
  try {
    if (query.get("whole") === "1") return Response.json(withWorkspace((ws) => removeCollection(ws, decodeURIComponent(name))));
    return Response.json({ movedTo: await withWorkspaceAsync((ws) => removeCollectionClip(ws, decodeURIComponent(name), clip)) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { name } = await params;
  try {
    const { restore, rename } = (await request.json()) as { restore?: string; rename?: string };
    if (rename !== undefined) return Response.json({ name: withWorkspace((ws) => renameCollection(ws, decodeURIComponent(name), String(rename))) });
    return Response.json({ restored: withWorkspace((ws) => restoreCollectionClip(ws, decodeURIComponent(name), String(restore ?? ""))) });
  } catch (error) {
    return fail(error);
  }
}
