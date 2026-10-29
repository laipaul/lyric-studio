// The Collections page. GET: every shared collection with its counts and the songs that use it.
// POST { name }: a new, empty collection (workspace\collections\<name>\).
import { connection } from "next/server";

import { listCollections, newCollection } from "@lyric/video/collections";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET() {
  await connection();
  try {
    return Response.json({ collections: await withWorkspaceAsync((ws) => listCollections(ws)) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const { name } = (await request.json()) as { name?: string };
    return Response.json({ name: withWorkspace((ws) => newCollection(ws, String(name ?? ""))) });
  } catch (error) {
    return fail(error);
  }
}
