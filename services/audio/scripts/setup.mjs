// Creates services/audio/.venv and installs requirements.txt into it.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findSystemPython, serviceDir, venvDir, venvExists, venvPython } from "./common.mjs";

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: serviceDir });
  if (result.status !== 0) {
    console.error(`[audio setup] failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

export function setup() {
  if (!venvExists()) {
    const python = findSystemPython();
    if (!python) {
      console.error(
        "[audio setup] Python 3.10 or newer was not found. Install Python 3.12 from python.org, then run: pnpm audio:setup",
      );
      process.exit(1);
    }
    console.log(`[audio setup] creating ${venvDir} with Python ${python.version}`);
    run(python.cmd, [...python.args, "-m", "venv", venvDir]);
  }
  console.log("[audio setup] installing requirements");
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", path.join(serviceDir, "requirements.txt")]);
  console.log("[audio setup] done");
}

// Run directly (pnpm audio:setup) rather than imported by run.mjs.
if (process.argv[1]?.endsWith("setup.mjs")) {
  setup();
}
