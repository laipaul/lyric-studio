// pnpm hf:parity "<song folder>" [--seconds 30]
// Theme Engine v2 on HyperFrames, step 2a: the song's own Reel plan (the planner's dry run, read only) drawn by
// the current renderer and by HyperFrames without the words (the lyric look moves over in step 2b), compared
// frame by frame. Also says what of this plan HyperFrames cannot draw yet. Writes report.md, both videos and a
// side-by-side picture of the least similar frame to WORKSPACE_DIR\cache\hf-parity\<song>\<time>\.
// Nothing goes online.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { ffmpegBin, resolveWorkspaceDir } from "@lyric/db";

import { hyperframesGaps } from "../src";
import { compareVideos, makeVideos, parityPasses, parityProps, parityText, renderLyricVideo, renderWithHyperframes, songFolderFiles } from "../src/node";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { seconds: { type: "string", default: "30" } } });
const fail = (m: string): never => {
  console.error(`\nError: ${m}`);
  process.exit(1);
};
if (positionals.length !== 1) fail('Usage: pnpm hf:parity "<song folder>" [--seconds 30]');
if (Number(process.versions.node.split(".")[0]) < 22) fail(`HyperFrames needs Node.js 22 or newer; this is ${process.versions.node}.`);
const songDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]);
if (!existsSync(songDir)) fail(`${songDir} is not a song folder.`);
const ff = ffmpegBin();
const ws = resolveWorkspaceDir();
const title = path.basename(songDir);
const out = path.join(ws, "cache", "hf-parity", title.replace(/[<>:"/\\|?*]/g, "_"), new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16));
mkdirSync(out, { recursive: true });

const files = songFolderFiles(songDir);
const planned = await makeVideos({
  workspaceDir: ws, song: files.song, lyrics: files.lyrics, ...(files.hints ? { hint: files.hints } : {}), songFolder: songDir,
  platforms: "reels", section: "auto", length: Number(values.seconds), dryRun: true, frameCheck: false, log: () => {},
});
const plan = planned.platforms[0]?.plan ?? fail(planned.platforms[0]?.error ?? "no plan");
const full = plan.videos[0].props;
const props = parityProps(full);
const media = plan.media;
const gaps = hyperframesGaps(full);
const pictureGaps = hyperframesGaps(props, { standInLyrics: true });
console.log(`${title}: ${(full.durationInFrames / 30).toFixed(1)} s, ${full.shots.length} shots${full.shots.some((s) => s.kind === "photo") ? " (with photos)" : ""}${full.loopInto ? ", loop ending" : ""}${full.dips?.length ? `, ${full.dips.length} dips` : ""}, grade ${full.picture?.grade ?? "natural"}, vignette ${full.picture?.vignette ?? "off"}.`);

const R = path.join(out, "R-remotion-picture.mp4");
const B = path.join(out, "B-hyperframes-picture.mp4");
const timed = async (label: string, f: () => Promise<unknown>) => {
  console.log(`${label}...`);
  const t0 = Date.now();
  await f();
  const s = (Date.now() - t0) / 1000;
  console.log(`  ${s.toFixed(1)} s`);
  return s;
};
let tr: number | null = null;
let tb: number | null = null;
let parity: Awaited<ReturnType<typeof compareVideos>> | null = null;
if (pictureGaps.length) console.log(`HyperFrames cannot draw this picture yet: ${pictureGaps.join(", ")}`);
else {
  tr = await timed("The picture with the current renderer (Remotion)", () => renderLyricVideo({ props, media, outFile: R, videoBitrate: "20M", log: () => {} }));
  tb = await timed("The picture with HyperFrames", () => renderWithHyperframes({ props, media, outFile: B, workDir: path.join(out, "work"), encoder: { bitrate: "20M" } }));
  parity = await compareVideos(R, B, ff, path.join(out, "compare"));
  const w = parity.worst[0]?.frame ?? 0;
  execFileSync(ff, ["-y", "-v", "error", "-i", R, "-i", B, "-filter_complex", `[0:v]select=eq(n\\,${w}),scale=540:960[a];[1:v]select=eq(n\\,${w}),scale=540:960[b];[a][b]hstack`, "-frames:v", "1", path.join(out, "least-similar-frame.png")]);
}

const report = [
  `# HyperFrames step 2a: the Reel picture of ${title}`,
  "",
  `Plan: the planner's Reel section, ${(full.durationInFrames / 30).toFixed(1)} s, ${full.shots.length} shots, ${full.lyrics.length} lines; drawn without the words (they move over in step 2b).`,
  "",
  `- **Picture: ${parity ? parityText(parity) : `not compared (HyperFrames cannot draw ${pictureGaps.join(", ")} yet)`}**`,
  `- Time: current renderer ${tr !== null ? `${tr.toFixed(1)} s` : "—"}, HyperFrames ${tb !== null ? `${tb.toFixed(1)} s` : "—"}`,
  `- Still to move over for this video (steps 2b and later): ${gaps.join(", ") || "nothing"}`,
  "",
  parity ? "least-similar-frame.png: that frame, the current renderer left, HyperFrames right." : "",
  "",
].join("\n");
writeFileSync(path.join(out, "report.md"), report);
console.log(`\n${report}\nThe files and report.md are in: ${out}`);
process.exit(parity && !parityPasses(parity) ? 1 : 0);
