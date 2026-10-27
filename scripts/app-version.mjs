// The version of the studio code: the git commit plus any local changes in apps/studio and packages.
// "Start Lyric Studio.cmd" compares it with the build that is running (GET /api/health "build") and
// "pnpm app:serve" with the last build (apps\studio\.next\lyric-studio-build.txt).
//   node scripts/app-version.mjs   -> prints "<version> <commit>"
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const buildStamp = path.join(root, "apps", "studio", ".next", "lyric-studio-build.txt");

export function codeVersion() {
  try {
    const commit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
    const files = execSync("git status --porcelain -- apps/studio packages", { cwd: root }).toString();
    const changes = execSync("git diff HEAD -- apps/studio packages", { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString();
    return { version: createHash("sha256").update(commit).update(files).update(changes).digest("hex").slice(0, 16), commit };
  } catch {
    return { version: "unknown", commit: "unknown" };
  }
}

// The last build: { version, commit }, or null when there is none.
export function lastBuild() {
  if (!existsSync(path.join(root, "apps", "studio", ".next", "BUILD_ID")) || !existsSync(buildStamp)) return null;
  const [version, commit] = readFileSync(buildStamp, "utf8").trim().split(/\s+/);
  return { version, commit: commit ?? "?" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = codeVersion();
  console.log(`${v.version} ${v.commit}`);
}
