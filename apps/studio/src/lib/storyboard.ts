// Server-side: the Storyboard tab's data, from packages/video/scripts/storyboard.ts run in its own Node
// process (the planner imports the render code, which the studio's server does not bundle).
import { spawn } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "../.."); // apps/studio -> project root

export function storyboardJson(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tsx = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(process.execPath, [tsx, path.join(REPO_ROOT, "packages/video/scripts/storyboard.ts"), ...args], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => {
      try {
        // The JSON is the last line (the planner may print notes before it).
        resolve(JSON.parse(out.trim().split("\n").pop() ?? ""));
      } catch {
        reject(new Error(`The storyboard could not be planned:\n${(err || out).slice(-2000)}`));
      }
    });
  });
}
