// node services/audio/scripts/vocal-stem.mjs <song> --stem <vocals.wav> [--out result.json] [--line-up]
// Checks a Suno vocal stem against the song (same version? the offset from trimming) and lines it up.
// Analysis only: the song and the stem are only read. No AI packages needed.
import { spawn } from "node:child_process";
import { serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();
const child = spawn(venvPython, ["-m", "app.vocal_stem", ...process.argv.slice(2)], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
