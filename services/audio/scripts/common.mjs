// Shared helpers for the audio service scripts (Windows, macOS and Linux).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const venvDir = path.join(serviceDir, ".venv");
export const isWindows = process.platform === "win32";

// Python inside the project-local virtual environment.
export const venvPython = isWindows
  ? path.join(venvDir, "Scripts", "python.exe")
  : path.join(venvDir, "bin", "python");

export function venvExists() {
  return existsSync(venvPython);
}

// Find a system Python 3.10+ to create the venv with.
// On Windows the "py" launcher is preferred because "python" may be the Microsoft Store stub.
export function findSystemPython() {
  const candidates = isWindows
    ? [["py", "-3"], ["python"], ["python3"]]
    : [["python3"], ["python"]];
  for (const [cmd, ...args] of candidates) {
    const result = spawnSync(
      cmd,
      [...args, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) continue;
    const [major, minor] = result.stdout.trim().split(".").map(Number);
    if (major === 3 && minor >= 10) return { cmd, args, version: `${major}.${minor}` };
  }
  return null;
}
