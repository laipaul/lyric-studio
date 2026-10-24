// pnpm align <song> <lyrics.txt> [--lang en|fr] [--compare reference.lrc] [--out file.lrc] [--device auto|cuda|cpu]
// Runs the automatic lyric alignment (Demucs + WhisperX) with the project-local .venv.
import { spawn } from "node:child_process";
import { aiReady, serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();
if (!aiReady()) {
  console.error("The AI packages for pnpm align are not installed (or are out of date).");
  console.error("Install them once with:  pnpm audio:setup --ai");
  console.error("(large download the first time: PyTorch with CUDA is about 3 GB)");
  process.exit(1);
}

const userCwd = process.env.INIT_CWD || process.cwd();
const child = spawn(venvPython, ["-m", "app.align", "--cwd", userCwd, ...process.argv.slice(2)], {
  cwd: serviceDir,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
