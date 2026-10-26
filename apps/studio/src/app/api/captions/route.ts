// "Ready to post": the caption + hashtags (or YouTube title / description / tags) for one video, and
// "make <artist>'s own template" (copied into WORKSPACE_DIR\brand\<artist>\ to edit, e.g. in French).
import { readFileSync } from "node:fs";
import path from "node:path";

import { project } from "@lyric/db";
import { makeOwnCaptionTemplate, postingPack } from "@lyric/video/captions";
import { songEp } from "@lyric/video/project-settings";
import { songPathsById } from "@lyric/video/song-folder";
import { eq } from "drizzle-orm";

import { EXPORT_FILE } from "@/lib/files";
import { withWorkspace } from "@/lib/workspace";

type ManifestBits = { platform?: { name: string }; lyric_timings?: { text: string; is_hook: boolean }[] };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId") ?? "";
  const video = params.get("video") ?? "";
  if (!EXPORT_FILE.test(video) || video.includes("..") || !video.endsWith(".manifest.json")) return Response.json({ error: "Not a video of this song" }, { status: 400 });
  try {
    return Response.json(
      withWorkspace((ws) => {
        const p = ws.db.select().from(project).where(eq(project.id, projectId)).get();
        if (!p) throw new Error("Song not found");
        if (!video.startsWith(`${songPathsById(ws, projectId).exportsRel}/`)) throw new Error("Not a video of this song");
        const file = path.join(ws.dir, ...video.split("/"));
        const m = JSON.parse(readFileSync(file, "utf8")) as ManifestBits;
        const platform = m.platform?.name ?? "standard";
        return postingPack(ws, {
          platform,
          artist: p.artist,
          song: p.title,
          ep: songEp(ws, projectId) ?? null,
          hook: m.lyric_timings?.find((l) => l.is_hook)?.text ?? null,
          publishFile: path.join(path.dirname(file), "publish.txt"),
        });
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const { projectId, platform } = (await request.json()) as { projectId?: string; platform?: string };
  if (!projectId || !platform || !["standard", "reels", "tiktok", "shorts"].includes(platform)) return Response.json({ error: "projectId and a short-form platform are needed" }, { status: 400 });
  try {
    return Response.json(
      withWorkspace((ws) => {
        const p = ws.db.select().from(project).where(eq(project.id, projectId)).get();
        if (!p) throw new Error("Song not found");
        return { file: makeOwnCaptionTemplate(ws.dir, p.artist, platform) };
      }),
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
