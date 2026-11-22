// "Update Lyric Studio.cmd": gets the newest code from GitHub and starts it, without tripping over a key typed into the
// wrong file (21 Nov 2026: Paul put his WaveSpeed key in .env.example, a file that comes from GitHub, and git pull
// refused to update).
//   1. .env.example changed on this PC: a key or secret typed there (a line like WAVESPEED_API_KEY=… that GitHub's copy
//      does not have) is moved into .env (the file the app reads, never sent to GitHub) unless .env already has it.
//      Other settings are NOT moved (.env.example is never read by the app, so moving them would change how it runs).
//      The edited file is kept as .env.example.mine-<date> (ignored by git), and .env.example is put back as GitHub has it.
//   2. git pull --ff-only (other files changed on this PC: it stops and says which, nothing is lost).
//   3. pnpm install, then Start Lyric Studio.cmd (it rebuilds the new code and restarts the app).
// Nothing is ever committed from here. "Get Latest Lyric Studio.cmd" (22 Nov 2026) runs it with --from lyric --copy-to
// origin: the newest code comes from the lyric-studio copy on GitHub (where Claude pushes), and once it is here it is
// sent on to the usual copy (origin, videomaker) so both match; a copy that fails is said and the update goes on.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// KEY=value lines (not comments, value not empty).
export function settings(text) {
  const out = new Map();
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (m && m[2] !== "") out.set(m[1], m[2]);
  }
  return out;
}

export const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD)$/i;

// What to move from a locally edited .env.example into .env: the keys and secrets that are not in GitHub's copy (or
// have another value there) and that .env does not set yet; `other`: changed settings that are left where they are.
export function keysToMove(localExample, githubExample, envText) {
  const mine = settings(localExample);
  const theirs = settings(githubExample);
  const env = settings(envText);
  const move = [];
  const already = [];
  const other = [];
  for (const [k, v] of mine) {
    if (theirs.get(k) === v) continue;
    if (!SECRET_NAME.test(k)) other.push(k);
    else if (env.has(k)) already.push(k);
    else move.push([k, v]);
  }
  return { move, already, other };
}

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Step 1. Returns what it said (for the window and the tests).
export function rescueEnvExample(cwd = ROOT, now = new Date()) {
  const said = [];
  const example = path.join(cwd, ".env.example");
  if (!existsSync(example)) return said;
  const changed = git(["status", "--porcelain", "--", ".env.example"], cwd).trim();
  if (!changed) return said;
  const local = readFileSync(example, "utf8");
  let github = "";
  try {
    github = git(["show", "HEAD:.env.example"], cwd);
  } catch {
    return said; // not in git yet: leave it
  }
  const envFile = path.join(cwd, ".env");
  const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const { move, already, other } = keysToMove(local, github, envText);
  if (move.length) {
    const lines = move.map(([k, v]) => `${k}=${v}`).join("\n");
    appendFileSync(envFile, `${envText && !envText.endsWith("\n") ? "\n" : ""}# Moved from .env.example by the update (${now.toISOString().slice(0, 10)})\n${lines}\n`);
    said.push(`Moved ${move.map(([k]) => k).join(", ")} from .env.example into .env (the file the app reads; it never goes to GitHub).`);
  }
  if (already.length) said.push(`${already.join(", ")} ${already.length === 1 ? "is" : "are"} already in .env: the value in .env is kept.`);
  if (other.length) said.push(`${other.join(", ")} ${other.length === 1 ? "was" : "were"} changed in .env.example, which the app never reads: to use ${other.length === 1 ? "it" : "them"}, put the line${other.length === 1 ? "" : "s"} in .env.`);
  const kept = path.join(cwd, `.env.example.mine-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}`);
  copyFileSync(example, kept);
  git(["checkout", "--", ".env.example"], cwd);
  said.push(`Your edited .env.example is kept as ${path.basename(kept)} (never sent to GitHub); .env.example is back as GitHub has it.`);
  return said;
}

export const LYRIC_REPO = "https://github.com/laipaul/lyric-studio.git";

// --from <remote> (pull from it, its main branch) and --copy-to <remote> (push main there afterwards). Pure.
export function updateArgs(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  return { from: at("--from"), copyTo: at("--copy-to") };
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
}

async function main() {
  const { from, copyTo } = updateArgs(process.argv.slice(2));
  console.log(from ? `Lyric Studio: getting the newest version from GitHub (${from})...` : "Lyric Studio: updating...");
  for (const line of rescueEnvExample()) console.log(`  ${line}`);
  if (from === "lyric") {
    try {
      git(["remote", "get-url", "lyric"], ROOT);
    } catch {
      run("git", ["remote", "add", "lyric", LYRIC_REPO]); // the first time on this PC
    }
  }
  try {
    run("git", from ? ["pull", "--ff-only", from, "main"] : ["pull", "--ff-only"]);
  } catch {
    const files = git(["status", "--porcelain"], ROOT).trim();
    console.log("\nThe update stopped: files of the app were changed on this PC, and git will not overwrite them (nothing is lost).");
    if (files) console.log(`Changed files:\n${files}`);
    console.log('Send this window to Claude, or put a file back as GitHub has it with:  git checkout -- "<file>"');
    process.exit(1);
  }
  if (copyTo) {
    try {
      console.log(`\nCopying it to your other GitHub copy (${copyTo}) so both match...`);
      run("git", ["push", copyTo, "HEAD:main"]);
    } catch {
      console.log(`Could not copy it to ${copyTo} (no internet, or GitHub asked to sign in). The app still updates; it is copied the next time.`);
    }
  }
  run("pnpm", ["install"]);
  console.log("\nStarting the new version...");
  const start = path.join(ROOT, "Start Lyric Studio.cmd");
  if (process.platform === "win32" && existsSync(start)) spawn("cmd.exe", ["/c", start], { cwd: ROOT, stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
  else console.log("Start it with: pnpm app:serve");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

