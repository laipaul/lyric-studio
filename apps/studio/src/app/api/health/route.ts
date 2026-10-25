// "Start Lyric Studio.cmd" waits for this before opening the app.
export function GET() {
  return Response.json({ ok: true, app: "Lyric Studio" });
}
