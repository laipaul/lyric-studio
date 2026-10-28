// An alignment that is interrupted (Ctrl+C, Stop in the app, a crash) is never stored: the aligner
// writes temporary files, the result is checked for completeness, and only then renamed into place.
// The next run removes the leftovers and aligns again.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanInterrupted, ensureAlignment, findOrCreateSongProject, songPathsById, type AlignRunner } from "../src/node";
import { fakeAlign, LYRICS, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-align-stop-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "Stop Me.wav");
const lyrics = path.join(root, "lyrics.txt");
let ws: Workspace;
let store: string;

const stored = () => readdirSync(store).filter((f) => /^aligned-/.test(f));
const parts = () => readdirSync(store).filter((f) => f.endsWith(".part"));
const align = async (runner: AlignRunner, log: string[] = []) => {
  const sp = await findOrCreateSongProject(ws, song);
  return ensureAlignment(ws, sp, { lyricsTxt: lyrics, durationMs: 14_000, align: runner, log: (m) => log.push(m) });
};

beforeAll(async () => {
  mkdirSync(root, { recursive: true });
  makeSong(song, 14);
  writeFileSync(lyrics, `${LYRICS.join("\n")}\n`);
  ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  store = songPathsById(ws, sp.project.id).store;
  mkdirSync(store, { recursive: true });
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("an interrupted alignment is never stored", () => {
  it("the aligner fails half-way: nothing stored, no temporary file left", async () => {
    const halfway: AlignRunner = async (a) => {
      writeFileSync(a.out, "[00:01.00]Verse one here\n"); // half a result
      throw new Error("pnpm align failed: interrupted");
    };
    await expect(align(halfway)).rejects.toThrow(/interrupted/);
    expect(stored()).toEqual([]);
    expect(parts()).toEqual([]);
  });

  it("the aligner ends without a complete result: refused, nothing stored", async () => {
    const short: AlignRunner = async (a) => {
      writeFileSync(a.out, "[00:01.00]Verse one here\n[00:02.50]Hold on to me\n");
      writeFileSync(a.report, JSON.stringify({ lines: [{}, {}] }));
    };
    await expect(align(short)).rejects.toThrow(/finished without a complete result \(2 of 6 lines timed\); nothing was stored/);
    const noReport: AlignRunner = async (a) => {
      await fakeAlign(a);
      writeFileSync(a.report, "{ half");
    };
    await expect(align(noReport)).rejects.toThrow(/the report is not valid JSON/);
    expect(stored()).toEqual([]);
  });

  it("the process is killed in the middle (like Ctrl+C or a crash): nothing stored; the next run cleans up and aligns", async () => {
    const child = path.join(root, "child.mts");
    const node = pathToFileURL(path.resolve("src/node/index.ts")).href; // a file: URL, so Windows drive letters are not read as a URL scheme
    writeFileSync(
      child,
      `import { openWorkspace } from ${JSON.stringify(pathToFileURL(path.resolve("../db/src/index.ts")).href)};
import { ensureAlignment, findOrCreateSongProject } from ${JSON.stringify(node)};
import { writeFileSync } from "node:fs";
const ws = openWorkspace(${JSON.stringify(wsDir)});
const sp = await findOrCreateSongProject(ws, ${JSON.stringify(song)});
await ensureAlignment(ws, sp, {
  lyricsTxt: ${JSON.stringify(lyrics)}, durationMs: 14000,
  align: async (a) => {
    writeFileSync(a.out, "[00:01.00]Verse one here\\n");
    writeFileSync(a.report, "{");
    console.log("ALIGNING");
    await new Promise(() => {}); // a long alignment, until killed
  },
});
`,
    );
    const proc = spawn(process.execPath, ["--import", "tsx", child], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] }); // one process, killed hard
    await new Promise<void>((resolve, reject) => {
      proc.stdout.on("data", (d: Buffer) => d.toString().includes("ALIGNING") && resolve());
      proc.on("exit", (code) => reject(new Error(`child exited early (${code})`)));
    });
    proc.kill("SIGKILL");
    await new Promise((r) => proc.on("exit", r));
    expect(stored()).toEqual([]);
    expect(parts().length).toBe(2); // the killed run's temporary files, never used

    // A report whose .lrc never appeared (killed between the two renames) is not "stored" either.
    const orphan = path.join(store, "aligned-0123456789ab-20261026-120000.report.json");
    writeFileSync(orphan, "{}");
    utimesSync(orphan, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));

    let calls = 0;
    const log: string[] = [];
    const done = await align(async (a) => {
      calls += 1;
      await fakeAlign(a);
    }, log);
    expect(calls).toBe(1); // aligned again, not taken from the half result
    expect(done.source).toBe("aligned");
    expect(log).toContain("lyrics: removed 3 file(s) left by an interrupted alignment (never used)");
    expect(parts()).toEqual([]);
    expect(existsSync(orphan)).toBe(false);
    expect(stored().sort()).toEqual([path.basename(done.lrcFile), path.basename(done.lrcFile).replace(/\.lrc$/, ".report.json")].sort());
    expect(readFileSync(done.lrcFile, "utf8")).toMatch(/>light$/m); // the last line is there

    const again = await align(async () => {
      throw new Error("must not align again");
    });
    expect(again.source).toBe("stored");
  }, 60_000);

  it("leftovers of a run that is still going (its process alive) are left alone", () => {
    const mine = path.join(store, `.aligned-x.lrc.${process.pid}.part`);
    writeFileSync(mine, "x");
    expect(cleanInterrupted(store)).toEqual([]);
    rmSync(mine);
  });
});
