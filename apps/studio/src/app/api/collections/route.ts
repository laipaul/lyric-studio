// The Collections page. GET: every shared collection with its counts and the songs that use it.
// POST { name }: a new, empty collection (workspace\collections\<name>\). POST { restore }: a removed
// collection (collections\_removed\<folder>) comes back.
import { connection } from "next/server";

import { listCollections, newCollection, removedCollections, restoreCollection } from "@lyric/video/collections";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET() {
  await connection();
  try {
    return Response.json(await withWorkspaceAsync(async (ws) => ({ collections: await listCollections(ws), removed: removedCollections(ws) })));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const { name, restore } = (await request.json()) as { name?: string; restore?: string };
    if (restore) return Response.json({ name: withWorkspace((ws) => restoreCollection(ws, String(restore))) });
    return Response.json({ name: withWorkspace((ws) => newCollection(ws, String(name ?? ""))) });
  } catch (error) {
    return fail(error);
  }
}
