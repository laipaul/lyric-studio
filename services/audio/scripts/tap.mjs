// pnpm tap <song> <lyrics.txt> [--section 0:11-0:59] [--shift -0.15]
// Checks the lyric lines for phone screens, then runs the interactive tapper (Python, .venv).
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { serviceDir, venvPython, venvReady } from "./common.mjs";
import { setup } from "./setup.mjs";

if (!venvReady()) setup();

const repoRoot = path.resolve(serviceDir, "../..");
const userCwd = process.env.INIT_CWD || process.cwd();
const args = process.argv.slice(2);

// The second plain argument is the lyrics file (skip the values of --section / --shift).
const plain = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--section" || args[i] === "--shift") i++;
  else if (!args[i].startsWith("--")) plain.push(args[i]);
}
if (plain[1]) {
  const tsxCli = createRequire(path.join(repoRoot, "package.json")).resolve("tsx/cli");
  spawnSync(process.execPath, [tsxCli, path.join(repoRoot, "packages/video/scripts/check-lyrics.ts"), path.resolve(userCwd, plain[1])], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

const child = spawn(venvPython, ["-m", "app.tap", "--cwd", userCwd, ...args], { cwd: serviceDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
