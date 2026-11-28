// The dry vocal for lips (26 Nov 2026, Lip-sync review step 2; "Dry vocal for lips", 28 Nov 2026): copies of the vocal
// stem for the lip-sync model only. CLAUDE.md's exception agreed with Paul: in the song's .studio\lipsync-audio\
// folder, sent only to the lip-sync model; the stem is never changed and the copies never go into any video or output.
//   dry:  the reverb removed (anvuew's MelBand RoFormer de-reverb);
//   lead: the backing vocals removed (anvuew's BS RoFormer karaoke), then dry.
// Made once per stem content and kind by the audio service (services/audio/app/dereverb.py, audio-separator), kept for
// every later take; "Prepare dry vocal" (Lyrics Sync → Singer) makes them ahead, a take that needs one makes it first.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";

export const LIPSYNC_AUDIO_DIR = path.join(".studio", "lipsync-audio");
export type DryKind = "dry" | "lead";
// A new model: a new engine id, so a new file (the copies made by another model stay as they are).
const ENGINE: Record<DryKind, string> = { dry: "mbr-anvuew1", lead: "lead-bsr-anvuew1" };
const LEGACY_DRY = "uvr1"; // the first de-reverb (UVR DeEcho-DeReverb, 26 Nov 2026): still used where it was made
const making = new Map<string, Promise<string>>(); // copies being made now (this server), by file

// Where the copy of this stem lives (by the stem's content, so a replaced stem gets its own copy).
export function dereverbFile(songRoot: string, stem: string, kind: DryKind = "dry"): string {
  const h = createHash("sha256").update(readFileSync(stem)).digest("hex").slice(0, 16);
  return path.join(songRoot, LIPSYNC_AUDIO_DIR, `${h}-${kind === "lead" ? "lead" : "dereverb"}-${ENGINE[kind]}.wav`);
}

// Is the de-reverb installed (pnpm audio:setup --dereverb)? The stand-in counts as installed.
export function dryVocalInstalled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.LYRIC_DEREVERB_STUB || existsSync(path.join(REPO_ROOT, "services", "audio", ".venv", ".dereverb-requirements-sha256"));
}

// The state of a kind for this stem: ready (made), making (now), or none.
export function dryVocalState(songRoot: string, stem: string, kind: DryKind): "ready" | "making" | "none" {
  const out = dereverbFile(songRoot, stem, kind);
  if (making.has(out)) return "making";
  if (existsSync(out)) return "ready";
  if (kind === "dry" && existsSync(out.replace(`-${ENGINE.dry}.wav`, `-${LEGACY_DRY}.wav`))) return "ready";
  return "none";
}

// The copy, made the first time (seconds to minutes; the GPU when there is one); throws in plain words.
export function ensureDereverbed(songRoot: string, stem: string, env: NodeJS.ProcessEnv = process.env, kind: DryKind = "dry"): Promise<string> {
  const out = dereverbFile(songRoot, stem, kind);
  if (existsSync(out)) return Promise.resolve(out);
  const legacy = out.replace(`-${ENGINE.dry}.wav`, `-${LEGACY_DRY}.wav`);
  if (kind === "dry" && existsSync(legacy)) return Promise.resolve(legacy); // made before the better model: kept
  const running = making.get(out);
  if (running) return running;
  const job = new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "services", "audio", "scripts", "dereverb.mjs"), ...(kind === "lead" ? ["--lead"] : []), stem, out], {
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
      if (code === 3) return reject(new Error("The de-reverb is not installed yet: run  pnpm audio:setup --dereverb  once (on top of the AI packages), then try again"));
      reject(new Error(`the vocal could not be ${kind === "lead" ? "split into the lead vocal" : "de-reverbed"} (${err.trim().split(/\r?\n/).slice(-1)[0] ?? `exit ${code}`})`));
    });
  }).finally(() => making.delete(out));
  making.set(out, job);
  return job;
}
