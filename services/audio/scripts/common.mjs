// Shared helpers for the audio service scripts (Windows, macOS and Linux).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const venvDir = path.join(serviceDir, ".venv");
export const isWindows = process.platform === "win32";

// The audio service always runs on Python 3.12 (librosa, WhisperX and Demucs support it).
export const PYTHON_VERSION = "3.12";

// The command used to create the venv. On Windows this is always "py -3.12",
// never the default "python", which may be a different version.
export const systemPython = isWindows
  ? { cmd: "py", args: [`-${PYTHON_VERSION}`], label: `py -${PYTHON_VERSION}` }
  : { cmd: `python${PYTHON_VERSION}`, args: [], label: `python${PYTHON_VERSION}` };

// Python inside the project-local virtual environment.
export const venvPython = isWindows
  ? path.join(venvDir, "Scripts", "python.exe")
  : path.join(venvDir, "bin", "python");

const VERSION_SNIPPET = "import sys; print('%d.%d' % sys.version_info[:2])";

// Returns "3.12" etc., or null if the command does not run.
export function pythonVersion(cmd, args = []) {
  const result = spawnSync(cmd, [...args, "-c", VERSION_SNIPPET], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Fingerprint of requirements.txt, saved in .venv after a successful install.
export const requirementsFile = path.join(serviceDir, "requirements.txt");
export const installedMarker = path.join(venvDir, ".requirements-sha256");

export function requirementsHash() {
  return createHash("sha256").update(readFileSync(requirementsFile)).digest("hex");
}

// True when .venv exists, was built with the required Python version, and has the current
// requirements.txt installed (so a "git pull" that adds packages triggers a reinstall).
export function venvReady() {
  return (
    existsSync(venvPython) &&
    pythonVersion(venvPython) === PYTHON_VERSION &&
    existsSync(installedMarker) &&
    readFileSync(installedMarker, "utf8").trim() === requirementsHash()
  );
}
