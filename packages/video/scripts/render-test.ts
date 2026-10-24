// pnpm render:test [--song f] [--clips dir] [--lrc f] [--section 0:11-0:59] [--rate 1x] [--energy medium]
//                  [--seed 1] [--style simple|bold] [--bars] [--downbeat-offset N] [--out file.mp4]
// Defaults: workspace\test\song.wav (or .mp3), workspace\test\clips\, workspace\test\lyrics.lrc.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { prepareRender, renderLyricVideo, testDefaults, tooLongMessage, type StyleChoice } from "../src/node";
import type { CutRate, Energy } from "../src";

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, "0")}`;

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    song: { type: "string" },
    clips: { type: "string" },
    lrc: { type: "string" },
    section: { type: "string" },
    rate: { type: "string", default: "1x" },
    energy: { type: "string", default: "medium" },
    seed: { type: "string", default: "1" },
    style: { type: "string", default: "simple" },
    bars: { type: "boolean", default: false },
    "downbeat-offset": { type: "string" },
    out: { type: "string" },
  },
});

const rate = values.rate as CutRate;
if (!["0.5x", "1x", "2x", "off"].includes(rate)) fail("--rate must be 0.5x, 1x, 2x or off");
const energy = values.energy as Energy;
if (!["low", "medium", "high"].includes(energy)) fail("--energy must be low, medium or high");
const style = values.style as StyleChoice;
if (!["simple", "bold"].includes(style)) fail("--style must be simple or bold");
const seed = Number(values.seed);
if (!Number.isInteger(seed) || seed < 0) fail("--seed must be a whole number");
const offset = values["downbeat-offset"] === undefined ? undefined : Number(values["downbeat-offset"]);
if (offset !== undefined && ![0, 1, 2, 3].includes(offset)) fail("--downbeat-offset must be 0, 1, 2 or 3");

// Relative paths are relative to the folder the command was typed in.
const userCwd = process.env.INIT_CWD ?? process.cwd();
const resolve = (p?: string) => (p ? path.resolve(userCwd, p) : undefined);
const log = (m: string) => console.log(`  ${m}`);

const started = Date.now();
console.log("Preparing");
let prepared;
try {
  prepared = await prepareRender({
    song: resolve(values.song),
    clips: resolve(values.clips),
    lrc: resolve(values.lrc),
    section: values.section,
    rate,
    energy,
    seed,
    style,
    bars: values.bars,
    downbeatOffset: offset,
    log,
  });
} catch (error) {
  fail((error as Error).message);
}
const { props, media, report } = prepared;

const out = resolve(values.out) ?? path.join(testDefaults().out, `${style}-seed${seed}.mp4`);
mkdirSync(path.dirname(out), { recursive: true });

const snapped = report.section.start_ms !== report.requestedSection.start_ms;
console.log("");
console.log(`Song:      ${report.song}`);
console.log(`BPM:       ${report.bpm}   downbeat confidence ${report.downbeatConfidence.toFixed(2)}`);
console.log(
  `Section:   ${clock(report.section.start_ms)} - ${clock(report.section.end_ms)}` +
    (snapped ? `   (start snapped from ${clock(report.requestedSection.start_ms)} to the nearest bar start)` : ""),
);
console.log(`Cuts:      ${report.plan.cuts.length} cuts, ${props.shots.length} shots, rate ${rate}, energy ${energy}, seed ${seed}`);
const slowed = props.shots.filter((s) => s.playbackRate < 1);
if (slowed.length) console.log(`           ${slowed.length} shot(s) slowed down to fit (${slowed.filter((s) => s.holdLastFrame).length} hold their last frame)`);
console.log(`Clips:     ${report.clipCount} from ${report.clipsFolder}`);
console.log(`Lyrics:    ${report.lyricLines} lines, style ${props.style.name}${values.bars ? ", cinematic bars" : ""}`);
for (const line of report.longLines) {
  console.log(`WARNING: ${tooLongMessage(line.lineNumber, line.file, line.text)}`);
}
console.log("");

let lastShown = -1;
try {
  await renderLyricVideo({
    props,
    media,
    outFile: out,
    log,
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
console.log(`\n\nDone in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`Output:    ${out}`);
