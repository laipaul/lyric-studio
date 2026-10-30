// Make all. GET: what would be made (song by song), what cannot be made yet and why, and an estimate.
// POST: queue it (one run per song: its missing platforms, one video each).
import { connection } from "next/server";

import { makeAll, makeAllPlan } from "@lyric/video/releases";

import { withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ name: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { name } = await params;
  try {
    return Response.json(await withWorkspaceAsync((ws) => makeAllPlan(ws, decodeURIComponent(name))));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(_request: Request, { params }: Params) {
  const { name } = await params;
  try {
    return Response.json(await withWorkspaceAsync((ws) => makeAll(ws, decodeURIComponent(name))));
  } catch (error) {
    return fail(error);
  }
}
