// The Assets tab's API route (apps/studio/src/app/api/songs/[id]/assets) imports story-line.ts -> transition-notes.ts.
// If that chain reaches Remotion (node/storyboard-file.ts -> manifest.ts does), `next build` fails with
// "Failed to collect page data for /api/songs/[id]/assets" (in a Next.js route React has no createContext).
// This follows the runtime imports (not `import type`) of the modules API routes use and fails on any path to remotion.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../src");
const file = (p: string) => ["", ".ts", ".tsx", "/index.ts"].map((s) => p + s).find((f) => existsSync(f) && statSync(f).isFile());

function runtimeImports(f: string): string[] {
  const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:import|export)\s+(type\s+)?([\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const names = /^\{([^}]*)\}/.exec((m[2] ?? "").trim());
    if (names && names[1].split(",").every((x) => !x.trim() || /^type\s/.test(x.trim()))) continue;
    out.push(m[3]);
  }
  return out;
}

function pathToRemotion(start: string): string[] | null {
  const from = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const f = queue.shift()!;
    for (const spec of runtimeImports(f)) {
      if (spec === "remotion" || spec.startsWith("remotion/") || spec.startsWith("@remotion/")) {
        const chain = [spec];
        for (let c: string | null = f; c; c = from.get(c) ?? null) chain.unshift(path.relative(SRC, c));
        return chain;
      }
      if (!spec.startsWith(".")) continue;
      const r = file(path.resolve(path.dirname(f), spec));
      if (r && !from.has(r)) (from.set(r, f), queue.push(r));
    }
  }
  return null;
}

describe("modules used by API routes never load Remotion", () => {
  for (const m of ["node/story-line.ts", "node/transition-notes.ts", "node/storyboard-read.ts", "node/assets.ts", "node/shot-production.ts", "node/shot-timing.ts", "node/production.ts", "node/shot-references.ts", "node/lipsync.ts"]) {
    it(m, () => expect(pathToRemotion(path.join(SRC, m))).toBeNull());
  }
  it("the check itself finds a real path (node/storyboard-file.ts -> manifest.ts -> remotion)", () => {
    expect(pathToRemotion(path.join(SRC, "node/storyboard-file.ts"))).toContain("remotion");
  });
});
