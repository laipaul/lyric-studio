// A still frame for each finished video (the studio's exports grid), made once with FFmpeg and cached
// in WORKSPACE_DIR\cache\posters by the video's path, size and date.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

import { absPath, ffmpegBin, type Workspace } from "@lyric/db";

export async function videoPoster(ws: Workspace, mp4: string, atSeconds = 2): Promise<string> {
  const file = absPath(ws, mp4);
  const st = statSync(file);
  const key = createHash("sha256").update(`${mp4}|${st.size}|${st.mtimeMs}|v1`).digest("hex").slice(0, 20);
  const out = path.join(ws.dir, "cache", "posters", `${key}.jpg`);
  if (existsSync(out)) return out;
  mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.part.jpg`;
  const grab = (at: number) =>
    new Promise<void>((resolve, reject) =>
      execFile(ffmpegBin(), ["-y", "-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", tmp], { windowsHide: true, timeout: 60_000 }, (e, _o, err) =>
        e ? reject(new Error(`ffmpeg could not take a frame: ${err || e.message}`)) : resolve(),
      ),
    );
  await grab(atSeconds);
  if (!existsSync(tmp)) await grab(0); // a video shorter than atSeconds
  renameSync(tmp, out);
  return out;
}
