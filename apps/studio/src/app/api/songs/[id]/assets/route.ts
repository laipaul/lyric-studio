// The song page's Assets tab. GET: the song's files and clips. POST (multipart): "clips" = files
// dropped on the clips area (copied into the song's clips\), or "kind" = song | lyrics | cover |
// hints | vocals | backingVocals with one "file" (kept under its own name; the old one is kept in
// .studio\replaced\; vocals: the vocal stem, checked against the song and the lyric timing queued again
// on it), or "kind" = assign with "name" and "role" (lyrics | vocals | backingVocals | notUsed): "What is
// this file?" for a file put into the song folder by hand, or "kind" = restoreClip with "name" (back from
// clips\_removed\). DELETE ?name= : the clip moves to clips\_removed\ (never deleted).
// PUT { order: [clip file names] }: the song's clips in a new order (drag and drop; clips.json, the same
// sequence Shape shows and Make uses).
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { assignSongFile, importSongClips, removeSongClip, replaceAsset, restoreSongClip, setSongClipOrder, songAssets, storeVocalStem, type AssetKind, type AssignRole } from "@lyric/video/assets";

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
    if (kind === "restoreClip") {
      const name = String(form.get("name") ?? "");
      return Response.json({ restored: await withWorkspaceAsync(async (ws) => restoreSongClip(ws, id, name)) });
    }
    if (kind === "assign") {
      const name = String(form.get("name") ?? "");
      const role = String(form.get("role") ?? "");
      if (!["lyrics", "vocals", "backingVocals", "notUsed"].includes(role)) return Response.json({ error: "Choose what the file is." }, { status: 400 });
      return Response.json({ stored: await withWorkspaceAsync((ws) => assignSongFile(ws, id, name, role as AssignRole)) });
    }
    if (!["song", "lyrics", "cover", "hints", "vocals", "backingVocals"].includes(kind)) return Response.json({ error: "Unknown kind of file." }, { status: 400 });
    const value = form.get("file");
    if (!(value instanceof File) || !value.size) return Response.json({ error: "Choose a file." }, { status: 400 });
    const one = await save(value, 0);
    // The vocal stem: checked against the song at once, then the lyric timing is queued again on it.
    if (kind === "vocals") return Response.json(await withWorkspaceAsync((ws) => storeVocalStem(ws, id, one.file, one.name)));
    const stored = await withWorkspaceAsync((ws) => replaceAsset(ws, id, kind as AssetKind, one.file, one.name));
    return Response.json({ stored });
  } catch (error) {
    return fail(error);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { order?: unknown };
    return Response.json({ order: await withWorkspaceAsync(async (ws) => setSongClipOrder(ws, id, body.order)) });
  } catch (error) {
    return fail(error);
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
