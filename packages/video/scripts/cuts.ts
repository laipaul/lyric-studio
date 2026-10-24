// pnpm cuts <song> --section 0:11-0:59 [--rate 1x] [--energy medium] [--early 2] [--downbeat-offset N] [--json]
// Prints where the video would cut in a section of a song, so the cut list can be checked by ear.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { getCutPoints, gridBeatsFor, type Beat, type Energy } from "../src";

const RATES = ["0.5x", "1x", "2x"] as const;
const ENERGIES = ["low", "medium", "high"] as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) fail("Could not find the project root.");
    dir = parent;
  }
  return dir;
}

// "1:05.5" -> 65500 ms; "42" -> 42000 ms
function parseTime(text: string): number {
  const parts = text.trim().split(":");
  if (parts.length > 2 || parts.some((p) => p === "" || Number.isNaN(Number(p)))) fail(`Not a time: "${text}" (use m:ss)`);
  const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Math.round(seconds * 1000);
}

const clock = (ms: number) => {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  return `${sign}${Math.floor(abs / 60_000)}:${((abs % 60_000) / 1000).toFixed(3).padStart(6, "0")}`;
};

const describeGrid = (beats: number) =>
  ({ 1: "every beat", 2: "every half bar (2 beats)", 4: "every bar (4 beats)", 8: "every 2 bars", 16: "every 4 bars" })[beats] ??
  `every ${beats} beats`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    section: { type: "string" },
    rate: { type: "string", default: "1x" },
    energy: { type: "string", default: "medium" },
    early: { type: "string", default: "2" },
    "downbeat-offset": { type: "string" },
    json: { type: "boolean", default: false },
  },
});

if (positionals.length !== 1) {
  fail('Usage: pnpm cuts <song> --section 0:11-0:59 [--rate 0.5x|1x|2x] [--energy low|medium|high] [--early 0-4] [--downbeat-offset 0-3]');
}
const rate = values.rate as (typeof RATES)[number];
if (!(RATES as readonly string[]).includes(rate)) fail(`--rate must be one of ${RATES.join(", ")} ("off" needs lyric timings, which come in a later step)`);
const energy = values.energy as Energy;
if (!(ENERGIES as readonly string[]).includes(energy)) fail(`--energy must be one of ${ENERGIES.join(", ")}`);
const early = Number(values.early);
if (!Number.isInteger(early) || early < 0 || early > 4) fail("--early must be 0, 1, 2, 3 or 4");

// INIT_CWD is the folder the user typed the command in (pnpm runs scripts from the project root).
const song = path.resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]);
if (!existsSync(song)) fail(`File not found: ${song}`);

// Beats from the audio analysis (cached; the downbeat offset is applied there).
const root = repoRoot();
const analyzeArgs = [path.join(root, "services/audio/scripts/analyze.mjs"), song, "--json"];
if (values["downbeat-offset"] !== undefined) analyzeArgs.push("--downbeat-offset", values["downbeat-offset"]);
const run = spawnSync(process.execPath, analyzeArgs, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
if (run.status !== 0) fail("The audio analysis failed (see above).");
const analysis = JSON.parse(run.stdout) as {
  bpm: number;
  duration_ms: number;
  downbeat_confidence: number;
  downbeat_offset: number;
  beats: Beat[];
};

let start = 0;
let end = analysis.duration_ms;
if (values.section) {
  const [from, to] = values.section.split("-");
  if (to === undefined) fail('--section must look like 0:11-0:59');
  start = parseTime(from);
  end = parseTime(to);
}
if (end <= start) fail("The section must end after it starts.");
if (end > analysis.duration_ms) end = analysis.duration_ms;

const plan = getCutPoints(analysis.beats, { start_ms: start, end_ms: end, energy }, { cutRate: rate, earlyCutFrames: early });
const bounds = [plan.start_frame, ...plan.cuts.map((c) => c.frame), plan.end_frame];
const shotMs = (i: number) => Math.round(((bounds[i + 1] - bounds[i]) * 1000) / plan.fps);

if (values.json) {
  console.log(JSON.stringify({ song, section: { start_ms: start, end_ms: end, energy }, rate, early, ...plan }, null, 2));
  process.exit(0);
}

const shots = bounds.slice(0, -1).map((_, i) => shotMs(i));
console.log(`Song:        ${song}`);
console.log(`BPM:         ${analysis.bpm}   downbeat confidence ${analysis.downbeat_confidence.toFixed(2)}   downbeat offset ${analysis.downbeat_offset}`);
console.log(`Section:     ${clock(start)} - ${clock(end)}  (${((end - start) / 1000).toFixed(1)} s, energy ${energy})`);
console.log(`Cut rate:    ${rate} -> ${describeGrid(gridBeatsFor(rate, energy))}${energy !== "medium" ? ` (${energy} energy)` : ""}`);
if (plan.grid_beats !== plan.requested_grid_beats) {
  console.log(`             too fast for the 0.8 s minimum shot; using ${describeGrid(plan.grid_beats!)} instead`);
}
console.log(`Early cut:   ${early} frames (${Math.round((early * 1000) / plan.fps)} ms before the beat)`);
console.log(`Result:      ${plan.cuts.length} cuts, ${shots.length} shots, shortest ${(Math.min(...shots) / 1000).toFixed(2)} s, longest ${(Math.max(...shots) / 1000).toFixed(2)} s`);
console.log("");
console.log("    #   cut at      frame   beat #   bar.beat   beat at     shot length");
console.log(`    -   ${clock(start)}  ${String(plan.start_frame).padStart(6)}   (section start)                  ${(shotMs(0) / 1000).toFixed(2)} s`);
plan.cuts.forEach((c, i) => {
  console.log(
    `  ${String(i + 1).padStart(3)}   ${clock(c.time_ms)}  ${String(c.frame).padStart(6)}   ${String(c.beat_index + 1).padStart(6)}   ` +
      `${`${c.bar}.${c.beat_in_bar}`.padStart(8)}   ${clock(c.beat_time_ms)}   ${(shotMs(i + 1) / 1000).toFixed(2)} s`,
  );
});
console.log(`    -   ${clock(end)}  ${String(plan.end_frame).padStart(6)}   (section end)`);
