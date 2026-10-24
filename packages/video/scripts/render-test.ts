// pnpm render:test [--song f] [--clips dir] [--lrc f] [--pins f] [--section 0:11-0:59] [--rate 1x]
//   [--energy medium] [--order story|shuffle] [--seed 1] [--style simple|bold] [--bars]
//   [--lead 0.25] [--lyrics-offset 0] [--font "Family"] [--font-hook "Family"]
//   [--downbeat-offset N] [--out file.mp4]
// Defaults: workspace\test\song.wav (or .mp3), clips\, lyrics.lrc and pins.txt (if present).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { prepareRender, renderLyricVideo, testDefaults, type StyleChoice } from "../src/node";
import type { ClipOrder, CutRate, Energy } from "../src";

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
    pins: { type: "string" },
    section: { type: "string" },
    rate: { type: "string", default: "1x" },
    energy: { type: "string", default: "medium" },
    order: { type: "string", default: "story" },
    seed: { type: "string", default: "1" },
    style: { type: "string", default: "simple" },
    bars: { type: "boolean", default: false },
    lead: { type: "string", default: "0.25" },
    "lyrics-offset": { type: "string", default: "0" },
    font: { type: "string" },
    "font-hook": { type: "string" },
    "downbeat-offset": { type: "string" },
    out: { type: "string" },
  },
});

const rate = values.rate as CutRate;
if (!["0.5x", "1x", "2x", "off"].includes(rate)) fail("--rate must be 0.5x, 1x, 2x or off");
const energy = values.energy as Energy;
if (!["low", "medium", "high"].includes(energy)) fail("--energy must be low, medium or high");
const order = values.order as ClipOrder;
if (!["story", "shuffle"].includes(order)) fail("--order must be story or shuffle");
const style = values.style as StyleChoice;
if (!["simple", "bold"].includes(style)) fail("--style must be simple or bold");
const seed = Number(values.seed);
if (!Number.isInteger(seed) || seed < 0) fail("--seed must be a whole number");
const seconds = (name: string, text: string) => {
  const n = Number(text);
  if (!Number.isFinite(n) || Math.abs(n) > 10) fail(`--${name} must be a number of seconds, e.g. 0.25 or -0.3`);
  return Math.round(n * 1000);
};
const leadMs = seconds("lead", values.lead!);
const lyricsOffsetMs = seconds("lyrics-offset", values["lyrics-offset"]!);
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
    pins: resolve(values.pins),
    section: values.section,
    rate,
    energy,
    order,
    seed,
    style,
    bars: values.bars,
    leadMs,
    lyricsOffsetMs,
    font: values.font,
    fontHook: values["font-hook"],
    downbeatOffset: offset,
    log,
  });
} catch (error) {
  fail((error as Error).message);
}
const { props, media, report, warnings } = prepared;

const name = order === "story" ? `${style}-story` : `${style}-shuffle-seed${seed}`;
const out = resolve(values.out) ?? path.join(testDefaults().out, `${name}.mp4`);
mkdirSync(path.dirname(out), { recursive: true });

const snapped = report.section.start_ms !== report.requestedSection.start_ms;
console.log("");
console.log(`Song:      ${report.song}`);
console.log(`BPM:       ${report.bpm}   downbeat confidence ${report.downbeatConfidence.toFixed(2)}`);
console.log(
  `Section:   ${clock(report.section.start_ms)} - ${clock(report.section.end_ms)}` +
    (snapped ? `   (start snapped from ${clock(report.requestedSection.start_ms)} to the nearest bar start)` : ""),
);
console.log(
  `Cuts:      ${report.plan.cuts.length} cuts, ${props.shots.length} shots, rate ${rate}, energy ${energy}, ` +
    `order ${order}${order === "shuffle" ? ` (seed ${seed})` : ""}`,
);
const slowed = props.shots.filter((s) => s.playbackRate < 1);
if (slowed.length) console.log(`           ${slowed.length} shot(s) slowed down to fit (${slowed.filter((s) => s.holdLastFrame).length} hold their last frame)`);
console.log(`Clips:     ${report.clipCount} from ${report.clipsFolder}`);
if (report.pinsFile) console.log(`Pins:      ${report.pins} from ${report.pinsFile}`);
console.log(
  `Lyrics:    ${report.lyricLines} lines (${report.hookLines} hook), style ${props.style.name}, font ${report.fonts.main}` +
    (report.fonts.hook ? `, hook font ${report.fonts.hook}` : "") +
    (values.bars ? ", cinematic bars" : ""),
);
console.log(`Timing:    lines appear ${leadMs / 1000} s before their stamp, offset ${lyricsOffsetMs / 1000} s`);
for (const warning of warnings) console.log(`WARNING: ${warning}`);
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
