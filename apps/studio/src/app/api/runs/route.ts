// Generate: queues a run for the worker with the panel's choices (a new cover is stored first).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveWorkspaceDir, safeName } from "@lyric/db";
import { platformLabels } from "@lyric/video/library";
import { storeCover } from "@lyric/video/project-settings";
import { songRuns } from "@lyric/video/exports";
import { checkRunRequest, enqueueRun, generateOptions, type RunRequest } from "@lyric/video/runs";
import { saveRunToSong } from "@lyric/video/style";

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
    const { run, saved } = withWorkspace((ws) => {
      if (coverFile) storeCover(ws, projectId, coverFile);
      const options = generateOptions(ws, projectId, req);
      // Compare looks (11 Nov 2026): one video per platform per look, each with its own shot plan (a try); first the
      // song's own v1 wherever a platform has none yet (the baseline); nothing is saved to the song.
      if (req.compare) {
        const own = new Set(songRuns(ws, projectId).flatMap((r) => r.platforms.flatMap((p) => p.videos.filter((v) => !v.try && v.mark.status !== "discarded").map(() => p.name))));
        const missing = req.platforms.filter((p) => !own.has(p));
        const baseline = missing.length ? [enqueueRun(ws, projectId, { ...generateOptions(ws, projectId, { platforms: missing, counts: Object.fromEntries(missing.map((p) => [p, 1])) }) }, `${missing.join(", ")} · your look (to compare with)`)] : [];
        const tries = req.themes?.length ? req.themes.map((theme) => enqueueRun(ws, projectId, { ...options, theme: theme.trim() }, `Compare looks: theme ${theme.trim()}`)) : [enqueueRun(ws, projectId, options, `Compare looks: pictures ${(req.pictures ?? []).join(" / ")}`)];
        const all = [...baseline, ...tries];
        return { run: { id: all[0].id, label: `Compare looks: ${req.themes?.length ? req.themes.join(", ") : (req.pictures ?? []).join(" / ")}${baseline.length ? ` (and your look for ${missing.join(", ")})` : ""}` }, saved: null };
      }
      // "Save to song": this run's choices become the song's own settings (locked ones stay).
      const saved = req.saveToSong ? saveRunToSong(ws, projectId, options) : null;
      return { run: enqueueRun(ws, projectId, options), saved };
    });
    return Response.json({ id: run.id, label: run.label, saved });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
