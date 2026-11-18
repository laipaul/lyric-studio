// The local recast judge (services/audio/app/recast_judge.py): face, environment and motion, in plain words.
import { spawnSync } from "node:child_process";
import path from "node:path";

export type Level = "ok" | "warn" | "problem" | "info";
export type Judgement = {
  frames: number;
  face: { level: Level; text: string; share_matching: number | null; median: number | null; weakest: { t: number; score: number } | null; old_face_at: number[]; green_from: number };
  environment: { level: Level; text: string; ssim: number | null; colour: number | null; background_share: number | null };
  motion: { level: Level; text: string; pose_distance: number | null; flow_correlation: number | null; camera_drift: number | null };
};
export type JudgeFn = (o: { original: string; result: string; refs: string[]; green: number }) => Promise<Judgement | { error: string }>;

export function localJudge(repoRoot: string): JudgeFn {
  return async ({ original, result, refs, green }) => {
    const script = path.join(repoRoot, "services", "audio", "scripts", "recast-judge.mjs");
    const args = [script, "--original", original, "--result", result, ...refs.flatMap((r) => ["--reference", r]), "--green", String(green)];
    const r = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    const line = (r.stdout || "").trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
    if (!line) return { error: `the local judge gave no answer (${(r.stderr || "").trim().split(/\r?\n/).slice(-2).join(" | ") || `exit ${r.status}`})` };
    try {
      return JSON.parse(line) as Judgement | { error: string };
    } catch {
      return { error: "the local judge's answer could not be read" };
    }
  };
}

// One line per result, in the app's words: "Ready to use" / "Good — N things to improve: …" / "Not usable: …".
export function verdict(j: Judgement | null, fitNote: string | null): string {
  if (!j) return "Not judged.";
  const parts = [j.face, j.environment, j.motion];
  const problems = parts.filter((p) => p.level === "problem").map((p) => p.text);
  const warns = parts.filter((p) => p.level === "warn").map((p) => p.text);
  if (fitNote) warns.push(fitNote);
  if (problems.length) return `Not usable yet: ${problems.join(" ")}${warns.length ? ` Also: ${warns.join(" ")}` : ""}`;
  if (warns.length) return `Good — ${warns.length === 1 ? "one thing" : `${warns.length} things`} to improve: ${warns.join(" ")}`;
  return "Ready to use: the character, the scene and the movement all hold.";
}
