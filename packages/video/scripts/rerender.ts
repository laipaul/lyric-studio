// pnpm rerender <v1.manifest.json> [--out file.mp4]
// Renders a variation from "pnpm make" again, exactly as before (default: v1.rerender.mp4 next to the
// manifest). Stops with a clear message if the song, a clip or a font has changed.
import path from "node:path";
import { parseArgs } from "node:util";

import { rerender } from "../src/node";

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
} catch (error) {
  fail((error as Error).message);
}
const { values, positionals } = parsed;
if (positionals.length !== 1) fail("Usage: pnpm rerender <v1.manifest.json> [--out file.mp4]");

const userCwd = process.env.INIT_CWD ?? process.cwd();
const manifest = path.resolve(userCwd, positionals[0]);
const started = Date.now();
console.log("Checking the song, clips and fonts against the manifest");
let lastShown = -1;
let result;
try {
  result = await rerender(manifest, {
    out: values.out ? path.resolve(userCwd, values.out) : undefined,
    log: (m) => console.log(`  ${m}`),
    onProgress: (p) => {
      const pct = Math.floor(p * 100);
      if (pct >= lastShown + 5 || pct === 100) {
        lastShown = pct;
        process.stdout.write(`\rRendering ${String(pct).padStart(3)}%`);
      }
    },
  });
} catch (error) {
  fail((error as Error).message);
}
for (const note of result.notes) console.log(`\nNote: ${note}`);
console.log(`\n\nDone in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`Output:    ${result.out}`);
