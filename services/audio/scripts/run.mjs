// Starts the audio service on http://127.0.0.1:8001 using the project-local .venv.
// Creates (or rebuilds) the .venv with Python 3.12 first if needed.
import { spawn } from "node:child_process";
import { serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();

const child = spawn(
  venvPython,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"],
  { cwd: serviceDir, stdio: "inherit" },
);

const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
