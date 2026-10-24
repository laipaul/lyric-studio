// pnpm make <song> <lyrics.txt> --collection <name> [--collection-path <folder>] [--variations 6]
//   [--section auto|full|0:11-1:10] [--hint <taps.lrc>] [--realign] [--lrc <file.lrc>] [--lang en|fr]
//   [--rate 1x] [--energy medium] [--lead 0.25] [--lyrics-offset 0] [--downbeat-offset N]
//   [--font "Family"] [--font-hook "Family"] [--pins pins.txt] [--parallel N] [--resume] [--no-open]
//   [--platforms reels,tiktok,shorts | all] [--allow-fill]
// One command from a song to N finished variations with manifests and QA reports, per platform.
import path from "node:path";
import { parseArgs } from "node:util";

import { clockText, type CutRate, type Energy } from "../src";
import { makeVideos, openFolder, type RenderState } from "../src/node";

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      collection: { type: "string" },
      "collection-path": { type: "string" },
      variations: { type: "string" },
      platforms: { type: "string" },
      "allow-fill": { type: "boolean", default: false },
      section: { type: "string", default: "auto" },
      hint: { type: "string" },
      realign: { type: "boolean", default: false },
      lrc: { type: "string" },
      lang: { type: "string", default: "en" },
      rate: { type: "string", default: "1x" },
      energy: { type: "string", default: "medium" },
      lead: { type: "string", default: "0.25" },
      "lyrics-offset": { type: "string" },
      "downbeat-offset": { type: "string" },
      font: { type: "string" },
      "font-hook": { type: "string" },
      pins: { type: "string" },
      parallel: { type: "string" },
      "no-open": { type: "boolean", default: false },
      "no-frame-check": { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
    },
  });
} catch (error) {
  fail((error as Error).message);
}
const { values, positionals } = parsed;

if (positionals.length !== 2) fail('Usage: pnpm make <song> <lyrics.txt> --collection <name>   (e.g. pnpm make "workspace\\test\\song.wav" "workspace\\test\\lyrics.txt" --collection beach)');
if (!values.collection) fail("--collection <name> is required (the folder WORKSPACE_DIR\\clips\\<name>)");
const rate = values.rate as CutRate;
if (!["0.5x", "1x", "2x", "off"].includes(rate)) fail("--rate must be 0.5x, 1x, 2x or off");
const energy = values.energy as Energy;
if (!["low", "medium", "high"].includes(energy)) fail("--energy must be low, medium or high");
if (!["en", "fr"].includes(values.lang!)) fail("--lang must be en or fr");
const variations = values.variations === undefined ? undefined : Number(values.variations);
if (variations !== undefined && (!Number.isInteger(variations) || variations < 1 || variations > 24)) fail("--variations must be a whole number from 1 to 24");
const seconds = (name: string, text: string) => {
  const n = Number(text);
  if (!Number.isFinite(n) || Math.abs(n) > 10) fail(`--${name} must be a number of seconds, e.g. 0.25 or -0.3`);
  return Math.round(n * 1000);
};
const offset = values["downbeat-offset"] === undefined ? undefined : Number(values["downbeat-offset"]);
if (offset !== undefined && ![0, 1, 2, 3].includes(offset)) fail("--downbeat-offset must be 0, 1, 2 or 3");
const parallel = values.parallel === undefined ? undefined : Number(values.parallel);
if (parallel !== undefined && (!Number.isInteger(parallel) || parallel < 1 || parallel > 6)) fail("--parallel must be a whole number from 1 to 6");
if (values.realign && values.lrc) fail("--realign and --lrc cannot be used together");

// Relative paths are relative to the folder the command was typed in.
const userCwd = process.env.INIT_CWD ?? process.cwd();
const resolve = (p?: string) => (p ? path.resolve(userCwd, p) : undefined);
const log = (m: string) => console.log(`  ${m}`);

const pad = (text: string, width: number) => text.padEnd(width);
let lastLine = "";
const showProgress = (states: RenderState[]) => {
  const done = states.filter((s) => s.status === "done" || s.status === "failed").length;
  const active = states
    .filter((s) => s.status === "rendering" || s.status === "checking")
    .map((s) => `${s.name} ${s.status === "checking" ? "QA" : `${String(Math.floor(s.progress * 100)).padStart(3)}%`}`);
  const line = `\rRendering  ${active.join("   ")}   (${done}/${states.length} done)`;
  if (line !== lastLine) {
    process.stdout.write(line.padEnd(lastLine.length));
    lastLine = line;
  }
};

const started = Date.now();
console.log("Preparing");
let result;
try {
  result = await makeVideos({
    song: resolve(positionals[0])!,
    lyrics: resolve(positionals[1])!,
    collection: values.collection,
    collectionPath: resolve(values["collection-path"]),
    variations,
    platforms: values.platforms,
    allowFill: values["allow-fill"],
    section: values.section,
    hint: resolve(values.hint),
    realign: values.realign,
    lrc: resolve(values.lrc),
    lang: values.lang,
    rate,
    energy,
    leadMs: seconds("lead", values.lead!),
    lyricsOffsetMs: values["lyrics-offset"] === undefined ? undefined : seconds("lyrics-offset", values["lyrics-offset"]),
    downbeatOffset: offset,
    font: values.font,
    fontHook: values["font-hook"],
    pins: resolve(values.pins),
    parallel,
    frameCheck: !values["no-frame-check"],
    resume: values.resume,
    onRetry: (name, error, concurrency) => {
      process.stdout.write("\n");
      console.log(`  ${name} failed (${error.split("\n")[0]}); retrying once with ${concurrency} frame${concurrency > 1 ? "s" : ""} in parallel and a smaller clip cache`);
      lastLine = "";
    },
    command: `pnpm make ${process.argv.slice(2).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`,
    log,
    onReady: (p) => {
      const c = p.collection;
      if (lastLine) process.stdout.write("\n");
      lastLine = "";
      console.log("");
      if (p.platform.index === 0) {
        console.log(`Project:   ${p.project.title}${p.project.created ? " (new)" : ""}`);
        console.log(`BPM:       ${p.bpm}   downbeat confidence ${p.downbeatConfidence.toFixed(2)}`);
        const how = { aligned: "aligned now", stored: "stored alignment", given: "given with --lrc" }[p.lyrics.source];
        console.log(`Lyrics:    ${p.lyrics.lines} lines (${p.lyrics.hooks} hook), ${how}: ${p.lyrics.file}`);
        if (p.lyricsOffsetMs) console.log(`           lyrics offset ${p.lyricsOffsetMs / 1000} s (project setting)`);
        for (const l of p.lyrics.low) console.log(`           low confidence ${l.confidence.toFixed(2)}: line ${l.number} "${l.text}"`);
        console.log(
          `Clips:     ${c.clips} in "${c.name}" (${c.added} new, ${c.changed} changed, ${c.unchanged} unchanged` +
            `${c.removed ? `, ${c.removed} removed from the collection` : ""}) from ${c.folder}`,
        );
        console.log(`Brand:     ${p.brand.file}${p.brand.created ? " (created with the defaults)" : ""}`);
        console.log(`Rendering: ${p.limit.explanation}`);
        console.log("");
      }
      const s = p.sources;
      console.log(`== ${p.platform.label} (${p.platform.index + 1}/${p.platform.count}) -> ${p.platform.folder}`);
      console.log(`Section:   ${clockText(p.section.start_ms)} - ${clockText(p.section.end_ms)}`);
      console.log(`           ${p.section.reason}`);
      console.log(
        `Sources:   ${s.usable} ${s.kind} usable` +
          (s.filled.length ? `, ${s.filled.length} with blurred fill` : "") +
          (s.skipped.length ? `, ${s.skipped.length} skipped (${s.kind === "vertical" ? "horizontal" : "vertical"}: ${s.skipped.join(", ")}; --allow-fill to use them)` : "") +
          (s.usable < s.needed ? `   WARNING: at least ${s.needed} needed` : ""),
      );
      console.log(`Cuts:      ${p.cuts} cuts, rate ${rate}, energy ${energy}`);
      if (p.resume) {
        console.log(
          `Resume:    ${p.exportDir}: ${p.resume.done} already done` +
            (p.resume.toRender.length ? `, rendering ${p.resume.toRender.join(", ")}` : ", nothing left to render"),
        );
      }
      for (const n of p.notes) console.log(`Note:      ${n}`);
      for (const w of p.warnings) console.log(`WARNING: ${w}`);
      console.log("");
    },
    onRenderProgress: showProgress,
  });
} catch (error) {
  fail((error as Error).message);
}
console.log("\n");

const rows = result.variations.map((v) => [
  v.platform,
  v.name,
  v.style === "simple" ? "Simple" : "Bold",
  v.order === "story" ? "story" : `shuffle (seed ${v.seed})`,
  v.bars ? "yes" : "-",
  `${v.durationS.toFixed(1)} s`,
  v.error ? `FAILED: ${v.error}` : `${v.qaSummary}${v.kept ? "   (kept from the earlier run)" : ""}${v.retried ? "   (rendered on the retry)" : ""}`,
]);
const header = ["Platform", "Variation", "Style", "Order", "Bars", "Duration", "QA"];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (i < 6 ? r[i].length : 0))));
console.log(header.map((h, i) => pad(h, widths[i])).join("  "));
for (const r of rows) console.log(r.map((c, i) => (i < 6 ? pad(c, widths[i]) : c)).join("  "));
for (const p of result.platforms.filter((p) => p.error)) console.log(`${p.name}: FAILED: ${p.error}`);
for (const w of result.warnings.filter((w) => w.includes(" skipped: "))) console.log(`Note: ${w}`);
console.log("");
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`Output:    ${result.exportDir}`);
console.log(
  result.platforms.length > 1 || result.platforms[0]?.name !== "standard"
    ? "           one folder per platform, each with v1.mp4 ..., v1.manifest.json (pnpm rerender <manifest>) and v1.qa.txt"
    : "           v1.mp4 ... with v1.manifest.json (rerender with: pnpm rerender <manifest>) and v1.qa.txt",
);
console.log(`Lyrics:    ${result.lrcFile} (clean synced LRC for Musixmatch / LyricFind)`);
if (!values["no-open"]) openFolder(result.exportDir);
const failed = result.variations.filter((v) => v.error);
if (failed.length || result.platforms.some((p) => p.error)) {
  console.log("");
  console.log(`${failed.length} variation(s) failed: ${failed.map((v) => v.name).join(", ")}. The others are finished.`);
  console.log("Render only the missing ones with the same command plus --resume (add --parallel 1 if it was higher).");
  process.exit(1);
}
