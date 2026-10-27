// "pnpm app:serve" (used by "Start Lyric Studio.cmd"): prepares the database, builds the studio when
// the code changed since the last build (after a git pull: the commit and local changes are compared,
// see app-version.mjs), then runs studio + worker + audio service
// in production mode. The studio listens on this PC only (see apps/studio/scripts/next.mjs).
import { execSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildStamp, codeVersion, lastBuild, root } from "./app-version.mjs";

const run = (command) => execSync(command, { cwd: root, stdio: "inherit" });
const log = (m) => console.log(`[lyric-studio] ${m}`);

// "Stop Lyric Studio.cmd" stops this process and everything under it (so nothing restarts itself).
const pidFile = path.join(root, "logs", "lyric-studio.pid");
mkdirSync(path.dirname(pidFile), { recursive: true });
writeFileSync(pidFile, `${process.pid}\n`);
process.on("exit", () => rmSync(pidFile, { force: true }));

log("preparing the database");
run("pnpm -s db:setup");

const code = codeVersion();
const built = lastBuild();
if (!built || built.version !== code.version || code.version === "unknown") {
  log(built ? `the code changed since the last build (built from ${built.commit}, the code is now ${code.commit}): building the studio (about 1-2 minutes)` : `no build yet: building the studio from ${code.commit} (about 1-2 minutes)`);
  run("pnpm --filter @lyric/studio build");
  writeFileSync(buildStamp, `${code.version} ${code.commit}\n`);
  log(`built from commit ${code.commit}`);
} else {
  log(`the build is up to date (commit ${code.commit})`);
}

// One part stopping (a crash in the worker or the audio service) must not take the others down: it is
// restarted on its own (up to 5 times, 3 s apart) and every line carries the time, so
// logs\lyric-studio.log shows what stopped, when and with which exit code.
log(`starting studio, worker and audio service (${new Date().toLocaleString()})`);
const child = spawn(
  "pnpm",
  [
    "exec", "concurrently", "--restart-tries", "5", "--restart-after", "3000", "-t", '"yyyy-MM-dd HH:mm:ss"', "-p", '"[{time}] {name}"',
    "-n", "studio,worker,audio", "-c", "cyan,magenta,yellow",
    '"pnpm --filter @lyric/studio start"', '"pnpm --filter @lyric/worker start"', '"node services/audio/scripts/run.mjs"',
  ],
  { cwd: root, stdio: "inherit", shell: true },
);
child.on("exit", (code) => {
  log(`stopped (${new Date().toLocaleString()}, exit code ${code ?? 0})`);
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
