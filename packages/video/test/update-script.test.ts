// "Update Lyric Studio.cmd" (scripts/update.mjs, 21 Nov 2026): a key typed into .env.example by mistake is moved into
// .env and .env.example is put back as GitHub has it, so git pull never stops on it; other settings are not moved;
// nothing is committed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

// @ts-expect-error -- a plain .mjs script
import { keysToMove, rescueEnvExample, settings, updateArgs } from "../../../scripts/update.mjs";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" });
function repo(example: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "lyric-update-"));
  dirs.push(d);
  git(d, "init", "-q");
  git(d, "config", "user.email", "t@t");
  git(d, "config", "user.name", "t");
  writeFileSync(path.join(d, ".gitignore"), ".env\n.env.*\n!.env.example\n");
  writeFileSync(path.join(d, ".env.example"), example);
  git(d, "add", ".");
  git(d, "commit", "-qm", "base");
  return d;
}
const BASE = "# Copy this file to .env\nWORKSPACE_DIR=./workspace\n# WAVESPEED_API_KEY=\n";

describe("the update script", () => {
  it("reads KEY=value lines, not comments or empty values", () => {
    expect([...settings("# A=1\nB=2\n C = 3 \nD=\nexport E=5\r\n")]).toEqual([["B", "2"], ["C", "3"], ["E", "5"]]);
  });
  it("moves only keys and secrets that GitHub's copy does not have and .env does not set", () => {
    const r = keysToMove(`${BASE}WAVESPEED_API_KEY=abc\nHIGGSFIELD_API_KEY=id:s\nWORKSPACE_DIR=D:\\other\n`, BASE, "HIGGSFIELD_API_KEY=mine\n");
    expect(r).toEqual({ move: [["WAVESPEED_API_KEY", "abc"]], already: ["HIGGSFIELD_API_KEY"], other: ["WORKSPACE_DIR"] });
  });
  it("a key in .env.example: moved into .env, the edited file kept aside, .env.example as GitHub has it, nothing committed", () => {
    const d = repo(BASE);
    writeFileSync(path.join(d, ".env.example"), `${BASE}WAVESPEED_API_KEY=abc123\n`);
    writeFileSync(path.join(d, ".env"), "FAL_KEY=f");
    const said = rescueEnvExample(d, new Date("2026-11-21T10:00:00Z"));
    expect(said[0]).toMatch(/Moved WAVESPEED_API_KEY from \.env\.example into \.env/);
    expect(readFileSync(path.join(d, ".env"), "utf8")).toBe("FAL_KEY=f\n# Moved from .env.example by the update (2026-11-21)\nWAVESPEED_API_KEY=abc123\n");
    expect(readFileSync(path.join(d, ".env.example"), "utf8")).toBe(BASE);
    const kept = readdirSync(d).find((f) => f.startsWith(".env.example.mine-"))!;
    expect(readFileSync(path.join(d, kept), "utf8")).toContain("abc123");
    expect(git(d, "status", "--porcelain")).toBe(""); // the kept copy and .env are ignored: nothing to commit
    expect(git(d, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  });
  it("other changes only (no key): .env.example is put back, the change is kept aside and named, .env untouched", () => {
    const d = repo(BASE);
    writeFileSync(path.join(d, ".env.example"), BASE.replace("./workspace", "D:\\elsewhere"));
    const said = rescueEnvExample(d);
    expect(said.join(" ")).toMatch(/WORKSPACE_DIR was changed in \.env\.example, which the app never reads/);
    expect(existsSync(path.join(d, ".env"))).toBe(false);
    expect(readFileSync(path.join(d, ".env.example"), "utf8")).toBe(BASE);
  });
  it("nothing changed: nothing happens", () => {
    const d = repo(BASE);
    expect(rescueEnvExample(d)).toEqual([]);
    expect(readdirSync(d).some((f) => f.startsWith(".env.example.mine-"))).toBe(false);
  });
});

describe("Get Latest Lyric Studio.cmd (22 Nov 2026)", () => {
  it("--from lyric --copy-to origin: pull from the lyric-studio copy, then copy to the usual one; no options: as before", () => {
    expect(updateArgs(["--from", "lyric", "--copy-to", "origin"])).toEqual({ from: "lyric", copyTo: "origin" });
    expect(updateArgs([])).toEqual({ from: null, copyTo: null });
    expect(updateArgs(["--from", "--copy-to", "origin"])).toEqual({ from: null, copyTo: "origin" });
  });
});
