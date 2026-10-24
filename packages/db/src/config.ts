// Where the workspace lives. Set WORKSPACE_DIR in the project's .env file to move it
// (for example to another drive). Relative paths are resolved from the project root.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

function findRepoRoot(start: string): string {
  let dir = start;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not find the project root (pnpm-workspace.yaml).");
    dir = parent;
  }
  return dir;
}

export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

// Values already set in the environment win over .env.
loadDotenv({ path: path.join(REPO_ROOT, ".env"), quiet: true });

export const DEFAULT_WORKSPACE_DIR = "./workspace";
export const DB_FILENAME = "studio.db";

export function resolveWorkspaceDir(value: string | undefined = process.env.WORKSPACE_DIR): string {
  const raw = value?.trim() || DEFAULT_WORKSPACE_DIR;
  return path.resolve(REPO_ROOT, raw);
}
