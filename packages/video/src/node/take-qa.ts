// Takes QA (26 Nov 2026): every returned singing take is checked on this PC against the picture it was made from
// (face.py takecheck, judged by src/take-qa.ts), and the result is kept on the take (take.qa). "Trim to good part"
// makes a new, shorter take of the good stretch (nothing deleted). Local and free.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, uniqueFileName, type Workspace } from "@lyric/db";

import { judgeTake, type TakeQa } from "../take-qa";
import { BOARD_VIDEO_FILE, nextTakeN, readPictures, setTake, songFolder, TAKES_DIR, update, type Take } from "./animate";
import type { FaceTool } from "./characters/face";

// The take's frames measured and judged; saved on the take. Never throws (a check that cannot run says why).
export async function checkTake(dir: string, source: string, n: number, face: FaceTool, refPicture?: string): Promise<TakeQa | null> {
  const t = readPictures(dir).pictures[source]?.takes.find((x) => x.n === n);
  if (!t?.file || !existsSync(path.join(dir, t.file))) return null;
  const at = new Date().toISOString();
  if (!face.takecheck) {
    setTake(dir, source, n, { qa: { checked_at: at, segments: [], good: null, duration: 0, note: "face checks not available" } });
    return null;
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-qa-"));
  try {
    // The reference: the picture the take was made from (a video source: its first frame).
    let ref = refPicture ?? path.join(dir, source);
    if (!refPicture && BOARD_VIDEO_FILE.test(source)) {
      ref = path.join(tmp, "ref.png");
      execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", path.join(dir, source), "-frames:v", "1", ref], { windowsHide: true });
    }
    const m = await face.takecheck(ref, path.join(dir, t.file));
    const qa = judgeTake(m.frames, m.duration, at);
    setTake(dir, source, n, { qa });
    return qa;
  } catch (error) {
    const note = /not installed|No module|setup/i.test(String(error)) ? "face checks not installed (pnpm audio:setup --face)" : `face check failed: ${(error as Error).message}`;
    setTake(dir, source, n, { qa: { checked_at: at, segments: [], good: null, duration: 0, note } });
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// "Trim to good part": a new take of the good stretch at the start of the take (its first frame stays at the same song
// time, so it stays in time), ending where the face goes wrong. Refused when the bad part is at the start or comes
// before the first line is sung (a retake is the fix then). lines: the song's lines (number, sung end).
export function trimTake(dir: string, source: string, n: number, lines: readonly { number: number; sungEndMs: number }[]): Take {
  const t = readPictures(dir).pictures[source]?.takes.find((x) => x.n === n);
  if (!t?.file || t.kind !== "lipsync" || !t.line || t.sync_ms === undefined || t.to_ms === undefined) throw new Error("No such singing take.");
  const q = t.qa;
  if (!q?.segments.length) throw new Error("This take has no bad part to trim.");
  const firstBad = Math.min(...q.segments.map((s) => s.fromS));
  if (firstBad < 0.5) throw new Error("The face goes wrong right at the start: make it again (Retake draft) instead.");
  const keepMs = Math.round(firstBad * 1000);
  const endMs = t.sync_ms + keepMs;
  const firstLine = lines.find((l) => l.number === t.line);
  if (firstLine && firstLine.sungEndMs > endMs) throw new Error(`The face goes wrong before line ${t.line} is sung to its end: make it again (Retake draft) instead.`);
  const covered = lines.filter((l) => l.number >= t.line! && l.number <= (t.through ?? t.line!) && l.sungEndMs <= endMs).map((l) => l.number);
  const through = covered.length ? Math.max(...covered) : t.line;
  const takesDir = path.join(dir, TAKES_DIR);
  mkdirSync(takesDir, { recursive: true });
  const out = uniqueFileName(takesDir, `${path.parse(t.file).name} trimmed.mp4`);
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", path.join(dir, t.file), "-t", (keepMs / 1000).toFixed(3), "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(takesDir, out)], { windowsHide: true });
  let made: Take | undefined;
  update(dir, source, (p) => {
    const { request_id: _r, parts: _p, final: _f, sent: _s, clip: _c, fresh: _fr, review: _rv, qa: _q, ...rest } = t;
    made = {
      ...rest,
      n: nextTakeN(p),
      status: "done",
      file: `${TAKES_DIR}/${out}`,
      playable: true,
      to_ms: endMs,
      ...(through > t.line! ? { through } : { through: undefined }),
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      cost_usd: 0,
      trimmedOf: t.n,
      qa: { checked_at: new Date().toISOString(), segments: [], good: { fromS: 0, toS: keepMs / 1000 }, duration: keepMs / 1000 },
    };
    if (made.through === undefined) delete made.through;
    p.takes.push(made);
  });
  return made!;
}

export const songDirOf = (ws: Workspace, projectId: string) => songFolder(ws, projectId).dir;
