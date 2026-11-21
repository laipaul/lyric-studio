// Prepare → Pictures (G2): the song's picture board and the clips animated from it.
// GET: the pictures with their takes, the services (ready = a key in .env), prices, defaults, what was spent.
// POST multipart (pictures=<files>): adds pictures to the board under their own names.
// POST JSON { action: "animate", file, service, quality, takes, cap }: checks the cost against the cap, records the
//   takes and starts them (the request does not wait); { action: "mood", file, mood }; { action: "resume", file, n }:
//   fetches a take that was sent but did not come back (free).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";
import { addPictures, picturesView, runTakes, setMood, startAnimate, startResume, type Quality, type ServiceId } from "@lyric/video/animate";
import { connection } from "next/server";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });
const open = () => openWorkspace(resolveWorkspaceDir());
const safeName = (n: string) => path.basename(n).replace(/[^\w.\- ()]/g, "_");

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    return Response.json({ board: await withWorkspaceAsync((ws) => picturesView(ws, id)) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("pictures").filter((v): v is File => v instanceof File && v.size > 0);
      if (!files.length) throw new Error("Drop one or more pictures.");
      const tmp = path.join(resolveWorkspaceDir(), "cache", "uploads", randomUUID());
      mkdirSync(tmp, { recursive: true });
      try {
        const saved = await Promise.all(
          files.map(async (f, n) => {
            const file = path.join(tmp, `${n}-${safeName(f.name)}`);
            writeFileSync(file, Buffer.from(await f.arrayBuffer()));
            return { file, name: f.name };
          }),
        );
        return Response.json(await withWorkspaceAsync((ws) => addPictures(ws, id, saved)));
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; file?: unknown; service?: unknown; quality?: unknown; takes?: unknown; cap?: unknown; mood?: unknown; n?: unknown };
    const file = String(body.file ?? "");
    if (body.action === "mood") return Response.json({ mood: withWorkspace((ws) => setMood(ws, id, file, body.mood)) });
    if (body.action === "animate") {
      const started = withWorkspace((ws) => startAnimate(ws, id, file, { service: body.service as ServiceId, quality: body.quality as Quality, takes: Number(body.takes), capUsd: Number(body.cap) }));
      void runTakes(open, id, path.basename(file), started.takes.map((t) => t.n));
      return Response.json(started);
    }
    if (body.action === "resume") {
      const n = Number(body.n);
      const take = withWorkspace((ws) => startResume(ws, id, file, n));
      void runTakes(open, id, path.basename(file), [take.n]);
      return Response.json({ take });
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return fail(error);
  }
}
