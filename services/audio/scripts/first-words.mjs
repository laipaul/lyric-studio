// node services/audio/scripts/first-words.mjs <song> --windows '[[1,0,20000]]' --lang en --out words.json
// The words sung where lines should start (a short speech-recognition pass on the cached vocal track),
// for pnpm make's vocal-start check. Needs the AI packages; never re-aligns the lyrics.
import { spawn } from "node:child_process";
import { aiReady, serviceDir, venvPython, venvReady } from "./common.mjs";

if (!venvReady() || !aiReady()) {
  console.error("The AI packages are not installed: the recognised-words check needs pnpm audio:setup --ai.");
  process.exit(3);
}
const child = spawn(venvPython, ["-m", "app.first_words", ...process.argv.slice(2)], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
