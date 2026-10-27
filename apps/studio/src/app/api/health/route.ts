// "Start Lyric Studio.cmd" waits for this before opening the app, and compares "build" with the code
// (an older build still running is restarted). The build stamp is written by pnpm app:serve / app:rebuild.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";

export async function GET() {
  await connection(); // read on every request (never prerendered at build time, before the stamp exists)
  const stamp = path.join(process.cwd(), ".next", "lyric-studio-build.txt");
  const [build, commit] = existsSync(stamp) ? readFileSync(stamp, "utf8").trim().split(/\s+/) : ["unknown", "unknown"];
  return Response.json({ ok: true, app: "Lyric Studio", build, commit: commit ?? "unknown" }, { headers: { "Cache-Control": "no-store" } });
}
