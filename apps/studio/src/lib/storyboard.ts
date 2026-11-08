// Server-side: the Storyboard tab's data, from packages/video/scripts/storyboard.ts run in its own Node
// process (the planner imports the render code, which the studio's server does not bundle).
// Since 8 Nov 2026 (asked by the user: "make it swap faster") ONE planner process stays running (--serve) and
// answers every request, so an edit no longer pays Node / tsx starting up (1.5 s and more) and the song being
// decoded again. It is started on the first request, started again when it stopped or when the planner's code
// changed (a git pull while the studio runs), and a request it cannot answer falls back to a one-off process.
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "../.."); // apps/studio -> project root
const TSX = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(REPO_ROOT, "packages/video/scripts/storyboard.ts");
const CODE_DIRS = [path.join(REPO_ROOT, "packages/video/src"), path.join(REPO_ROOT, "packages/video/scripts"), path.join(REPO_ROOT, "packages/db/src")];
const TIMEOUT_MS = 5 * 60_000;

// The newest change to the planner's code (a few hundred files: a few ms).
function codeStamp(): number {
  let newest = 0;
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|json)$/.test(e.name)) newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  for (const d of CODE_DIRS) walk(d);
  return newest;
}

type Waiting = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
type Planner = { child: ChildProcess; stamp: number; waiting: Map<number, Waiting>; next: number; err: string };

// Kept on globalThis so a reload of this module in development does not start a second planner.
const g = globalThis as unknown as { __lyricPlanner?: Planner | null };

function startPlanner(stamp: number): Planner {
  const child = spawn(process.execPath, [TSX, SCRIPT, "--serve"], { cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const planner: Planner = { child, stamp, waiting: new Map(), next: 1, err: "" };
  let buffer = "";
  child.stdout!.on("data", (d) => {
    buffer += d;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("{")) continue; // a note the planner printed
      try {
        const msg = JSON.parse(line) as { n?: number; out?: unknown };
        const w = typeof msg.n === "number" ? planner.waiting.get(msg.n) : undefined;
        if (!w) continue;
        planner.waiting.delete(msg.n!);
        clearTimeout(w.timer);
        w.resolve(msg.out);
      } catch {
        // not one of our answers
      }
    }
  });
  child.stderr!.on("data", (d) => (planner.err = (planner.err + d).slice(-4000)));
  const fail = (why: string) => {
    if (g.__lyricPlanner === planner) g.__lyricPlanner = null;
    for (const w of planner.waiting.values()) {
      clearTimeout(w.timer);
      w.reject(new Error(why));
    }
    planner.waiting.clear();
  };
  child.on("error", (e) => fail(e.message));
  child.on("exit", () => fail(`The planner stopped.${planner.err ? `\n${planner.err.slice(-2000)}` : ""}`));
  return planner;
}

function warmPlanner(): Planner {
  const stamp = codeStamp();
  const now = g.__lyricPlanner;
  if (now && now.child.exitCode === null && now.stamp >= stamp) return now;
  if (now) now.child.kill(); // its code changed: start it again with the new code
  g.__lyricPlanner = startPlanner(stamp);
  return g.__lyricPlanner;
}

function askPlanner(args: string[]): Promise<unknown> {
  const planner = warmPlanner();
  const n = planner.next++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      planner.waiting.delete(n);
      reject(new Error("The planner did not answer in time."));
    }, TIMEOUT_MS);
    planner.waiting.set(n, { resolve, reject, timer });
    planner.child.stdin!.write(`${JSON.stringify({ n, args })}\n`);
  });
}

// The old way: one process per request (the fallback when the warm planner cannot answer).
function oneOff(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, SCRIPT, ...args], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => {
      try {
        // The JSON is the last line (the planner may print notes before it).
        resolve(JSON.parse(out.trim().split("\n").pop() ?? ""));
      } catch {
        reject(new Error(`The storyboard could not be planned:\n${(err || out).slice(-2000)}`));
      }
    });
  });
}

export async function storyboardJson(args: string[]): Promise<unknown> {
  if (process.env.LYRIC_PLANNER === "oneoff") return oneOff(args);
  try {
    return await askPlanner(args);
  } catch {
    return oneOff(args);
  }
}
