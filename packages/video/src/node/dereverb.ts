// The de-reverbed copy of the vocal stem for the lip-sync drafts (26 Nov 2026, Lip-sync review step 2; CLAUDE.md's
// exception agreed with Paul: in the song's .studio\lipsync-audio\ folder, sent only to the lip-sync model; the stem is
// never changed and the copy never goes into any video or output). Made once per stem content by the audio service
// (services/audio/app/dereverb.py, UVR DeEcho-DeReverb), kept for every later take.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";

export const LIPSYNC_AUDIO_DIR = path.join(".studio", "lipsync-audio");
const ENGINE = "uvr1"; // a new de-reverb: a new file

// Where the copy of this stem lives (by the stem's content, so a replaced stem gets its own copy).
export function dereverbFile(songRoot: string, stem: string): string {
  const h = createHash("sha256").update(readFileSync(stem)).digest("hex").slice(0, 16);
  return path.join(songRoot, LIPSYNC_AUDIO_DIR, `${h}-dereverb-${ENGINE}.wav`);
}

// The de-reverbed copy, made the first time (minutes on a CPU, seconds on a GPU); throws in plain words.
export function ensureDereverbed(songRoot: string, stem: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const out = dereverbFile(songRoot, stem);
  if (existsSync(out)) return Promise.resolve(out);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "services", "audio", "scripts", "dereverb.mjs"), stem, out], {
      cwd: REPO_ROOT,
      env: { ...env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && existsSync(out)) return resolve(out);
      if (code === 3) return reject(new Error("The de-reverb is not installed yet: run  pnpm audio:setup --dereverb  once (on top of the AI packages), then make the take again"));
      reject(new Error(`the vocal could not be de-reverbed (${err.trim().split(/\r?\n/).slice(-1)[0] ?? `exit ${code}`})`));
    });
  });
}
