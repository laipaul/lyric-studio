// Starts the audio service on http://127.0.0.1:8001 using the project-local .venv.
// Creates the .venv first if it does not exist yet.
import { spawn } from "node:child_process";
import { serviceDir, venvExists, venvPython } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvExists()) setup();

const child = spawn(
  venvPython,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"],
  { cwd: serviceDir, stdio: "inherit" },
);

const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
