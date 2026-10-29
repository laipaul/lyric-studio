// One collection. GET: its clips (thumbnails, orientation, length, duplicates), what was removed and the
// songs that use it. POST (multipart "clips"): files copied in (content already there is not copied).
// DELETE ?clip=: the clip moves to _removed\ (never deleted). PATCH { restore }: a removed clip comes back.
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { collectionDetail, importCollectionClips, removeCollectionClip, restoreCollectionClip } from "@lyric/video/collections";

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
  const clip = new URL(request.url).searchParams.get("clip") ?? "";
  try {
    return Response.json({ movedTo: await withWorkspaceAsync((ws) => removeCollectionClip(ws, decodeURIComponent(name), clip)) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { name } = await params;
  try {
    const { restore } = (await request.json()) as { restore?: string };
    return Response.json({ restored: withWorkspace((ws) => restoreCollectionClip(ws, decodeURIComponent(name), String(restore ?? ""))) });
  } catch (error) {
    return fail(error);
  }
}
