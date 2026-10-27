// node services/audio/scripts/voice-map.mjs <song> --out voice.json
// Where the voice is heard (for pnpm make's vocal-start guard), from the cached vocal stem; Demucs runs
// only when the stem is not cached. Never re-aligns the lyrics.
import { spawn } from "node:child_process";
import { serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();
const child = spawn(venvPython, ["-m", "app.voice_map", ...process.argv.slice(2)], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
