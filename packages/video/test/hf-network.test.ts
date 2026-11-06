// HyperFrames renders (Theme Engine v2 step 1): ZERO network calls (decided by the user, 6 Nov 2026: fonts only
// from our own files, never a download, not even as a fallback), and every frame exactly the source frame the
// plan asks for (decision D1). The check script renders a numbered test clip trimmed, slowed, jumping back and
// running out, with a lyric line in a bundled font, in both modes, while strace records every connection of
// every process (Node, Chrome, FFmpeg): any connection that is not to this machine fails the test.
// Needs strace (Linux), FFmpeg and a browser for HyperFrames (HYPERFRAMES_BROWSER_PATH or `pnpm hf:setup`).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "@lyric/db";

const hasStrace = (() => {
  try {
    execFileSync("strace", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const hasBrowser = !!process.env.HYPERFRAMES_BROWSER_PATH || existsSync(path.join(REPO_ROOT, ".cache", "hyperframes", "browser-path.txt"));

// Connections in an strace log that leave this machine (IPv4 / IPv6 not loopback; DNS included).
export function outsideConnections(log: string): string[] {
  return log
    .split("\n")
    .filter((l) => /connect\(/.test(l) && /AF_INET6?/.test(l))
    .filter((l) => {
      const v4 = l.match(/inet_addr\("([\d.]+)"\)/)?.[1];
      const v6 = l.match(/inet_pton\(AF_INET6, "([^"]+)"/)?.[1];
      const addr = v4 ?? v6 ?? "";
      return !(addr.startsWith("127.") || addr === "::1" || addr.startsWith("::ffff:127.") || addr === "0.0.0.0");
    });
}

describe("strace log reader", () => {
  it("counts connections to other machines, not to this one", () => {
    const log = [
      'connect(23, {sa_family=AF_INET, sin_port=htons(41231), sin_addr=inet_addr("127.0.0.1")}, 16) = 0',
      'connect(5, {sa_family=AF_UNIX, sun_path="/tmp/x"}, 110) = 0',
      'connect(7, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("142.250.74.10")}, 16) = -1 EINPROGRESS',
      'connect(8, {sa_family=AF_INET6, sin6_port=htons(53), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2001:4860::8888", &sin6_addr), sin6_scope_id=0}, 28) = 0',
    ].join("\n");
    expect(outsideConnections(log).length).toBe(2);
  });
});

describe.skipIf(!hasStrace || !hasBrowser)("a HyperFrames render", () => {
  it("makes no network call, uses only our font file, and shows every planned frame", () => {
    const work = mkdtempSync(path.join(os.tmpdir(), "lyric-hf-check-"));
    const trace = path.join(work, "strace.log");
    const tsx = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    // HTTPS_PROXY etc. removed: nothing may even try to reach a proxy.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
    const r = spawnSync("strace", ["-f", "-qq", "-e", "trace=connect", "-o", trace, process.execPath, tsx, path.join(REPO_ROOT, "packages/video/scripts/hf-check.ts"), work], { encoding: "utf8", env, timeout: 600_000 });
    expect(r.status, r.stderr.slice(-2000)).toBe(0);
    const result = JSON.parse(r.stdout.trim().split("\n").pop()!) as Record<"all" | "lyrics", { accuracy: { accurate: boolean; exact: number; frames: number; off: unknown[] } }>;
    const log = readFileSync(trace, "utf8");
    // The trace really saw the render (HyperFrames talks to its own browser on this machine).
    expect(log.match(/inet_addr\("127\./g)?.length ?? 0).toBeGreaterThan(0);
    const outside = outsideConnections(log);
    expect(outside, `network calls during the render:\n${outside.join("\n")}`).toEqual([]);
    for (const mode of ["all", "lyrics"] as const) expect(result[mode].accuracy, `${mode}: ${JSON.stringify(result[mode].accuracy.off.slice(0, 5))}`).toMatchObject({ accurate: true, exact: 240 });
    // The composition loads only our own font file (by our own family name) and no stylesheet or file from the web.
    const html = readFileSync(path.join(work, "work-all", "hf-all", "index.html"), "utf8");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('font-family: "vm Cormorant Garamond"');
    expect(readdirSync(path.join(work, "work-all", "hf-all", "assets", "fonts"))).toEqual(["cormorant-garamond-latin-400-normal.woff2"]);
    rmSync(work, { recursive: true, force: true });
  }, 700_000);
});
