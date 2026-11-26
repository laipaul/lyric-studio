// Music cues of one song (Performance script, 26 Nov 2026): node services/audio/scripts/music-cues.mjs <song>
// --segments segments.json [--vocals vocal.wav] [--stems auto|none] [--workspace dir]. Prints one JSON line.
// Uses the base audio packages (librosa); the stems come from Demucs when the AI packages are installed
// (pnpm audio:setup --ai), else the mix is split by frequency (the result says which).
import { spawn } from "node:child_process";
import { serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();
const child = spawn(venvPython, ["-m", "app.music_cues", ...process.argv.slice(2)], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
