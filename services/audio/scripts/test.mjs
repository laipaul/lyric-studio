// pnpm test:audio — runs the Python tests of the audio service with the project-local .venv.
import { spawn } from "node:child_process";
import { serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();

const child = spawn(venvPython, ["-m", "pytest", "-q", ...process.argv.slice(2)], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
