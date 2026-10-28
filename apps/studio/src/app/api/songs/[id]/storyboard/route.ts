// The song page's Storyboard (stage 1, read-only). GET: what it can show (a plan per platform, past
// runs); ?platform=reels&video=v1: that video's plan without rendering (the planner's dry run, the same
// code Generate renders with); ?run=<folder>&platform=reels&video=v1: a past run's video (its manifest).
import { connection } from "next/server";

import { storyboardJson } from "@/lib/storyboard";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  const q = new URL(request.url).searchParams;
  const platform = q.get("platform");
  const video = q.get("video") ?? "v1";
  const run = q.get("run");
  try {
    const data = (await storyboardJson([id, ...(platform ? [platform, video, ...(run ? [run] : [])] : [])])) as { error?: string };
    if (data.error) return Response.json({ error: data.error }, { status: 400 });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
