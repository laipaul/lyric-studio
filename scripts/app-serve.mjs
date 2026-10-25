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
    const changes = execSync("git status --porcelain -- apps/studio packages", { cwd: root }).toString();
    return createHash("sha256").update(head).update(changes).digest("hex").slice(0, 16);
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

log("starting studio, worker and audio service");
const child = spawn(
  "pnpm",
  ["exec", "concurrently", "-k", "-n", "studio,worker,audio", "-c", "cyan,magenta,yellow", '"pnpm --filter @lyric/studio start"', '"pnpm --filter @lyric/worker start"', '"node services/audio/scripts/run.mjs"'],
  { cwd: root, stdio: "inherit", shell: true },
);
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
