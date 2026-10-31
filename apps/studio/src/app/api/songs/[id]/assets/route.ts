// The song page's Assets tab. GET: the song's files and clips. POST (multipart): "clips" = files
// dropped on the clips area (copied into the song's clips\), or "kind" = song | lyrics | cover |
// hints | vocals with one "file" (the old one is kept in .studio\replaced\; vocals: Suno's vocal stem,
// checked against the song and the lyric timing queued again on it). DELETE ?name= : the clip moves to
// clips\_removed\ (never deleted).
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { importSongClips, removeSongClip, replaceAsset, songAssets, storeVocalStem, type AssetKind } from "@lyric/video/assets";

import { withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(await withWorkspaceAsync((ws) => songAssets(ws, id)));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const form = await request.formData();
  const tmp = path.join(resolveWorkspaceDir(), "cache", "uploads", randomUUID());
  mkdirSync(tmp, { recursive: true });
  const save = async (value: File, n: number) => {
    const file = path.join(tmp, `${n}-${safeName(value.name)}`);
    writeFileSync(file, Buffer.from(await value.arrayBuffer()));
    return { file, name: value.name };
  };
  try {
    const kind = String(form.get("kind") ?? "clips");
    if (kind === "clips") {
      const files = form.getAll("clips").filter((v): v is File => v instanceof File && v.size > 0);
      if (!files.length) return Response.json({ error: "Drop one or more videos or photos." }, { status: 400 });
      const saved = await Promise.all(files.map(save));
      return Response.json(await withWorkspaceAsync((ws) => importSongClips(ws, id, saved)));
    }
    if (!["song", "lyrics", "cover", "hints", "vocals"].includes(kind)) return Response.json({ error: "Unknown kind of file." }, { status: 400 });
    const value = form.get("file");
    if (!(value instanceof File) || !value.size) return Response.json({ error: "Choose a file." }, { status: 400 });
    const one = await save(value, 0);
    // The Suno vocal stem: checked against the song at once, then the lyric timing is queued again on it.
    if (kind === "vocals") return Response.json(await withWorkspaceAsync((ws) => storeVocalStem(ws, id, one.file, one.name)));
    const stored = await withWorkspaceAsync((ws) => replaceAsset(ws, id, kind as AssetKind, one.file, one.name));
    return Response.json({ stored });
  } catch (error) {
    return fail(error);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const name = new URL(request.url).searchParams.get("name") ?? "";
  try {
    return Response.json({ movedTo: await withWorkspaceAsync((ws) => removeSongClip(ws, id, name)) });
  } catch (error) {
    return fail(error);
  }
}
