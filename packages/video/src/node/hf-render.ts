// Rendering with HyperFrames (Theme Engine v2 on HyperFrames, step 1): the converter's composition
// (src/hf/compile.ts) written as a HyperFrames project, rendered by its command line, and finished with our own
// FFmpeg step (the song cut to the section and added untouched; in "lyrics" mode also the picture underneath).
//
// Zero network calls while rendering (decided by the user, 6 Nov 2026): every HyperFrames call runs with its
// telemetry, update checks, automatic installs and feedback off, its cache inside the project
// (.cache/hyperframes), and the Chrome that `pnpm hf:setup` downloaded once (a render never downloads one:
// without it, it stops and says to run the setup). Fonts are only our own files under our own family names, so
// HyperFrames never looks a family up (tested: test/hf-network.test.ts records every connection of a render).
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { ffmpegBin, REPO_ROOT } from "@lyric/db";

import { VIDEO } from "../config";
import { compileHyperframes, type HfComposition, type HfMode } from "../hf/compile";
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
export function writeHyperframesProject(comp: HfComposition, dir: string, roots: MediaRoots): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "assets", "gsap.min.js"));
  for (const a of comp.assets) {
    const from = resolveMediaPath(a.src, media(roots));
    if (!from || !existsSync(from)) throw new Error(`HyperFrames: file not found for ${a.src}`);
    const to = path.join(dir, ...a.dest.split("/"));
    mkdirSync(path.dirname(to), { recursive: true });
    try {
      linkSync(from, to);
    } catch {
      copyFileSync(from, to);
    }
  }
  writeFileSync(path.join(dir, "index.html"), comp.html);
}

// ---------------------------------------------------------------- FFmpeg: the song and the picture

export type Encoder = { ffmpeg: string; video: "x264" | "nvenc"; bitrate?: string | null; crf?: number };
const videoArgs = (e: Encoder) =>
  e.video === "nvenc"
    ? ["-c:v", "h264_nvenc", "-preset", "p5", ...(e.bitrate ? ["-b:v", e.bitrate, "-maxrate", e.bitrate, "-bufsize", e.bitrate] : ["-cq", "19"])]
    : ["-c:v", "libx264", "-preset", "medium", ...(e.bitrate ? ["-b:v", e.bitrate, "-maxrate", e.bitrate, "-bufsize", e.bitrate] : ["-crf", "18"])];

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

// "lyrics" mode: the picture the plan asks for, built by FFmpeg (the same shots as the composition's "all"
// mode): each shot trimmed, at its speed, its last frame held when the clip runs out, laid on a black frame in
// order; dissolves as an alpha fade of the incoming shot; dips as a black layer.
export async function pictureLayer(props: Props, roots: MediaRoots, out: string, e: Encoder): Promise<void> {
  const width = props.format?.width ?? VIDEO.width;
  const height = props.format?.height ?? VIDEO.height;
  const total = props.durationInFrames;
  const inputs: string[] = ["-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:r=${FPS}:d=${(total / FPS).toFixed(4)}`];
  const chains: string[] = [];
  let last = "[0:v]";
  props.shots.forEach((s, i) => {
    const src = resolveMediaPath(s.src, media(roots));
    if (!src) throw new Error(`HyperFrames: clip not found (${s.src})`);
    inputs.push("-i", src);
    const before = s.dissolve?.before ?? 0;
    const from = s.start - before;
    const length = s.duration + before + (s.tail ?? 0);
    const need = Math.ceil(length * s.playbackRate) + 1;
    const fade = s.dissolve ? `,fade=t=in:st=0:d=${((s.dissolve.before + s.dissolve.after) / FPS).toFixed(4)}:alpha=1` : "";
    chains.push(
      `[${i + 1}:v]trim=start_frame=${s.clipStartFrame}:end_frame=${s.clipStartFrame + need},setpts=(PTS-STARTPTS)/${s.playbackRate},fps=${FPS},` +
        `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,tpad=stop_mode=clone:stop=${length},trim=end_frame=${length},` +
        `format=yuva420p${fade},setpts=PTS-STARTPTS+${(from / FPS).toFixed(4)}/TB[c${i}]`,
    );
    chains.push(`${last}[c${i}]overlay=eof_action=pass:format=auto[o${i}]`);
    last = `[o${i}]`;
  });
  if (props.dips?.length) {
    const expr = props.dips.map((d) => `max(0,1-abs(n-${d.frame})/${Math.max(1, d.frames / 2)})`).reduce((a, b) => `max(${a},${b})`);
    chains.push(`color=c=black:s=${width}x${height}:r=${FPS}:d=${(total / FPS).toFixed(4)},format=yuva420p,geq=lum=0:cb=128:cr=128:a='255*min(1,${expr})'[dip]`);
    chains.push(`${last}[dip]overlay=format=auto[od]`);
    last = "[od]";
  }
  chains.push(`${last}format=yuv420p,trim=end_frame=${total}[v]`);
  await runFfmpeg(e.ffmpeg, [...inputs, "-filter_complex", chains.join(";"), "-map", "[v]", ...videoArgs(e), "-r", String(FPS), "-an", out]);
}

// ---------------------------------------------------------------- the whole render

export type HfRenderOptions = {
  props: Props;
  media: MediaRoots;
  outFile: string;
  mode: HfMode;
  workDir: string; // the HyperFrames project and its intermediate files go here
  encoder?: Partial<Encoder>; // default: the app's FFmpeg, libx264 at the props' bitrate
  log?: (m: string) => void;
  timings?: Record<string, number>; // filled in: seconds per stage
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
  const comp = compileHyperframes(o.props, { mode: o.mode });
  const project = path.join(o.workDir, `hf-${o.mode}`);
  writeHyperframesProject(comp, project, o.media);
  const audio = path.join(o.workDir, "audio.m4a");
  await timed("audio", () => sectionAudio(o.props, o.media, audio, e.ffmpeg));
  const hasAudio = !!o.props.audio;
  if (o.mode === "all") {
    const video = path.join(o.workDir, "hf-all.mp4");
    log(`HyperFrames: rendering ${comp.width}x${comp.height}, everything in one (${e.video === "nvenc" ? "NVENC" : "libx264"})`);
    await timed("hyperframes", () =>
      runHyperframes(["render", project, "--format", "mp4", "--output", video, "--quiet", ...(e.video === "nvenc" ? ["--gpu"] : []), ...(e.bitrate ? ["--video-bitrate", e.bitrate] : e.crf !== undefined ? ["--crf", String(e.crf)] : [])], { cwd: project, env }),
    );
    await timed("mux", () => runFfmpeg(e.ffmpeg, ["-i", video, ...(hasAudio ? ["-i", audio, "-map", "0:v", "-map", "1:a", "-c:a", "copy"] : ["-map", "0:v"]), "-c:v", "copy", "-movflags", "+faststart", "-shortest", o.outFile]));
  } else {
    const layer = path.join(o.workDir, "hf-lyrics.webm");
    const picture = path.join(o.workDir, "picture.mp4");
    log(`HyperFrames: rendering the lyric layer ${comp.width}x${comp.height} (transparent WebM)`);
    await timed("hyperframes", () => runHyperframes(["render", project, "--format", "webm", "--output", layer, "--quiet"], { cwd: project, env }));
    await timed("picture", () => pictureLayer(o.props, o.media, picture, { ...e, bitrate: null, video: e.video === "nvenc" ? "nvenc" : "x264" }));
    await timed("mux", () =>
      runFfmpeg(e.ffmpeg, [
        "-i", picture, "-c:v", "libvpx-vp9", "-i", layer, ...(hasAudio ? ["-i", audio] : []),
        "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]", ...(hasAudio ? ["-map", "2:a", "-c:a", "copy"] : []),
        ...videoArgs(e), "-frames:v", String(o.props.durationInFrames), "-movflags", "+faststart", "-shortest", o.outFile,
      ]),
    );
  }
  if (!existsSync(o.outFile) || statSync(o.outFile).size === 0) throw new Error("HyperFrames: no video was written");
  return o.outFile;
}
