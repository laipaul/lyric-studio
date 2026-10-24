// pnpm analyze <path-to-audio> [--bpm 140] [--json]
// Runs the Python analysis directly (no need for "pnpm dev"), using the project-local .venv.
import { spawn } from "node:child_process";
import { serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();

// pnpm runs scripts from the project root; INIT_CWD is the folder the user typed the command in,
// so relative paths like "song.wav" work from anywhere.
const userCwd = process.env.INIT_CWD || process.cwd();
const child = spawn(venvPython, ["-m", "app.cli", "--cwd", userCwd, ...process.argv.slice(2)], {
  cwd: serviceDir,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
