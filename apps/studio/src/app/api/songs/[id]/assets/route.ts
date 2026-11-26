// The song page's Assets tab. GET: the song's files and clips. POST (multipart): "clips" = files
// dropped on the clips area (copied into the song's clips\), or "kind" = song | lyrics | cover |
// hints | vocals | backingVocals with one "file" (kept under its own name; the old one is kept in
// .studio\replaced\; vocals: the vocal stem, checked against the song and the lyric timing queued again
// on it), or "kind" = assign with "name" and "role" (lyrics | vocals | backingVocals | notUsed): "What is
// this file?" for a file put into the song folder by hand, or "kind" = restoreClip with "name" (back from
// clips\_removed\). DELETE ?name= : the clip moves to clips\_removed\ (never deleted).
// PUT { order: [clip file names] }: the song's clips in a new order (drag and drop; clips.json, the same
// sequence Shape shows and Make uses). PUT { omit: { name, omit } }: Use / Omit on one clip. PUT { note: { name, text } }:
// a clip's story note (Prepare → Clips; empty text deletes it; only shown, never used by the app).
// The story line (11 Nov 2026): GET also returns "story" (the song's own clips, clips picked from a shared collection
// and "the app picks" cards, in order). PUT { story: [keys] }: the whole line in a new order. PUT { add: { collection,
// clips, whole } }: "From a collection…". DELETE ?story=<key>: a collection clip or card out of this song only.
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { cardTags } from "@lyric/video/characters";
import { assignSongFile, importSongClips, setSongStoryIdea, removeSongClip, replaceAsset, restoreSongClip, setSongClipNote, setSongClipCast, setSongClipLabel, setSongClipOmit, setSongClipOrder, songAssets, storeVocalStem, type AssetKind, type AssignRole } from "@lyric/video/assets";

import { addFromCollection, isPickedClip, removeFromStory, setPickedClipNote, setPickedClipOmit, setStoryOrder, songStory } from "@lyric/video/story-line";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(
      await withWorkspaceAsync(async (ws) => {
        const assets = await songAssets(ws, id);
        // castTags: every character card by id, removed ones too (the Storyboard's cast chips).
        return { ...assets, story: assets.folder ? (await songStory(ws, id, assets.clips)).items : [], castTags: cardTags(ws) };
      }),
    );
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
    const body = (await request.json()) as {
      order?: unknown;
      story?: unknown;
      add?: { collection?: unknown; clips?: unknown; whole?: unknown };
      omit?: { name?: unknown; omit?: unknown };
      note?: { name?: unknown; text?: unknown };
      label?: { name?: unknown; label?: unknown }; // a clip's short name (the file keeps its name)
      cast?: { name?: unknown; ids?: unknown }; // who appears in a clip: character card ids (display only)
      storyIdea?: unknown; // Prepare → Storyboard's one sentence for the whole video (for the user only)
    };
    if (body.storyIdea !== undefined) return Response.json({ storyIdea: withWorkspace((ws) => setSongStoryIdea(ws, id, body.storyIdea)) });
    const picked = (ws: Parameters<typeof isPickedClip>[0], name: unknown) => typeof name === "string" && !!isPickedClip(ws, id, name);
    if (body.note)
      return Response.json({
        note: await withWorkspaceAsync((ws) => (picked(ws, body.note!.name) ? setPickedClipNote(ws, id, String(body.note!.name), String(body.note!.text ?? "")) : setSongClipNote(ws, id, body.note!.name, body.note!.text))),
      });
    if (body.cast) return Response.json({ cast: withWorkspace((ws) => setSongClipCast(ws, id, body.cast!.name, body.cast!.ids)) });
    if (body.label) return Response.json({ label: withWorkspace((ws) => setSongClipLabel(ws, id, body.label!.name, body.label!.label)) });
    if (body.omit)
      return Response.json({
        omit: await withWorkspaceAsync(async (ws) => (picked(ws, body.omit!.name) ? setPickedClipOmit(ws, id, String(body.omit!.name), body.omit!.omit === true) : setSongClipOmit(ws, id, body.omit!.name, body.omit!.omit))),
      });
    if (body.add) return Response.json({ added: await withWorkspaceAsync((ws) => addFromCollection(ws, id, body.add!.collection, body.add!.clips, body.add!.whole)) });
    if (body.story !== undefined) return Response.json({ story: await withWorkspaceAsync((ws) => setStoryOrder(ws, id, body.story)) });
    return Response.json({ order: await withWorkspaceAsync(async (ws) => setSongClipOrder(ws, id, body.order)) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const name = search.get("name") ?? "";
  try {
    if (search.has("story")) return Response.json({ removedFrom: await withWorkspaceAsync((ws) => removeFromStory(ws, id, search.get("story"))) });
    return Response.json({ movedTo: await withWorkspaceAsync((ws) => removeSongClip(ws, id, name)) });
  } catch (error) {
    return fail(error);
  }
}
