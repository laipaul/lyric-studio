// pnpm tempo:check "<song folder or audio file>": the detected tempo, the likeliest other tempi (with
// their ratio: x2/3 = a 3:2 error) and the downbeats, to check a song's tempo before overriding it.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();
const userCwd = process.env.INIT_CWD || process.cwd();
const [target, ...rest] = process.argv.slice(2);
if (!target) {
  console.error('usage: pnpm tempo:check "<song folder or audio file>"');
  process.exit(1);
}
let file = path.resolve(userCwd, target);
if (existsSync(file) && statSync(file).isDirectory()) {
  const song = readdirSync(file).find((f) => /^song\.(wav|mp3)$/i.test(f)) ?? readdirSync(file).find((f) => /\.(wav|mp3)$/i.test(f));
  if (!song) {
    console.error(`No song.wav or song.mp3 in ${file}`);
    process.exit(1);
  }
  file = path.join(file, song);
}
const child = spawn(venvPython, ["-m", "app.cli", "--cwd", userCwd, file, "--candidates", ...rest], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
