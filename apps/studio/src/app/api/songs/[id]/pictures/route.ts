// Prepare → Creation (G2): the song's creation space: pictures and videos from anywhere, and the takes animated here.
// GET: the pictures with their takes, the services (ready = a key in .env), prices, defaults, what was spent.
// POST multipart (pictures=<files>): adds pictures and videos under their own names; { action: "link", url }: adds the
//   picture or video a link leads to (any outside source).
// POST JSON { action: "animate", file, service, quality, takes, cap }: checks the cost against the cap, records the
//   takes and starts them (the request does not wait); { action: "mood", file, mood }; { action: "resume", file, n }:
//   fetches a take that was sent but did not come back (free); { action: "send", file, n? }: Send to Storyboard (the
//   picture, or its take n): a copy joins the end of the song's clips; { action: "defaults", defaults }: Paul's own
//   defaults for every song (service, quality, takes, cap: workspace\creation.json).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";
import { addFromLink, addPictures, picturesView, setItemLabel, runTakes, saveCreationDefaults, sendToStoryboard, setMood, startAnimate, startResume, type Quality, type ServiceId } from "@lyric/video/animate";
import { runSinging, withSongStarts } from "@lyric/video/singer";
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
    // Each finished take with the song second its first frame belongs to (Creation plays it with the song).
    return Response.json({ board: await withWorkspaceAsync(async (ws) => withSongStarts(ws, id, await picturesView(ws, id))) });
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
      if (!files.length) throw new Error("Drop one or more pictures or videos.");
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
    if (body.action === "link") return Response.json(await withWorkspaceAsync((ws) => addFromLink(ws, id, (body as { url?: unknown }).url)));
    if (body.action === "label") {
      const n = body.n === undefined || body.n === null ? null : Number(body.n);
      return Response.json({ label: withWorkspace((ws) => setItemLabel(ws, id, file, n, (body as { label?: unknown }).label)) });
    }
    if (body.action === "mood") return Response.json({ mood: withWorkspace((ws) => setMood(ws, id, file, body.mood)) });
    if (body.action === "animate") {
      const started = withWorkspace((ws) => startAnimate(ws, id, file, { service: body.service as ServiceId, quality: body.quality as Quality, takes: Number(body.takes), capUsd: Number(body.cap) }));
      void runTakes(open, id, path.basename(file), started.takes.map((t) => t.n));
      return Response.json(started);
    }
    if (body.action === "defaults") return Response.json({ defaults: saveCreationDefaults(resolveWorkspaceDir(), (body as { defaults?: unknown }).defaults) });
    if (body.action === "send") {
      const n = body.n === undefined || body.n === null ? null : Number(body.n);
      return Response.json(await withWorkspaceAsync((ws) => sendToStoryboard(ws, id, file, n)));
    }
    if (body.action === "resume") {
      const n = Number(body.n);
      const take = withWorkspace((ws) => startResume(ws, id, file, n));
      if (take.kind === "lipsync") void runSinging(open, id, [{ source: path.basename(file), n: take.n }]);
      else void runTakes(open, id, path.basename(file), [take.n]);
      return Response.json({ take });
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return fail(error);
  }
}
