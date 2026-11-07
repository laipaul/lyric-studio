// The song page's Storyboard (stage 1, read-only). GET: what it can show (a plan per platform, past
// runs); ?platform=reels&video=v1: that video's plan without rendering (the planner's dry run, the same
// code Generate renders with; &clips=song+wedding: over another clip set, the same textboard);
// ?run=<folder>&platform=reels&video=v1: a past run's video (its manifest).
// POST (stage 2): one edit: { action: "order", order } | { action: "clip", clip, edit } | { action:
// "anchor", line, clip, transition? } | { action: "unanchor", line } | omit | canvas | the timeline's roll / slip /
// timeline-reset / timeline (Undo, Redo); the tab then plans again.
import { connection } from "next/server";

import { STORYBOARD_ACTIONS, storyboardEdit, type StoryboardEdit } from "@lyric/video/storyboard-edit";

import { storyboardJson } from "@/lib/storyboard";
import { withWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  const q = new URL(request.url).searchParams;
  const platform = q.get("platform");
  const video = q.get("video") ?? "v1";
  const run = q.get("run");
  const clips = q.get("clips"); // the picture swap: "song+wedding", "city"
  try {
    const data = (await storyboardJson([id, ...(platform ? [platform, video, ...(run ? [run] : clips ? ["--clips", clips] : [])] : [])])) as { error?: string };
    if (data.error) return Response.json({ error: data.error }, { status: 400 });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as StoryboardEdit | null;
  // Every storyboard edit (Omit and Canvas were missing here before 7 Nov 2026, so Shape's "Omit this clip" was refused).
  if (!body || !(STORYBOARD_ACTIONS as readonly string[]).includes(body.action)) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return Response.json(withWorkspace((ws) => storyboardEdit(ws, id, body)));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
