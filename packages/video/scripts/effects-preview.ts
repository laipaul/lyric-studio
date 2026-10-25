// pnpm effects:preview <project> [--effect name[:subtle|balanced|expressive]] [--seconds 12] [--no-open]
// <project>: its title (e.g. "song"), id, or song file. Uses the project's latest pnpm make run.
//   Without --effect: all lyric effects side by side in one labelled video (effects-preview.mp4).
//   With --effect:    that effect full-size, 9:16 and 16:9.
import { parseArgs } from "node:util";

import { EFFECTS } from "../src";
import { effectsPreview, openFolder } from "../src/node";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    effect: { type: "string" },
    seconds: { type: "string", default: "12" },
    "no-open": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

if (positionals.length !== 1) {
  fail(`Usage: pnpm effects:preview <project title, id or song file> [--effect <name>]\nEffects: ${EFFECTS.map((e) => e.name).join(", ")}`);
}
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds < 4 || seconds > 30) fail("--seconds must be 4-30");

const started = Date.now();
try {
  const r = await effectsPreview({ project: positionals[0], effect: values.effect, maxSeconds: seconds, log: (m) => console.log(`  ${m}`) });
  console.log("");
  console.log(`From:   ${r.from}`);
  console.log(`Lines:  ${r.lines.join(" / ")}`);
  for (const n of r.notes) console.log(`Note:   ${n}`);
  for (const f of r.files) console.log(`Video:  ${f}`);
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s.`);
  if (!values["no-open"]) openFolder(r.folder);
} catch (error) {
  fail((error as Error).message);
}
