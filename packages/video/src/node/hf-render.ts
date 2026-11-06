// Rendering with HyperFrames (Theme Engine v2 on HyperFrames, step 1): the converter's composition
// (src/hf/compile.ts) written as a HyperFrames project, rendered by its command line, and finished with our own
// FFmpeg step (the song cut to the section and added untouched).
//
// Zero network calls while rendering (decided by the user, 6 Nov 2026): every HyperFrames call runs with its
// telemetry, update checks, automatic installs and feedback off, its cache inside the project
// (.cache/hyperframes), and the Chrome that `pnpm hf:setup` downloaded once (a render never downloads one:
// without it, it stops and says to run the setup). Fonts are only our own files under our own family names, so
// HyperFrames never looks a family up (tested: test/hf-network.test.ts records every connection of a render).
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, REPO_ROOT } from "@lyric/db";

import { VIDEO } from "../config";
import { compileHyperframes, type HfComposition } from "../hf/compile";
import type { LyricVideoProps } from "../props";
import { bundledFontDirs } from "./font-catalog";
import { resolveMediaPath, type MediaRoots } from "./media";

const FPS = VIDEO.fps;
const require = createRequire(import.meta.url);
type Props = Omit<LyricVideoProps, "mediaBaseUrl">;

export const HF_CACHE_DIR = path.join(REPO_ROOT, ".cache", "hyperframes");
const BROWSER_FILE = path.join(HF_CACHE_DIR, "browser-path.txt");

// The environment of every HyperFrames call: nothing leaves the PC.
export function hyperframesEnv(extra: { ffmpeg?: string; ffprobe?: string } = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HYPERFRAMES_CACHE_DIR: HF_CACHE_DIR,
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    HYPERFRAMES_SKIP_UPDATE_CHECK: "1",
    HYPERFRAMES_NO_AUTO_INSTALL: "1",
    HYPERFRAMES_NO_OPTIONAL_INSTALL: "1",
    HYPERFRAMES_NO_FEEDBACK: "1",
    HYPERFRAMES_NO_PREVIEW_DISCOVERY: "1",
    HYPERFRAMES_NO_CAPTURE_DOTENV: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    CI: "1",
    ...(extra.ffmpeg ? { HYPERFRAMES_FFMPEG_PATH: extra.ffmpeg } : {}),
    ...(extra.ffprobe ? { HYPERFRAMES_FFPROBE_PATH: extra.ffprobe } : {}),
    HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH || hyperframesBrowser(),
  };
}

// The Chrome HyperFrames renders with: HYPERFRAMES_BROWSER_PATH, else the one `pnpm hf:setup` downloaded.
export function hyperframesBrowser(): string {
  const saved = existsSync(BROWSER_FILE) ? readFileSync(BROWSER_FILE, "utf8").trim() : "";
  if (saved && existsSync(saved)) return saved;
  throw new Error("HyperFrames has no browser yet: run `pnpm hf:setup` once (it downloads its Chrome into .cache\\hyperframes; renders never go online).");
}

export function hyperframesCli(): string {
  const pkgFile = require.resolve("hyperframes/package.json");
  const bin = (JSON.parse(readFileSync(pkgFile, "utf8")) as { bin: string | Record<string, string> }).bin;
  return path.join(path.dirname(pkgFile), typeof bin === "string" ? bin : bin.hyperframes);
}

export function runHyperframes(args: string[], o: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<string> {
  return new Promise((ok, bad) => {
    const child = spawn(process.execPath, [hyperframesCli(), ...args], { cwd: o.cwd, env: o.env ?? hyperframesEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", bad);
    child.on("close", (code) => (code === 0 ? ok(out) : bad(new Error(`hyperframes ${args[0]} failed:\n${out.slice(-3000)}`))));
  });
}

// `pnpm hf:setup`: HyperFrames' Chrome, downloaded once into the project (the only time it goes online).
export async function setupHyperframes(log: (m: string) => void = () => {}): Promise<string> {
  mkdirSync(HF_CACHE_DIR, { recursive: true });
  const env = { ...hyperframesEnv0(), HYPERFRAMES_CACHE_DIR: HF_CACHE_DIR };
  log("HyperFrames: making sure its Chrome is in .cache\\hyperframes (downloaded once, ~150 MB)");
  await runHyperframes(["browser", "ensure"], { cwd: REPO_ROOT, env });
  const out = await runHyperframes(["browser", "path"], { cwd: REPO_ROOT, env });
  const browser = out.trim().split(/\r?\n/).pop()!.trim();
  if (!existsSync(browser)) throw new Error(`HyperFrames reported a browser that is not there: ${browser}`);
  writeFileSync(BROWSER_FILE, `${browser}\n`);
  return browser;
}
// The setup's own environment (no browser yet to point at).
function hyperframesEnv0(): NodeJS.ProcessEnv {
  const rest = { ...process.env };
  delete rest.HYPERFRAMES_BROWSER_PATH;
  return { ...rest, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_SKIP_UPDATE_CHECK: "1", HYPERFRAMES_NO_FEEDBACK: "1", HYPERFRAMES_SKIP_SKILLS: "1", CI: "1" };
}

// ---------------------------------------------------------------- the project

const media = (roots: MediaRoots) => ({ ...roots, fontDirs: roots.fontDirs ?? bundledFontDirs() });

// Writes the composition into `dir` with its files (hard links where the drive allows, else copies).
export function writeHyperframesProject(comp: HfComposition, dir: string, roots: MediaRoots, ffmpeg = ffmpegBin()): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "assets", "gsap.min.js"));
  for (const a of comp.assets) {
    const from = resolveMediaPath(a.src, media(roots));
    if (!from || !existsSync(from)) throw new Error(`HyperFrames: file not found for ${a.src}`);
    const to = path.join(dir, ...a.dest.split("/"));
    mkdirSync(path.dirname(to), { recursive: true });
    if (a.frame !== undefined) {
      // One frame of a clip as a picture (the loop ending's held first frame): exactly that frame, lossless.
      execFileSync(ffmpeg, ["-y", "-v", "error", "-i", from, "-vf", `select=eq(n\\,${a.frame})`, "-frames:v", "1", to], { windowsHide: true });
      continue;
    }
    try {
      linkSync(from, to);
    } catch {
      copyFileSync(from, to);
    }
  }
  writeFileSync(path.join(dir, "index.html"), comp.html);
}

// ---------------------------------------------------------------- FFmpeg: the song

export type Encoder = { ffmpeg: string; video: "x264" | "nvenc"; bitrate?: string | null; crf?: number };
export function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((ok, bad) => {
    const child = spawn(ffmpeg, ["-y", "-v", "error", ...args], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", bad);
    child.on("close", (code) => (code === 0 ? ok() : bad(new Error(`ffmpeg failed: ${err.slice(-2000)}`))));
  });
}

// The song itself, cut to the section; a fade only where the music is cut (the props' own fades). AAC 320k.
export async function sectionAudio(props: Props, roots: MediaRoots, out: string, ffmpeg = ffmpegBin()): Promise<string | null> {
  const a = props.audio;
  if (!a) return null;
  const durationS = props.durationInFrames / FPS;
  const fadeIn = a.fadeInFrames / FPS;
  const fadeOut = a.fadeOutFrames / FPS;
  const fades = [fadeIn > 0 ? `afade=t=in:d=${fadeIn}` : "", fadeOut > 0 ? `afade=t=out:st=${(durationS - fadeOut).toFixed(3)}:d=${fadeOut}` : ""].filter(Boolean).join(",");
  const song = resolveMediaPath(a.src, media(roots));
  if (!song) throw new Error(`HyperFrames: song not found (${a.src})`);
  await runFfmpeg(ffmpeg, ["-ss", (a.startFrame / FPS).toFixed(4), "-t", durationS.toFixed(4), "-i", song, ...(fades ? ["-af", fades] : []), "-c:a", "aac", "-b:a", "320k", out]);
  return out;
}

// ---------------------------------------------------------------- how many frames are drawn at once

// HyperFrames draws a video with several Chromes side by side ("workers"). Left to itself it is very careful (on
// 4 cores it chose 1 worker: 103 s; with 4: 49 s, the same frames) and spends seconds calibrating first. We
// choose: one worker per core, no more than half the memory allows (~1.5 GB each, HyperFrames' own figure), at
// least 30 frames each, at most 16; measured per PC by `pnpm hf:measure`.
export function hfWorkers(totalFrames: number, machine: { cpus: number; memoryGB: number } = { cpus: os.cpus().length, memoryGB: os.totalmem() / 2 ** 30 }): number {
  return Math.max(1, Math.min(machine.cpus, Math.floor((machine.memoryGB * 0.5) / 1.5), Math.floor(totalFrames / 30), 16));
}

// What HyperFrames reports about a render: workers, how frames were captured, whether Chrome had the GPU.
export type HfCaptureInfo = { workers: number | null; capture: string | null; gpu: string | null; setupS: number | null; captureS: number | null };
const seconds = (t: string | undefined) => {
  if (!t) return null;
  const m = t.match(/(?:(\d+)m\s*)?([\d.]+)s/);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null;
};
export function parseHfOutput(out: string): HfCaptureInfo {
  const text = out.replace(/\r/g, "\n");
  const workers = [...text.matchAll(/"phase":"worker_resolution"[^\n]*?"workerCount":(\d+)/g)].pop()?.[1];
  const summary = text.split("\n").reverse().find((l) => / capture · .* gpu · /.test(l)) ?? "";
  return {
    workers: workers ? Number(workers) : null,
    capture: summary.match(/(\S+) capture ·/)?.[1] ?? null,
    gpu: summary.match(/· (\S+) gpu ·/)?.[1] ?? null,
    setupS: seconds(summary.match(/setup ((?:\d+m )?[\d.]+s)/)?.[1]),
    captureS: seconds(summary.match(/· capture ((?:\d+m )?[\d.]+s)/)?.[1]),
  };
}

// ---------------------------------------------------------------- the whole render

export type HfRenderOptions = {
  props: Props;
  media: MediaRoots;
  outFile: string;
  workDir: string; // the HyperFrames project and its intermediate files go here
  encoder?: Partial<Encoder>; // default: the app's FFmpeg, libx264 at the props' bitrate
  log?: (m: string) => void;
  timings?: Record<string, number>; // filled in: seconds per stage
  workers?: number | "auto"; // default: hfWorkers() for this video ("auto": HyperFrames' own choice)
  browserGpu?: boolean; // Chrome on the graphics card (true) or not (false); default: HyperFrames decides
  capture?: Partial<HfCaptureInfo>; // filled in: what HyperFrames reported
};

export async function renderWithHyperframes(o: HfRenderOptions): Promise<string> {
  const log = o.log ?? (() => {});
  const e: Encoder = { ffmpeg: o.encoder?.ffmpeg ?? ffmpegBin(), video: o.encoder?.video ?? "x264", bitrate: o.encoder?.bitrate ?? null, ...(o.encoder?.crf !== undefined ? { crf: o.encoder.crf } : {}) };
  const ffprobe = path.join(path.dirname(e.ffmpeg), path.basename(e.ffmpeg).replace(/ffmpeg/i, "ffprobe"));
  const env = hyperframesEnv({ ffmpeg: e.ffmpeg === "ffmpeg" ? undefined : e.ffmpeg, ffprobe: e.ffmpeg !== "ffmpeg" && existsSync(ffprobe) ? ffprobe : undefined });
  const t = o.timings ?? {};
  const timed = async <T>(key: string, f: () => Promise<T>) => {
    const t0 = Date.now();
    const r = await f();
    t[key] = (Date.now() - t0) / 1000;
    return r;
  };
  const comp = compileHyperframes(o.props);
  const project = path.join(o.workDir, "hf-all");
  writeHyperframesProject(comp, project, o.media, e.ffmpeg);
  const audio = path.join(o.workDir, "audio.m4a");
  await timed("audio", () => sectionAudio(o.props, o.media, audio, e.ffmpeg));
  const hasAudio = !!o.props.audio;
  const workers = o.workers ?? hfWorkers(o.props.durationInFrames);
  const drawArgs = ["--workers", String(workers), ...(o.browserGpu === true ? ["--browser-gpu"] : o.browserGpu === false ? ["--no-browser-gpu"] : [])];
  const draw = async (args: string[]) => {
    const out = await runHyperframes([...args, ...drawArgs], { cwd: project, env });
    Object.assign(o.capture ?? {}, parseHfOutput(out));
  };
  const video = path.join(o.workDir, "hf-all.mp4");
  log(`HyperFrames: rendering ${comp.width}x${comp.height}, everything in one (${e.video === "nvenc" ? "NVENC" : "libx264"})`);
  await timed("hyperframes", () =>
    draw(["render", project, "--format", "mp4", "--output", video, ...(e.video === "nvenc" ? ["--gpu"] : []), ...(e.bitrate ? ["--video-bitrate", e.bitrate] : e.crf !== undefined ? ["--crf", String(e.crf)] : [])]),
  );
  await timed("mux", () => runFfmpeg(e.ffmpeg, ["-i", video, ...(hasAudio ? ["-i", audio, "-map", "0:v", "-map", "1:a", "-c:a", "copy"] : ["-map", "0:v"]), "-c:v", "copy", "-movflags", "+faststart", "-shortest", o.outFile]));
  if (!existsSync(o.outFile) || statSync(o.outFile).size === 0) throw new Error("HyperFrames: no video was written");
  return o.outFile;
}
