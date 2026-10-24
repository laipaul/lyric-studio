// Creates services/audio/.venv with Python 3.12 and installs requirements.txt into it.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import {
  PYTHON_VERSION,
  installedMarker,
  isWindows,
  pythonVersion,
  requirementsFile,
  requirementsHash,
  serviceDir,
  systemPython,
  venvDir,
  venvPython,
} from "./common.mjs";

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: serviceDir });
  if (result.status !== 0) {
    console.error(`[audio setup] failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function failMissingPython() {
  const lines = [
    `[audio setup] Python ${PYTHON_VERSION} was not found ("${systemPython.label}" did not run).`,
    `[audio setup] The audio service needs exactly Python ${PYTHON_VERSION}; other versions are not used.`,
  ];
  if (isWindows) {
    lines.push(
      `[audio setup] Check what is installed with: py -0   (the list must include -V:${PYTHON_VERSION})`,
      `[audio setup] If it is missing, install Python ${PYTHON_VERSION} from https://www.python.org/downloads/windows/`,
    );
  } else {
    lines.push(`[audio setup] Install python${PYTHON_VERSION} with your system package manager.`);
  }
  lines.push("[audio setup] Then run: pnpm audio:setup");
  console.error(lines.join("\n"));
  process.exit(1);
}

export function setup() {
  if (!existsSync(venvPython) || pythonVersion(venvPython) !== PYTHON_VERSION) {
    const found = pythonVersion(systemPython.cmd, systemPython.args);
    if (found !== PYTHON_VERSION) failMissingPython();

    if (existsSync(venvDir)) {
      const old = existsSync(venvPython) ? pythonVersion(venvPython) : null;
      console.log(
        `[audio setup] removing old .venv (Python ${old ?? "unknown"}) to rebuild it with Python ${PYTHON_VERSION}`,
      );
      rmSync(venvDir, { recursive: true, force: true });
    }
    console.log(`[audio setup] creating ${venvDir} with ${systemPython.label}`);
    run(systemPython.cmd, [...systemPython.args, "-m", "venv", venvDir]);
  }
  console.log(`[audio setup] using Python ${pythonVersion(venvPython)} from .venv`);
  console.log("[audio setup] installing requirements (first time can take a few minutes)");
  // --only-binary: use ready-made wheels only, never compile anything from source.
  run(venvPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "-q",
    "--only-binary=:all:",
    "-r", requirementsFile,
  ]);
  writeFileSync(installedMarker, requirementsHash());
  console.log("[audio setup] done");
}

// Run directly (pnpm audio:setup) rather than imported by run.mjs.
if (process.argv[1]?.endsWith("setup.mjs")) {
  setup();
}
