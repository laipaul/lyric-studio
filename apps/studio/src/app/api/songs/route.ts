// "+ New song": the uploaded files are saved under their own names in a temporary folder of the
// workspace, then createSong stores them with the project (found by the song's content: no
// duplicates). The temporary folder is removed afterwards.
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { createSong } from "@lyric/video/library";

import { withWorkspaceAsync } from "@/lib/workspace";

export async function POST(request: Request) {
  const form = await request.formData();
  const tmp = path.join(resolveWorkspaceDir(), "cache", "uploads", randomUUID());
  mkdirSync(tmp, { recursive: true });
  try {
    const save = async (field: string) => {
      const value = form.get(field);
      if (!(value instanceof File) || !value.size) return undefined;
      const file = path.join(tmp, `${field}-${safeName(value.name)}`.replace(/^song-/, ""));
      writeFileSync(file, Buffer.from(await value.arrayBuffer()));
      return file;
    };
    const text = (field: string) => {
      const value = form.get(field);
      return typeof value === "string" ? value : undefined;
    };
    const files = { song: await save("song"), lyrics: await save("lyrics"), cover: await save("cover"), hints: await save("hints") };
    const result = await withWorkspaceAsync((ws) =>
      createSong(ws, {
        ...files,
        song: files.song ?? "",
        lyrics: files.lyrics ?? "",
        hintsName: form.get("hints") instanceof File ? (form.get("hints") as File).name : undefined,
        lyricsName: form.get("lyrics") instanceof File ? (form.get("lyrics") as File).name : undefined,
        title: text("title"),
        artist: text("artist"),
        ep: text("ep"),
        instrumental: text("instrumental") === "true",
      }),
    );
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
