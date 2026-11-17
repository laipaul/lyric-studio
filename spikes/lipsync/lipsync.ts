// Lip Sync, step 1 (spike): one clip + one or more lyric lines of a song -> lip-synced versions from three fal.ai
// models and a side-by-side comparison. Not part of the app: it only reads the workspace (database read-only).
//
//   pnpm lipsync "<song>" --list
//   pnpm lipsync "<song>" --clip "<path>" --lines 12,13 [--pad 0.2] [--providers sync,kling,infinitetalk] [--max-cost 3] [--yes]
//   pnpm lipsync "<song>" --clip "<path>" --lines chorus:2 --yes
//   pnpm lipsync "<song>" --clip "<path>" --from 61.2 --to 66.8 --yes
//
// Results: spikes\lipsync\out\<song>\<clip>_line<N>\ (one folder per line). See README.md.
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { checkResult, reportMarkdown, verdict, type JobReport, type ProviderReport } from "./src/checks";
import { audioDuration, comparisonArgs, ffmpeg, findTools, hasFilter, plays, probeVideo, reviewArgs, sliceAudioArgs, trimClipArgs, type Panel, type Tools } from "./src/media";
import { clipTooShort, klingSize, money, parseSelection, PROVIDER_IDS, providerLimit, resolveWindows, safeName, type ProviderId, type Window } from "./src/plan";
import { DEFAULT_PROMPT, errorText, PROVIDERS, runWithRetry, type Attempt } from "./src/providers";
import { envIgnored, loadEnv, readSong, REPO_ROOT, workspaceDir, type Song } from "./src/song";

const HERE = path.join(REPO_ROOT, "spikes", "lipsync");
let OUT = path.join(HERE, "out");

export class Stop extends Error {}

function args(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project: { type: "string" },
      clip: { type: "string" },
      "clip-start": { type: "string" },
      lines: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      pad: { type: "string" },
      providers: { type: "string" },
      "max-cost": { type: "string" },
      prompt: { type: "string" },
      "timeout-min": { type: "string" },
      yes: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
    },
  });
  const project = values.project ?? positionals.join(" ");
  if (!project.trim()) throw new Stop('Which song? pnpm lipsync "<song title>" --list');
  const num = (v: string | undefined, def: number, name: string) => {
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Stop(`--${name} takes a number (got "${v}").`);
    return n;
  };
  const providers = (values.providers ?? PROVIDER_IDS.join(",")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = providers.filter((p) => !(PROVIDER_IDS as readonly string[]).includes(p));
  if (unknown.length) throw new Stop(`Unknown provider "${unknown.join(", ")}": use ${PROVIDER_IDS.join(", ")}.`);
  return {
    project,
    clip: values.clip,
    clipStartS: num(values["clip-start"], 0, "clip-start"),
    lines: values.lines,
    from: values.from,
    to: values.to,
    padS: num(values.pad, 0.2, "pad"),
    providers: providers as ProviderId[],
    maxCost: num(values["max-cost"], 3, "max-cost"),
    prompt: values.prompt?.trim() || DEFAULT_PROMPT,
    timeoutMs: num(values["timeout-min"], 20, "timeout-min") * 60_000,
    yes: values.yes,
    list: values.list,
  };
}

function listLines(song: Song): void {
  console.log(`\n${song.title} — ${song.artist}: ${song.lines.length} lines (numbers as on the Lyrics tab; ♪ = chorus)\n`);
  for (const l of song.lines) {
    const t = l.startMs === null || l.endMs === null ? "   (not timed)   " : `${((l.startMs + song.offsetMs) / 1000).toFixed(2).padStart(7)}–${((l.endMs + song.offsetMs) / 1000).toFixed(2).padEnd(7)}`;
    console.log(`${String(l.number).padStart(3)} ${l.isHook ? "♪" : " "} ${t}  ${l.text}`);
  }
  console.log(`\nVocal stem: ${song.vocals ? path.basename(song.vocals) : "none in the Vocals slot"}`);
}

type Prepared = {
  window: Window;
  dir: string;
  clipFile: string;
  klingFile: string | null; // a resized copy for Kling (720-1920 px per side), when the clip is outside that
  audioFile: string;
  mixFile: string;
  audioS: number;
  plan: { id: ProviderId; cost: number; skip: string | null }[];
};

function jobDir(song: Song, clip: string, w: Window): string {
  const base = path.join(OUT, safeName(song.title), `${safeName(path.parse(clip).name)}_${w.label}`);
  // A folder with a finished run is kept as it is: the next run goes next to it.
  let dir = base;
  for (let n = 2; existsSync(path.join(dir, "report.json")); n++) dir = `${base} (${n})`;
  return dir;
}

function prepare(t: Tools, song: Song, clip: string, clipInfo: { width: number; height: number }, w: Window, a: Args): Prepared {
  const dir = jobDir(song, clip, w);
  mkdirSync(dir, { recursive: true });
  const audioFile = path.join(dir, "audio_slice.wav");
  const mixFile = path.join(dir, "mix_slice.wav");
  const clipFile = path.join(dir, "clip_trimmed.mp4");
  ffmpeg(t, sliceAudioArgs(song.vocals!, w.startS, w.durationS, audioFile, "pcm_s16le"));
  ffmpeg(t, sliceAudioArgs(song.audio, w.startS, w.durationS, mixFile, "pcm_s24le"));
  ffmpeg(t, trimClipArgs(clip, a.clipStartS, w.durationS, clipFile));
  const audioS = audioDuration(t, audioFile);
  const size = klingSize(clipInfo.width, clipInfo.height);
  let klingFile: string | null = null;
  if (size && a.providers.includes("kling")) {
    klingFile = path.join(dir, "clip_for_kling.mp4");
    ffmpeg(t, trimClipArgs(clipFile, 0, w.durationS, klingFile, size));
  }
  const bytes = statSync(audioFile).size;
  const plan = a.providers.map((id) => ({ id, cost: PROVIDERS[id].estimateCost(w.durationS), skip: providerLimit(id, w.durationS, bytes) }));
  return { window: w, dir, clipFile, klingFile, audioFile, mixFile, audioS, plan };
}

// The model's video, with up to 3 tries (a dropped connection is not a failed model).
async function download(url: string, file: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`the result could not be downloaded (${errorText(last)}); it is still on fal.ai under the request ID in report.json`);
}

function labelFont(): string | null {
  try {
    const req = createRequire(path.join(REPO_ROOT, "packages", "video", "package.json"));
    return req.resolve("@fontsource/inter/files/inter-latin-600-normal.woff");
  } catch {
    return null;
  }
}

async function runJob(t: Tools, fal: Fal, song: Song, clip: string, prep: Prepared, a: Args): Promise<JobReport> {
  const w = prep.window;
  const tag = w.line ? `line ${w.line.number}` : w.label;
  const log = (m: string) => console.log(`  [${tag}] ${m}`);
  const clipInfo = probeVideo(t, prep.clipFile)!;

  log("uploading the clip and the vocal slice to fal storage…");
  const up = async (file: string, type: string) => fal.storage.upload(new File([readFileSync(file)], path.basename(file), { type }));
  const audioUrl = await up(prep.audioFile, "audio/wav");
  const videoUrl = await up(prep.clipFile, "video/mp4");
  const klingUrl = prep.klingFile ? await up(prep.klingFile, "video/mp4") : null;

  const reports = await Promise.all(
    prep.plan.map(async ({ id, cost, skip }): Promise<ProviderReport> => {
      const p = PROVIDERS[id];
      const base: ProviderReport = { id, name: p.name, endpoint: p.endpoint, status: "skipped", attempts: [], estimated_cost_usd: round2(cost) };
      if (skip) return { ...base, reason: skip };
      const started = Date.now();
      let attempts: Attempt[] = [];
      try {
        const job = { videoUrl: id === "kling" && klingUrl ? klingUrl : videoUrl, audioUrl, durationS: w.durationS, prompt: a.prompt };
        const r = await runWithRetry(fal, p, job, { timeoutMs: a.timeoutMs, pollMs: 5000, log });
        attempts = r.attempts;
        const file = path.join(prep.dir, `${id}.mp4`);
        const review = path.join(prep.dir, `${id}_review.mp4`);
        await download(r.url, file);
        ffmpeg(t, reviewArgs(file, prep.mixFile, review));
        const info = probeVideo(t, file);
        const checks = checkResult(clipInfo, prep.audioS, info, plays(t, file));
        if (id === "kling" && prep.klingFile) {
          const k = probeVideo(t, prep.klingFile)!;
          checks.push({ name: "kling-input", level: "info", message: `Kling was sent a copy resized to ${k.width}×${k.height} (it takes 720–1920 px per side).` });
        }
        const seconds = (Date.now() - started) / 1000;
        log(`${p.name}: downloaded in ${Math.round(seconds)} s`);
        return {
          ...base,
          status: "done",
          attempts,
          seconds,
          billed_cost_usd: round2(cost),
          output: { file: path.basename(file), review: path.basename(review), width: info?.width ?? 0, height: info?.height ?? 0, fps: info?.fps ?? 0, duration_s: info?.durationS ?? 0 },
          checks,
          verdict: verdict(checks),
        };
      } catch (error) {
        const tried = (error as { attempts?: Attempt[] }).attempts ?? attempts;
        return { ...base, status: "failed", attempts: tried, seconds: (Date.now() - started) / 1000, reason: errorText(error) };
      }
    }),
  );

  // comparison.mp4: the original + each result, side by side, sound = the full mix.
  const done = reports.filter((r) => r.status === "done" && r.output && r.output.width > 0);
  let comparison: JobReport["comparison"] = { file: null, note: "no model returned a video." };
  if (done.length) {
    const panels: Panel[] = [
      { file: prep.clipFile, label: "Original", aspect: clipInfo.width / clipInfo.height },
      ...done.map((r) => ({ file: path.join(prep.dir, r.output!.file), label: r.name, aspect: r.output!.width / r.output!.height })),
    ];
    const font = hasFilter(t, "drawtext") ? labelFont() : null;
    const fontCopy = font ? path.join(prep.dir, "label-font.woff") : null;
    try {
      if (font && fontCopy) copyFileSync(font, fontCopy);
      // Relative paths with cwd = the job folder: no drive letters inside the filter (Windows-safe).
      const rel = (f: string) => path.relative(prep.dir, f).split(path.sep).join("/");
      const relPanels = panels.map((p) => ({ ...p, file: rel(p.file) }));
      ffmpeg(t, comparisonArgs(relPanels, rel(prep.mixFile), w.durationS, clipInfo.fps || 30, clipInfo.height, "comparison.mp4", fontCopy ? "label-font.woff" : null), prep.dir);
      comparison = { file: "comparison.mp4", note: `${panels.map((p) => p.label).join(" | ")}, left to right, with the full song.${font ? "" : " (No labels: this FFmpeg has no drawtext.)"}` };
    } catch (error) {
      comparison = { file: null, note: `the side-by-side video could not be made (${errorText(error)}).` };
    } finally {
      if (fontCopy) rmSync(fontCopy, { force: true });
    }
  }

  const rel = (f: string) => path.basename(f);
  return {
    created_at: new Date().toISOString(),
    song: song.title,
    part: {
      label: w.label,
      line: w.line?.number ?? null,
      text: w.line?.text ?? null,
      sung_start_s: w.sungStartS,
      sung_end_s: w.sungEndS,
      start_s: w.startS,
      end_s: w.endS,
      duration_s: w.durationS,
      pad_s: a.padS,
    },
    clip: { path: clip, start_s: a.clipStartS, width: clipInfo.width, height: clipInfo.height, fps: clipInfo.fps, duration_s: clipInfo.durationS },
    vocal_stem: path.basename(song.vocals!),
    files: { clip: rel(prep.clipFile), audio: rel(prep.audioFile), mix: rel(prep.mixFile), ...(prep.klingFile ? { clip_for_kling: rel(prep.klingFile) } : {}) },
    providers: reports,
    comparison,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

type Args = ReturnType<typeof args>;
type Fal = import("@fal-ai/client").FalClient;
// Tests pass a stand-in fal client, an output folder and an environment (never the real key).
export type Deps = { fal?: Fal; out?: string; env?: Record<string, string> };

export async function run(argv: string[], deps: Deps = {}): Promise<void> {
  if (deps.out) OUT = deps.out;
  const a = args(argv);
  const env = deps.env ?? loadEnv();
  const ws = workspaceDir(env);
  const song = readSong(ws, a.project);
  if (a.list) return listLines(song);

  const tools = findTools(env);
  if (typeof tools === "string") throw new Stop(tools);
  console.log("FFmpeg: found.");
  if (!song.vocals) throw new Stop(`"${song.title}" has no vocal stem in its Vocals slot: add it on Prepare → Assets (any file name), then run this again.`);
  if (!a.clip) throw new Stop('Which clip? --clip "D:\\path\\to\\clip.mp4"');
  const clip = path.resolve(a.clip);
  if (!existsSync(clip)) throw new Stop(`Clip not found: ${clip}`);
  const clipInfo = probeVideo(tools, clip);
  if (!clipInfo) throw new Stop(`Cannot read ${clip} as a video.`);

  let windows: Window[];
  try {
    windows = resolveWindows(song.lines, parseSelection(a.lines, a.from, a.to), { padS: a.padS, offsetMs: song.offsetMs, songDurationS: song.durationS });
  } catch (error) {
    throw new Stop((error as Error).message);
  }

  console.log(`\n${song.title}: ${windows.length} part${windows.length > 1 ? "s" : ""} (one folder each), vocal stem "${path.basename(song.vocals)}", clip ${path.basename(clip)} (${clipInfo.width}×${clipInfo.height}, ${clipInfo.fps.toFixed(2)} fps, ${clipInfo.durationS.toFixed(2)} s)\n`);
  const jobs: Prepared[] = [];
  for (const w of windows) {
    const head = w.line ? `Line ${w.line.number} “${w.line.text}”` : `Part ${w.label}`;
    const short = clipTooShort(clipInfo.durationS, w.durationS, a.clipStartS);
    if (short) {
      console.log(`${head}: STOPPED. ${short}`);
      continue;
    }
    const prep = prepare(tools, song, clip, clipInfo, w, a);
    jobs.push(prep);
    console.log(`${head}: ${w.startS.toFixed(2)}–${w.endS.toFixed(2)} s (${w.durationS.toFixed(2)} s)`);
    for (const p of prep.plan) console.log(`   ${PROVIDERS[p.id].name.padEnd(16)} ${p.skip ? `skipped: ${p.skip}` : `est. ${money(p.cost)}`}`);
  }
  if (!jobs.length) throw new Stop("Nothing to send.");
  const total = jobs.reduce((s, j) => s + j.plan.filter((p) => !p.skip).reduce((x, p) => x + p.cost, 0), 0);
  console.log(`\nEstimated total: ${money(total)} (cap ${money(a.maxCost)}; prices as fal.ai lists them, your fal.ai dashboard shows the real charge)`);
  if (total > a.maxCost)
    throw new Stop(`The estimate (${money(total)}) is above the cap of ${money(a.maxCost)}: nothing was uploaded. Pick fewer lines or providers, or raise the cap with --max-cost ${Math.ceil(total)}.`);
  if (!a.yes) {
    console.log("Nothing was uploaded. Add --yes to run it.");
    return;
  }

  if (deps.fal) {
    for (const prep of jobs) await finish(tools, deps.fal, song, clip, prep, a);
    return;
  }
  if (!envIgnored()) throw new Stop(".env is not in .gitignore: add a line `.env` there first, so your fal key never goes to git.");
  const key = env.FAL_KEY?.trim();
  if (!key) throw new Stop("No FAL_KEY in .env: add a line FAL_KEY=<your key from fal.ai → Dashboard → API keys> to D:\\videomaker\\.env.");
  let createFalClient: typeof import("@fal-ai/client").createFalClient;
  try {
    ({ createFalClient } = await import("@fal-ai/client"));
  } catch {
    throw new Stop("The fal client is not installed yet. First time only: cd spikes\\lipsync; npm install; cd ..\\..");
  }
  const fal = createFalClient({ credentials: key, suppressLocalCredentialsWarning: true });
  for (const prep of jobs) await finish(tools, fal, song, clip, prep, a);
}

async function finish(tools: Tools, fal: Fal, song: Song, clip: string, prep: Prepared, a: Args): Promise<void> {
  console.log(`\n${prep.window.line ? `Line ${prep.window.line.number}` : prep.window.label}:`);
  const report = await runJob(tools, fal, song, clip, prep, a);
  writeFileSync(path.join(prep.dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(prep.dir, "report.md"), reportMarkdown(report));
  for (const p of report.providers) console.log(`  ${p.name}: ${p.status === "done" ? p.verdict : `${p.status}: ${p.reason}`}`);
  console.log(`  → ${report.comparison.file ? path.join(prep.dir, report.comparison.file) : prep.dir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(`\n${error instanceof Stop ? error.message : `Error: ${errorText(error)}`}`);
    process.exitCode = 1;
  });
}
