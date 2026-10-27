// "pnpm app:serve" (used by "Start Lyric Studio.cmd"): prepares the database, builds the studio when
// the code changed since the last build (after a git pull), then runs studio + worker + audio service
// in production mode. The studio listens on this PC only (see apps/studio/scripts/next.mjs).
import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (command) => execSync(command, { cwd: root, stdio: "inherit" });
const log = (m) => console.log(`[lyric-studio] ${m}`);

// What the build depends on: the git commit plus any local changes.
function codeVersion() {
  try {
    const head = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    const files = execSync("git status --porcelain -- apps/studio packages", { cwd: root }).toString();
    const changes = execSync("git diff HEAD -- apps/studio packages", { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString();
    return createHash("sha256").update(head).update(files).update(changes).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

log("preparing the database");
run("pnpm -s db:setup");

const stamp = path.join(root, "apps", "studio", ".next", "lyric-studio-build.txt");
const version = codeVersion();
const built = existsSync(path.join(root, "apps", "studio", ".next", "BUILD_ID")) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version;
if (!built || version === "unknown") {
  log("building the studio (after an update; about 1-2 minutes)");
  run("pnpm --filter @lyric/studio build");
  writeFileSync(stamp, `${version}\n`);
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
