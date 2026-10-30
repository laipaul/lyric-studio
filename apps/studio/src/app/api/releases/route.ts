// Releases. GET: every release with its grid summary, the removed ones and the songs to choose from.
// POST { name, songs }: a new release. POST { restore }: a removed release comes back.
import { connection } from "next/server";

import { createRelease, listReleases, releaseCandidates, releaseView, removedReleases, restoreRelease } from "@lyric/video/releases";

import { withWorkspace } from "@/lib/workspace";

const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET() {
  await connection();
  try {
    return Response.json(
      withWorkspace((ws) => ({
        releases: listReleases(ws).map((r) => {
          const v = releaseView(ws, r.name);
          return { name: v.name, songs: v.rows.length, ready: v.ready, total: v.total, cover: v.cover, titles: v.rows.map((x) => x.title) };
        }),
        removed: removedReleases(ws),
        candidates: releaseCandidates(ws),
      })),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const { name, songs, restore } = (await request.json()) as { name?: string; songs?: string[]; restore?: string };
    if (restore) return Response.json({ name: withWorkspace((ws) => restoreRelease(ws, String(restore))) });
    return Response.json(withWorkspace((ws) => createRelease(ws, String(name ?? ""), Array.isArray(songs) ? songs.map(String) : [])));
  } catch (error) {
    return fail(error);
  }
}
