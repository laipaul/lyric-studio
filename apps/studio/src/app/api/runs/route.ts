// Generate: queues a run for the worker with the panel's choices (a new cover is stored first).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { platformLabels } from "@lyric/video/library";
import { storeCover } from "@lyric/video/project-settings";
import { checkRunRequest, enqueueRun, generateOptions, type RunRequest } from "@lyric/video/runs";

import { withWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");
  let req: RunRequest;
  try {
    req = JSON.parse(String(form.get("request") ?? "{}")) as RunRequest;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const problems = checkRunRequest(req, platformLabels().map((p) => p.name));
  if (problems.length) return Response.json({ error: problems.join("\n") }, { status: 400 });
  const cover = form.get("cover");
  const tmp = path.join(resolveWorkspaceDir(), "cache", "uploads", randomUUID());
  try {
    let coverFile: string | null = null;
    if (cover instanceof File && cover.size) {
      if (!/\.(jpe?g|png|webp)$/i.test(cover.name)) return Response.json({ error: "The cover must be a JPG, PNG or WEBP picture." }, { status: 400 });
      mkdirSync(tmp, { recursive: true });
      coverFile = path.join(tmp, safeName(cover.name));
      writeFileSync(coverFile, Buffer.from(await cover.arrayBuffer()));
    }
    const run = withWorkspace((ws) => {
      if (coverFile) storeCover(ws, projectId, coverFile);
      return enqueueRun(ws, projectId, generateOptions(ws, projectId, req));
    });
    return Response.json({ id: run.id, label: run.label });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
