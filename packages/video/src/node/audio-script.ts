// A Node script of services/audio run as a child process; its last messages go into the error when it fails.
import { spawn } from "node:child_process";
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";

// The useful part of the aligner's last messages (not progress bars).
export function alignFailure(lines: readonly string[]): string {
  const useful = lines.filter((l) => !/^\d+%|it\/s\]$|^\[?[#=\-> ]+\]?$/.test(l));
  return (useful.length ? useful : lines).slice(-4).join("\n") || "no message";
}

export function runAudioScript(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "services/audio/scripts", script), ...args], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const tail: string[] = [];
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/[\r\n]+/)) if (line.trim()) tail.push(line.trim());
      tail.splice(0, Math.max(0, tail.length - 6));
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(alignFailure(tail)))));
  });
}
