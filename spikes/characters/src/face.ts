// The local face checks (services/audio/app/face.py), run with the audio service's own Python. The first use installs
// the face packages (pnpm audio:setup --face) and downloads the models (about 52 MB). Nothing goes over the network
// after that: the checks run on this PC.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { FaceResult } from "./plan";

export type Reason = { level: "ok" | "info" | "fix" | "bad"; text: string; check: string };
export type CheckResult = { file: string; measures: Record<string, unknown>; verdict: "Ready" | "Usable with fix" | "Not suitable"; reasons: Reason[]; fixes?: string[] };
export type Calibration = {
  reference: string;
  same_picture: { variant: string; score: number | null }[];
  others: { file: string; frames: number; faces: number; best: number | null; mean: number | null; role: "her" | "copy" | "other"; probably_same: boolean }[];
  thresholds: { red_below: number; green_from: number; top_other: number; others_used: number; her_used: number; her_range: [number, number] | null; copies: number; overlap: boolean; lowest_same: number | null; sface_default: number; note: string | null };
};
export type SheetSpec = { out: string; title: string; height?: number; rows: { label: string; cells: { file: string; caption: string; colour: string }[] }[] };

export interface FaceTool {
  check(image: string): CheckResult;
  sceneCheck(image: string): CheckResult;
  compare(reference: string, files: string[]): { results: (FaceResult & { file: string })[] };
  calibrate(reference: string, others: string[], her?: string[]): Calibration;
  crop(image: string, out: string): { file: string };
  sheet(spec: SheetSpec): { file: string };
}

// A dynamic import() of an absolute path needs a file:// URL: Node's ESM loader rejects "D:\..." on Windows.
export function importUrl(file: string, win = process.platform === "win32" || /^[A-Za-z]:[\\/]/.test(file)): string {
  return pathToFileURL(file, { windows: win }).href;
}

export async function localFaceTool(repoRoot: string): Promise<FaceTool> {
  const scripts = path.join(repoRoot, "services", "audio", "scripts");
  const common = (await import(importUrl(path.join(scripts, "common.mjs")))) as { faceReady(): boolean; venvPython: string; serviceDir: string };
  if (!common.faceReady()) {
    console.log("Installing the local face checks (first time only: MediaPipe + OpenCV, about 120 MB)…");
    const setup = (await import(importUrl(path.join(scripts, "setup.mjs")))) as { setupFace(): void };
    setup.setupFace();
  }
  const run = <T>(args: string[]): T => {
    const r = spawnSync(common.venvPython, ["-m", "app.face", ...args], { cwd: common.serviceDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0) {
      const err = (r.stderr || "").trim().split(/\r?\n/).filter((l) => !/^(W0000|I0000|INFO:|WARNING: Logging)/.test(l));
      const last = err[err.length - 1]?.match(/^ValueError: (.+)$/); // a plain message from the face tool: no traceback
      if (last) throw new Error(last[1]);
      throw new Error(`face check failed: ${err.slice(-3).join(" | ")}`);
    }
    return JSON.parse(r.stdout) as T;
  };
  return {
    check: (image) => run(["check", image]),
    sceneCheck: (image) => run(["scene-check", image]),
    compare: (reference, files) => run(["compare", reference, ...files]),
    calibrate: (reference, others, her = []) => run(["calibrate", ...her.flatMap((h) => ["--her", h]), reference, ...others]),
    crop: (image, out) => run(["crop", image, out]),
    sheet(spec) {
      const dir = mkdtempSync(path.join(os.tmpdir(), "sheet-"));
      const file = path.join(dir, "spec.json");
      try {
        writeFileSync(file, JSON.stringify(spec));
        return run(["sheet", file]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
