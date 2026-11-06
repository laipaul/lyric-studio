// pnpm hf:measure "<song folder>" [--lgpl "<folder with an LGPL ffmpeg>"] [--seconds 30]
// Theme Engine v2 on HyperFrames, step 1: the check of the target architecture (decision D1, 6 Nov 2026: B,
// HyperFrames draws everything in one pass). On the song's own ~30 s Reel plan (the planner's dry run, read only):
//   - render time: our current renderer (Remotion); B with the app's FFmpeg (libx264); B with an LGPL FFmpeg
//     and NVENC (--lgpl); A (the lyric layer over an FFmpeg picture: the temporary fallback, for reference);
//   - frame accuracy: a numbered test clip trimmed, slowed, jumping back and running out, through B (each
//     FFmpeg), A's picture and Remotion: every frame must be the planned source frame;
//   - the encoders at the same bitrate (10 s): libx264 vs NVENC, SSIM / PSNR against a near-lossless render;
//   - the LGPL FFmpeg's licence line and encoders;
//   - B's drawing at several worker counts and with / without Chrome on the GPU (to set the default per PC).
// The lyrics are the converter's stand-in look until the lyric effects move over (step 2), so B's picture is the
// plan's real cut and its words land on the planner's times, but the lyric look is not yet the song's own.
// Everything goes to WORKSPACE_DIR\cache\hf-measure\<song>\<time>\ with report.md. Nothing goes online.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { ffmpegBin, resolveWorkspaceDir } from "@lyric/db";

import { checkFrames, frameAccuracyText, frameTestProps, hfWorkers, makeNumberedClip, makeVideos, pictureLayer, readFrameNumbers, renderLyricVideo, renderWithHyperframes, songFolderFiles, type FrameAccuracy, type HfCaptureInfo } from "../src/node";
import { hyperframesGaps, type LyricVideoProps } from "../src";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { lgpl: { type: "string" }, seconds: { type: "string", default: "30" } } });
const fail = (m: string): never => {
  console.error(`\nError: ${m}`);
  process.exit(1);
};
if (positionals.length !== 1) fail('Usage: pnpm hf:measure "<song folder>" [--lgpl "<folder with an LGPL ffmpeg>"] [--seconds 30]');
if (Number(process.versions.node.split(".")[0]) < 22) fail(`HyperFrames needs Node.js 22 or newer; this is ${process.versions.node}.`);
const userCwd = process.env.INIT_CWD ?? process.cwd();
const songDir = path.resolve(userCwd, positionals[0]);
if (!existsSync(songDir)) fail(`${songDir} is not a song folder.`);
const appFfmpeg = ffmpegBin();
const exe = process.platform === "win32" ? ".exe" : "";
const lgpl = values.lgpl ? (existsSync(path.join(path.resolve(userCwd, values.lgpl), `ffmpeg${exe}`)) ? path.join(path.resolve(userCwd, values.lgpl), `ffmpeg${exe}`) : existsSync(path.join(path.resolve(userCwd, values.lgpl), "bin", `ffmpeg${exe}`)) ? path.join(path.resolve(userCwd, values.lgpl), "bin", `ffmpeg${exe}`) : fail(`No ffmpeg${exe} in ${values.lgpl} (or its bin folder).`)) : null;

const ws = resolveWorkspaceDir();
const title = path.basename(songDir);
const out = path.join(ws, "cache", "hf-measure", title.replace(/[<>:"/\\|?*]/g, "_"), new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16));
mkdirSync(out, { recursive: true });
const log = (m: string) => console.log(m);
const times: Record<string, number> = {};
const stages: Record<string, Record<string, number>> = {};
const caps: Record<string, Partial<HfCaptureInfo>> = {};
const timed = async <T>(key: string, label: string, f: () => Promise<T>): Promise<T | null> => {
  log(`\n${label}...`);
  const t0 = Date.now();
  try {
    const r = await f();
    times[key] = (Date.now() - t0) / 1000;
    log(`  ${times[key].toFixed(1)} s`);
    return r;
  } catch (error) {
    log(`  FAILED: ${(error as Error).message.split("\n").slice(0, 3).join(" ")}`);
    notes.push(`${label}: failed (${(error as Error).message.split("\n")[0]})`);
    return null;
  }
};
const notes: string[] = [];
const size = (f: string) => (existsSync(f) ? `${(statSync(f).size / 2 ** 20).toFixed(1)} MB` : "—");

// ---- the LGPL FFmpeg
/** Plain reason from FFmpeg's stderr: the h264_nvenc lines without their "[h264_nvenc @ ...] " prefix, else the last non-empty line. */
const nvencFailureReason = (stderr: string): string => {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const own = lines.filter((l) => /^\[h264_nvenc @ [^\]]*\]/.test(l)).map((l) => l.replace(/^\[[^\]]*\]\s*/, ""));
  return own.length ? own.join(" ") : (lines[lines.length - 1] ?? "");
};
let nvenc = false;
let lgplLine = "not given (--lgpl)";
if (lgpl) {
  const v = execFileSync(lgpl, ["-hide_banner", "-version"], { encoding: "utf8" });
  const conf = v.match(/configuration:(.*)/)?.[1] ?? "";
  const licence = /--enable-gpl/.test(conf) ? "GPL (not LGPL!)" : /--enable-nonfree/.test(conf) ? "non-free (not redistributable!)" : "LGPL";
  const encoders = execFileSync(lgpl, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  const probe = spawnSync(lgpl, ["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=s=1280x720:d=0.2", "-c:v", "h264_nvenc", "-f", "null", "-"], { encoding: "utf8" });
  nvenc = probe.status === 0;
  const nvencReason = nvenc ? "" : nvencFailureReason(probe.stderr ?? "");
  lgplLine = `${v.split(/\r?\n/)[0].trim()}; licence ${licence}; h264_nvenc ${/h264_nvenc/.test(encoders) ? (nvenc ? "works" : `listed but the GPU refused it${nvencReason ? `: ${nvencReason}` : ""}`) : "missing"}; libvpx-vp9 ${/libvpx-vp9/.test(encoders) ? "yes" : "missing"}; libx264 ${/libx264/.test(encoders) ? "present (then it is not LGPL)" : "absent"}`;
  log(`LGPL FFmpeg: ${lgplLine}`);
}

// ---- the song's plan (our pipeline, read only)
const files = songFolderFiles(songDir);
const planned = await makeVideos({
  workspaceDir: ws, song: files.song, lyrics: files.lyrics, ...(files.hints ? { hint: files.hints } : {}), songFolder: songDir,
  platforms: "reels", section: "auto", length: Number(values.seconds), dryRun: true, frameCheck: false, log: () => {},
});
const plan = planned.platforms[0]?.plan ?? fail(planned.platforms[0]?.error ?? "no plan");
const props = plan.videos[0].props;
const media = plan.media;
const bitrate = "10M";
log(`${title}: ${(props.durationInFrames / 30).toFixed(1)} s, ${props.shots.length} shots, ${props.lyrics.length} lines. B cannot draw yet (the stand-in lyric look is used): ${hyperframesGaps(props, "all", { standInLyrics: true }).join(", ") || "nothing missing"}`);

// ---- render times on the song (Remotion warmed up first: its first render of a session builds its bundle)
const R = path.join(out, "R-remotion.mp4");
await timed("Rwarm", "Current renderer (Remotion): warm-up, 1 s", () => renderLyricVideo({ props: { ...props, durationInFrames: 30 }, media, outFile: path.join(out, "R-warmup.mp4"), log: () => {} }));
await timed("R", "Current renderer (Remotion), 9:16", () => renderLyricVideo({ props, media, outFile: R, videoBitrate: bitrate, log: () => {} }));
const B = path.join(out, "B-hyperframes-x264.mp4");
await timed("B", "B: HyperFrames everything in one, app FFmpeg (libx264)", () => renderWithHyperframes({ props, media, outFile: B, mode: "all", workDir: path.join(out, "work-B"), encoder: { bitrate }, timings: (stages.B = {}), capture: (caps.B = {}) }));
const BN = path.join(out, "B-hyperframes-nvenc.mp4");
if (lgpl && nvenc) await timed("BN", "B: HyperFrames everything in one, LGPL FFmpeg + NVENC", () => renderWithHyperframes({ props, media, outFile: BN, mode: "all", workDir: path.join(out, "work-BN"), encoder: { ffmpeg: lgpl, video: "nvenc", bitrate }, timings: (stages.BN = {}), capture: (caps.BN = {}) }));
const A = path.join(out, "A-lyrics-over-ffmpeg.mp4");
await timed("A", "A (temporary fallback): lyric layer + FFmpeg picture (libx264)", () => renderWithHyperframes({ props, media, outFile: A, mode: "lyrics", workDir: path.join(out, "work-A"), encoder: { bitrate }, timings: (stages.A = {}), capture: (caps.A = {}) }));

// ---- B's drawing: worker counts and Chrome on the GPU (each a full render of the plan; only the drawing differs)
const cpus = os.cpus().length;
const chosen = hfWorkers(props.durationInFrames);
const sweep: { label: string; workers: number | "auto"; browserGpu?: boolean }[] = [
  { label: "HyperFrames' own choice", workers: "auto" },
  ...[...new Set([2, 4, 8, 12, 16, chosen])].filter((w) => w <= cpus).sort((a, b) => a - b).map((w) => ({ label: `${w} workers${w === chosen ? " (our choice)" : ""}`, workers: w })),
  { label: `${chosen} workers, Chrome on the GPU`, workers: chosen, browserGpu: true },
  { label: `${chosen} workers, Chrome without the GPU`, workers: chosen, browserGpu: false },
];
const sweepRows: string[] = [];
for (const [i, run] of sweep.entries()) {
  const file = path.join(out, `sweep-${i}.mp4`);
  const st: Record<string, number> = {};
  const cap: Partial<HfCaptureInfo> = {};
  const ok = await timed(`sw${i}`, `B drawing: ${run.label}`, () => renderWithHyperframes({ props, media, outFile: file, mode: "all", workDir: path.join(out, `work-sw${i}`), encoder: { bitrate }, timings: st, capture: cap, workers: run.workers, ...(run.browserGpu !== undefined ? { browserGpu: run.browserGpu } : {}) }));
  sweepRows.push(`| ${run.label} | ${ok === null ? "failed" : `${times[`sw${i}`].toFixed(1)} s`} | ${cap.workers ?? "?"} | ${cap.capture ?? "?"} | ${cap.gpu ?? "?"} | ${cap.setupS ?? "?"} s | ${cap.captureS ?? "?"} s |`);
  rmSync(path.join(out, `work-sw${i}`), { recursive: true, force: true });
  rmSync(file, { force: true });
}

// ---- frame accuracy
const ft = path.join(out, "frame-test");
await makeNumberedClip(path.join(ft, "clips", "numbered.mp4"), appFfmpeg);
const tp = frameTestProps("clips/numbered.mp4");
const tmedia = { workspaceDir: ft };
const acc: Record<string, FrameAccuracy | null> = {};
const accuracy = async (key: string, label: string, render: (file: string) => Promise<unknown>) => {
  const file = path.join(ft, `${key}.mp4`);
  const ok = await timed(`acc-${key}`, `Frame accuracy: ${label}`, () => render(file));
  acc[key] = ok === null ? null : checkFrames(await readFrameNumbers(file, appFfmpeg));
  if (acc[key]) log(`  ${frameAccuracyText(acc[key]!)}`);
};
await accuracy("B", "B (app FFmpeg)", (f) => renderWithHyperframes({ props: tp, media: tmedia, outFile: f, mode: "all", workDir: path.join(ft, "work-B") }));
if (lgpl && nvenc) await accuracy("BN", "B (LGPL FFmpeg + NVENC)", (f) => renderWithHyperframes({ props: tp, media: tmedia, outFile: f, mode: "all", workDir: path.join(ft, "work-BN"), encoder: { ffmpeg: lgpl, video: "nvenc" } }));
await accuracy("A", "A's FFmpeg picture", (f) => pictureLayer(tp, tmedia, f, { ffmpeg: appFfmpeg, video: "x264" }));
await accuracy("R", "current renderer (Remotion)", (f) => renderLyricVideo({ props: tp, media: tmedia, outFile: f, log: () => {} }));

// ---- encoders at the same bitrate (10 s of the song's plan)
const quality: string[] = [];
if (lgpl && nvenc) {
  const ten = 300;
  const short: Omit<LyricVideoProps, "mediaBaseUrl"> = {
    ...props,
    durationInFrames: ten,
    shots: props.shots.filter((s) => s.start < ten).map((s) => ({ ...s, duration: Math.min(s.duration, ten - s.start) })),
    lyrics: props.lyrics.filter((l) => l.startFrame < ten).map((l) => ({ ...l, endFrame: Math.min(l.endFrame, ten) })),
    dips: props.dips?.filter((d) => d.frame < ten),
    audio: null,
  };
  const ref = path.join(out, "q-reference.mp4");
  const okRef = await timed("qref", "Quality: a near-lossless 10 s reference (B, CRF 2)", async () => {
    await renderWithHyperframes({ props: short, media, outFile: ref, mode: "all", workDir: path.join(out, "work-q"), encoder: { crf: 2 } });
    return true;
  });
  if (okRef) {
    for (const [key, args] of [["x264", ["-c:v", "libx264", "-preset", "medium"]], ["nvenc", ["-c:v", "h264_nvenc", "-preset", "p5"]]] as const) {
      const file = path.join(out, `q-${key}.mp4`);
      const enc = key === "x264" ? appFfmpeg : lgpl;
      await timed(`q-${key}`, `Quality: ${key} at ${bitrate}`, async () => execFileSync(enc, ["-y", "-v", "error", "-i", ref, ...args, "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate, "-pix_fmt", "yuv420p", file]));
      const s = spawnSync(appFfmpeg, ["-hide_banner", "-i", file, "-i", ref, "-lavfi", "[0:v][1:v]ssim;[0:v][1:v]psnr", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      const ssim = s.match(/SSIM .*All:([\d.]+)/)?.[1] ?? "?";
      const psnr = s.match(/PSNR .*average:([\d.inf]+)/)?.[1] ?? "?";
      quality.push(`| ${key} | ${bitrate} | ${size(file)} | ${ssim} | ${psnr} dB | ${(times[`q-${key}`] ?? 0).toFixed(1)} s |`);
    }
  }
}

// ---- report
const t = (k: string) => (times[k] !== undefined ? `${times[k].toFixed(1)} s` : "—");
const st = (k: string) => (stages[k] ? Object.entries(stages[k]).map(([n, v]) => `${n} ${v.toFixed(1)} s`).join(", ") + (caps[k]?.workers ? ` (${caps[k].workers} workers, ${caps[k].capture} capture, ${caps[k].gpu} GPU)` : "") : "");
const ratio = times.B && times.R ? ` (${((times.B / times.R) * 100).toFixed(0)}% of Remotion)` : "";
const accLine = (k: string) => (acc[k] ? frameAccuracyText(acc[k]!) : "not run");
const machine = `${os.cpus()[0]?.model ?? "?"} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.platform()} ${os.release()}, Node ${process.versions.node}`;
const report = [
  `# HyperFrames step 1 check: ${title}`,
  "",
  `${new Date().toISOString()} · ${machine}`,
  "",
  `Plan: the planner's Reel section, ${(props.durationInFrames / 30).toFixed(1)} s, ${props.shots.length} shots, ${props.lyrics.length} lines (9:16). Target architecture: B (decided 6 Nov 2026).`,
  "",
  "## Render time (the same plan)",
  "",
  "| Renderer | Time | Size | Stages |",
  "| --- | --- | --- | --- |",
  `| Current renderer (Remotion) | ${t("R")} | ${size(R)} | |`,
  `| **B: HyperFrames, everything in one (libx264)** | **${t("B")}**${ratio} | ${size(B)} | ${st("B")} |`,
  `| B: HyperFrames + LGPL FFmpeg + NVENC | ${t("BN")} | ${size(BN)} | ${st("BN")} |`,
  `| A (temporary fallback): lyric layer + FFmpeg picture | ${t("A")} | ${size(A)} | ${st("A")} |`,
  "",
  `Remotion was warmed up first (${t("Rwarm")} for 1 s: its first render builds its bundle).`,
  "",
  `## B's drawing (${cpus} cores; our choice: ${chosen} workers)`,
  "",
  "| Run | Time | Workers | Capture | Chrome GPU | Setup | Drawing |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...sweepRows,
  "",
  "## Frame accuracy (numbered test clip: trims, 0.5x, 0.75x, a jump back, a held last frame; 240 frames)",
  "",
  `- **B (app FFmpeg): ${accLine("B")}**`,
  `- B (LGPL FFmpeg + NVENC): ${accLine("BN")}`,
  `- A's FFmpeg picture: ${accLine("A")}`,
  `- Current renderer (Remotion): ${accLine("R")}`,
  "",
  "## LGPL FFmpeg",
  "",
  lgplLine,
  ...(quality.length ? ["", "Encoders at the same bitrate (10 s of the plan, against a near-lossless render; SSIM 1 = identical):", "", "| Encoder | Bitrate | Size | SSIM | PSNR | Encode time |", "| --- | --- | --- | --- | --- | --- |", ...quality] : []),
  "",
  ...(notes.length ? ["## Notes", "", ...notes.map((n) => `- ${n}`), ""] : []),
  "Lyrics in B and A are the converter's stand-in look (the song's own effects move over in step 2).",
  "",
].join("\n");
writeFileSync(path.join(out, "report.md"), report);
log(`\n${report}\nThe files and report.md are in: ${out}`);
process.exit(0);
