// The local face checks (services/audio/app/face.py) for character and scene cards, run as a child process like the
// audio analysis: `node services/audio/scripts/face.mjs <command> …` (it installs the face packages the first time,
// pnpm audio:setup --face; the models download once). Asynchronous, so the studio stays responsive while it runs.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";

import type { FaceResult } from "./plan";

export type Reason = { level: "ok" | "info" | "fix" | "bad"; text: string; check: string };
export type CheckResult = { file: string; measures: Record<string, unknown>; verdict: "Ready" | "Usable with fix" | "Not suitable"; reasons: Reason[]; fixes?: string[] };
export type Calibration = {
  reference: string;
  same_picture: { variant: string; score: number | null }[];
  others: { file: string; frames: number; faces: number; best: number | null; mean: number | null; role?: string }[];
  thresholds: { red_below: number; green_from: number; top_other: number; others_used: number; her_used?: number; her_range?: [number, number] | null; copies?: number; overlap?: boolean; note: string | null };
};
export type SheetSpec = { out: string; title: string; height?: number; rows: { label: string; cells: { file: string; caption: string; colour: string }[] }[] };

export interface FaceTool {
  check(image: string): Promise<CheckResult>;
  sceneCheck(image: string): Promise<CheckResult>;
  compare(reference: string, files: string[]): Promise<{ results: (FaceResult & { file: string })[] }>;
  calibrate(reference: string, others: string[], her?: string[]): Promise<Calibration>;
  crop(image: string, out: string): Promise<{ file: string }>;
  cropBody(image: string, out: string): Promise<{ file: string; cropped: boolean; cut_y: number | null }>;
  sheet(spec: SheetSpec): Promise<{ file: string }>;
  rankFrames?(files: string[]): Promise<{ frames: { file: string; verdict: string; score: number; reasons: string[] }[] }>; // best first
}

function runFace<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "services", "audio", "scripts", "face.mjs"), ...args], {
      cwd: REPO_ROOT,
      // Windows pipes default to the ANSI code page: UTF-8 so accents and dashes survive.
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(out.trim().split(/\r?\n/).pop() ?? "") as T);
        } catch {
          reject(new Error(`face check: unreadable answer (${out.slice(-200)})`));
        }
        return;
      }
      const lines = err.trim().split(/\r?\n/).filter((l) => !/^(W0000|I0000|INFO:|WARNING: Logging|\[audio setup\]|\[face\])/.test(l));
      const last = lines[lines.length - 1] ?? "";
      const plain = /^ValueError: (.*)$/.exec(last);
      reject(new Error(plain ? plain[1] : `face check failed: ${lines.slice(-3).join(" | ")}`));
    });
  });
}

export function localFaceTool(): FaceTool {
  return {
    check: (image) => runFace(["check", image]),
    sceneCheck: (image) => runFace(["scene-check", image]),
    compare: (reference, files) => runFace(["compare", reference, ...files]),
    calibrate: (reference, others, her = []) => runFace(["calibrate", ...her.flatMap((h) => ["--her", h]), reference, ...others]),
    crop: (image, out) => runFace(["crop", image, out]),
    rankFrames: (files) => runFace(["rank-frames", ...files]),
    cropBody: (image, out) => runFace(["crop-body", image, out]),
    async sheet(spec) {
      const dir = mkdtempSync(path.join(os.tmpdir(), "sheet-"));
      const file = path.join(dir, "spec.json");
      try {
        writeFileSync(file, JSON.stringify(spec));
        return await runFace(["sheet", file]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
