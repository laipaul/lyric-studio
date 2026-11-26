// The de-reverbed copy of a vocal stem for the lip-sync drafts (26 Nov 2026): node services/audio/scripts/dereverb.mjs
// <stem.wav> <out.wav>. Needs "pnpm audio:setup --dereverb" once (LYRIC_DEREVERB_STUB=1: a stand-in copy, for tests).
import { spawn } from "node:child_process";
import { dereverbReady, serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();
if (!process.env.LYRIC_DEREVERB_STUB && !dereverbReady()) {
  console.error("The de-reverb is not installed yet. Install it once with:  pnpm audio:setup --dereverb");
  process.exit(3);
}
const child = spawn(venvPython, ["-m", "app.dereverb", ...process.argv.slice(2)], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
