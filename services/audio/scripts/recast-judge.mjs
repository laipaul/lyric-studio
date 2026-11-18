// node services/audio/scripts/recast-judge.mjs --original o.mp4 --result r.mp4 --reference a.png [...]: the local
// recast judge (face, environment, motion; prints JSON). Installs the face packages the first time (as pnpm face does).
import { spawn } from "node:child_process";
import { faceReady, serviceDir, venvPython } from "./common.mjs";
import { setupFace } from "./setup.mjs";

if (!faceReady()) setupFace();

const child = spawn(venvPython, ["-m", "app.recast_judge", ...process.argv.slice(2)], { cwd: serviceDir, stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
child.on("exit", (code) => process.exit(code ?? 1));
