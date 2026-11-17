// pnpm face <check|scene-check|compare|calibrate|crop|sheet|models> ...: the local face checks (prints JSON).
// Installs the face packages the first time (pnpm audio:setup --face). Paths are taken from where the command was typed.
import { spawn } from "node:child_process";
import path from "node:path";
import { faceReady, serviceDir, venvPython } from "./common.mjs";
import { setupFace } from "./setup.mjs";

if (!faceReady()) setupFace();

const userCwd = process.env.INIT_CWD || process.cwd();
const args = process.argv.slice(2).map((a, i) => (i > 0 && !a.startsWith("-") ? path.resolve(userCwd, a) : a));
const child = spawn(venvPython, ["-m", "app.face", ...args], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
