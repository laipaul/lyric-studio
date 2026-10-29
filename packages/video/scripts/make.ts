// pnpm make <song> <lyrics.txt> [--collection <name>] [--collection-path <folder>] [--variations 6]
//   (--collection is needed the first time per project; after that the last one is remembered)
//   [--section auto|full|0:11-1:10] [--hint <taps.lrc> | --no-hint] [--realign] [--lrc <file.lrc>] [--lang en|fr]
//   [--rate 1x] [--shot-length 1|2|4|8|story] [--tempo 92] [--energy medium] [--lead 0.25] [--lyrics-offset 0] [--downbeat-offset N]
//   [--font "Family"] [--font-hook "Family"] [--pins pins.txt] [--pictures "song,wedding"] [--parallel N] [--resume] [--no-open]
//   [--line-effect glide[:subtle|balanced|expressive]] [--hook-effect karaoke-highlight[:...]]
//   [--platforms reels,tiktok,shorts,youtube | all] [--allow-fill] [--title "Song title"]
//   [--cover cover.jpg] [--layout cover|stills|clips] [--stills stills.txt] [--no-grain] [--no-glow] [--ep "EP name"] [--artist "Pômé"]
// One command from a song to N finished variations with manifests and QA reports, per platform.

import { clockText } from "../src";
import { failureSummary, makeVideos, openFolder, parseMakeArgs, type RenderState } from "../src/node";

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

let parsed;
try {
  // Relative paths are relative to the folder the command was typed in.
  parsed = parseMakeArgs(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd());
} catch (error) {
  fail((error as Error).message);
}
const { options, noOpen } = parsed;
const rate = options.rate;
const energy = options.energy;
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
    ...options,
    onRetry: (name, error, concurrency) => {
      process.stdout.write("\n");
      console.log(`  ${name} failed (${error.split("\n")[0]}); retrying once with ${concurrency} frame${concurrency > 1 ? "s" : ""} in parallel and a smaller clip cache`);
      lastLine = "";
    },
    log,
    onReady: (p) => {
      const c = p.collection;
      if (lastLine) process.stdout.write("\n");
      lastLine = "";
      console.log("");
      if (p.platform.index === 0) {
        console.log(`Project:   ${p.project.title}${p.project.created ? " (new)" : ""}`);
        console.log(`BPM:       ${p.bpm}   downbeat confidence ${p.downbeatConfidence.toFixed(2)}   song length ${clockText(p.songMs)}`);
        const how = { aligned: "aligned now", stored: "stored alignment", given: "given with --lrc", story: "an instrumental: story.txt timed by the app" }[p.lyrics.source];
        console.log(`Lyrics:    ${p.lyrics.lines} lines (${p.lyrics.hooks} hook), ${how}: ${p.lyrics.file}`);
        if (p.lyricsOffsetMs) console.log(`           lyrics offset ${p.lyricsOffsetMs / 1000} s (project setting)`);
        for (const l of p.lyrics.low) console.log(`           low confidence ${l.confidence.toFixed(2)}: line ${l.number} "${l.text}"`);
        console.log(
          `Clips:     ${c.clips} in "${c.name}"${c.remembered ? " (remembered)" : ""} (${c.added} new, ${c.changed} changed, ${c.unchanged} unchanged` +
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
      if (p.layout) console.log(`Layout:    ${p.layout}`);
      if (p.effects) {
        const e = p.effects;
        console.log(`Effects:   verses ${e.verse} (${e.from.verse}), hooks ${e.hook} (${e.from.hook}), next line ${e.showNextLine ? "shown" : "hidden"}`);
      }
      if (s) {
        console.log(
          `Sources:   ${s.usable} ${s.kind} usable` +
            (s.filled.length ? `, ${s.filled.length} with blurred fill` : "") +
            (s.skipped.length ? `, ${s.skipped.length} skipped (${s.kind === "vertical" ? "horizontal" : "vertical"}: ${s.skipped.join(", ")}; --allow-fill to use them)` : "") +
            (s.usable < s.needed ? `   WARNING: at least ${s.needed} needed` : ""),
        );
        console.log(`Cuts:      ${p.cuts} cuts, rate ${rate}, energy ${energy}`);
      }
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
console.log("Captions:  a .srt next to every video (v1.srt, ...)");
for (const v of result.variations.filter((x) => x.thumbnailFile && !x.error)) {
  console.log(`YouTube:   ${v.thumbnailFile} (1280x720) and ${v.publishFile} (title, description, tags)`);
}
if (!noOpen) openFolder(result.exportDir);
const failures = failureSummary(result);
if (failures) {
  console.log("");
  for (const line of failures) console.log(line);
  process.exit(1);
}
