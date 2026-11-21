// "Pick a frame from a video" (Characters, Creation). POST (form: video): evenly spaced frames from the video, ranked
// by the local face check (best first); the frames are served from workspace\frames\<session>\ for a day. The video is
// only read (the app works on its own copy, removed at once).
import { cardFace, framesFromVideo } from "@lyric/video/characters";

import { withWorkspaceAsync } from "@/lib/workspace";

export async function POST(request: Request) {
  try {
    const video = (await request.formData()).get("video");
    if (!(video instanceof File) || !video.size) throw new Error("Choose a video.");
    const bytes = Buffer.from(await video.arrayBuffer());
    return Response.json(await withWorkspaceAsync((ws) => framesFromVideo(ws, bytes, video.name, cardFace())));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
