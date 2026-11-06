// Theme Engine v2, step 1: the HyperFrames spike. Not part of the app (nothing in apps/ or packages/ changes).
//
//   pnpm exec tsx spikes/hyperframes/spike.ts "<song folder>" [--seconds 30] [--format webm|mov] [--no-compare]
//                                            [--section 0:41-1:12] [--trace "word"]
//
// 1. Our normal pipeline, unchanged: the song's lyric timing (the stored alignment, the vocal stem, the
//    hand-set starts and the vocal-start check: the signed-off sync; aligned once with `timeLyrics` only
//    when nothing is stored) and the planner's beat cuts, as a dry run of the same code Generate renders
//    with. The section is the planner's own Reel section aimed at ~30 s (hook first, never starting inside a
//    sung line), or a fixed one with --section.
// 2. timing.json: the planner's word times for that section (our output; nothing hand-written).
// 3. The theme template (template/theme.html, HTML + GSAP) filled in twice from that one file: 1920x1080
//    and 1080x1920, rendered by HyperFrames as TRANSPARENT video (WebM VP9 with alpha, or ProRes 4444).
// 4. FFmpeg: the beat-cut clips from the plan's shot list (16:9: the same vertical clips over a blurred
//    copy of themselves), the song cut to the section (no other change to the music), and the lyric layer
//    laid over them.
// 5. For comparison, our current renderer (Remotion) renders the same 9:16 plan (--no-compare skips it).
// 6. A sync check on the rendered pixels: the frame where each word lands against its sung start.
// Everything goes to spikes/hyperframes/out/<song>/<time>/ with report.md. Telemetry of HyperFrames is off.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const IS_WIN = process.platform === "win32";
const FPS = 30;
const WINDOW = 6; // sync check: frames around a word's start (0.2 s)
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// ---------------------------------------------------------------- arguments and setup

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seconds: { type: "string", default: "30" },
    format: { type: "string", default: "webm" },
    "no-compare": { type: "boolean", default: false },
    section: { type: "string" }, // a fixed section ("0:41.2-1:12.0") instead of the planner's own choice
    trace: { type: "string" }, // a word to print frame by frame in the sync check (e.g. "break.")
  },
});
const fail = (m: string): never => {
  console.error(`\nError: ${m}`);
  process.exit(1);
};
if (positionals.length !== 1) fail('Usage: pnpm exec tsx spikes/hyperframes/spike.ts "<song folder>" [--seconds 30] [--format webm|mov] [--no-compare] [--section 0:41-1:12] [--trace "word"]');
const seconds = Number(values.seconds);
if (!(seconds >= 10 && seconds <= 90)) fail("--seconds must be 10-90");
const format = values.format as "webm" | "mov";
if (!["webm", "mov"].includes(format)) fail("--format must be webm or mov");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) fail(`HyperFrames needs Node.js 22 or newer; this is ${process.versions.node}. Install Node.js 22 LTS (see spikes/hyperframes/README.md).`);

// The spike's own packages (HyperFrames, GSAP, puppeteer-core) live in spikes/hyperframes/node_modules.
const hfBin = path.join(HERE, "node_modules", ".bin", IS_WIN ? "hyperframes.cmd" : "hyperframes");
if (!existsSync(hfBin)) {
  console.log("Installing the spike's packages (HyperFrames, GSAP) into spikes/hyperframes (one time)...");
  const r = spawnSync(IS_WIN ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: HERE, stdio: "inherit", shell: IS_WIN });
  if (r.status !== 0 || !existsSync(hfBin)) fail("npm install in spikes/hyperframes failed (see above).");
}
// HyperFrames' command line, started with this Node (no shell: song titles have spaces).
const hfPkg = path.join(HERE, "node_modules", "hyperframes");
const hfBinField = (JSON.parse(readFileSync(path.join(hfPkg, "package.json"), "utf8")) as { bin: string | Record<string, string> }).bin;
const hfEntry = path.join(hfPkg, typeof hfBinField === "string" ? hfBinField : hfBinField.hyperframes);
// No usage data leaves the PC.
const hfEnv = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", CI: "1" };

const userCwd = process.env.INIT_CWD ?? process.cwd();
const songDir = path.resolve(userCwd, positionals[0]);
if (!existsSync(songDir) || !statSync(songDir).isDirectory()) fail(`${songDir} is not a song folder.`);

const { openWorkspace, resolveWorkspaceDir } = await import("../../packages/db/src/index.ts");
const node = await import("../../packages/video/src/node/index.ts");
const { lyricArea } = await import("../../packages/video/src/platform.ts");
const workspaceDir = resolveWorkspaceDir();
const files = node.songFolderFiles(songDir);
const title = path.basename(songDir);
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const outDir = path.join(HERE, "out", title.replace(/[<>:"/\\|?*]/g, "_"), stamp);
mkdirSync(outDir, { recursive: true });
const log = (m: string) => console.log(m);
const times: Record<string, number> = {};
const timed = async <T>(key: string, label: string, f: () => Promise<T> | T): Promise<T> => {
  log(`\n${label}...`);
  const t0 = Date.now();
  const r = await f();
  times[key] = (Date.now() - t0) / 1000;
  log(`  ${label}: ${times[key].toFixed(1)} s`);
  return r;
};
const ffmpeg = (args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args], { stdio: ["ignore", "ignore", "inherit"] });
const secs = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;

log(`HyperFrames spike: ${title}`);
log(`  workspace ${workspaceDir}`);
log(`  output    ${outDir}`);

// ---------------------------------------------------------------- 1. our pipeline: sync + beat cuts

const plan = async (section?: string, length?: number) => {
  const r = await node.makeVideos({
    workspaceDir, song: files.song, lyrics: files.lyrics, ...(files.hints ? { hint: files.hints } : {}), songFolder: songDir,
    platforms: "reels", dryRun: true, frameCheck: false, ...(section ? { section } : {}), ...(length ? { length } : {}), log: () => {},
  });
  const p = r.platforms[0];
  if (p.error || !p.plan) throw new Error(p.error ?? "no plan");
  return p.plan;
};
const first = await timed("sync", "Our lyric timing and beat analysis (the stored alignment; never changed)", async () => {
  try {
    return await plan();
  } catch (error) {
    if (!/make a video first|no stored alignment|aligns/i.test((error as Error).message)) throw error;
    // Nothing aligned yet for these lyrics: our normal lyric timing (alignment on the vocal stem, hand-set
    // starts, vocal-start check), stored as Generate would store it. Needs the AI packages.
    log("  no stored alignment yet: running our lyric timing once (pnpm audio:setup --ai is needed)");
    const ws = openWorkspace(workspaceDir);
    try {
      const sp = await node.findOrCreateSongProject(ws, files.song);
      const t = await node.timeLyrics(ws, sp.project.id, { log: (m) => log(`  ${m}`) });
      log(`  ${t.summary}`);
    } finally {
      ws.close();
    }
    return plan();
  }
});
void first; // the first plan: the lyric timing is stored and cached for the next one
// The section: the planner's own Reel section aimed at `seconds` (hook first, never starting or ending inside a
// sung line: it moves back to the bar before a line still being sung), as Generate chooses it. --section
// forces a fixed section exactly as given (a line may then be on screen already at the first frame).
const section = values.section ?? "auto";
const chorus = await timed("cuts", values.section ? `Our beat cuts for the fixed section ${values.section}` : `Our section (the planner's choice for about ${seconds} s, hook first) and its beat cuts`, () => plan(section, values.section ? undefined : seconds));
log(`  section ${secs(chorus.section.start_ms)} - ${secs(chorus.section.end_ms)}: ${chorus.section.reason}`);
const video = chorus.videos[0];
const props = video.props;
const durationS = props.durationInFrames / FPS;
log(`  ${props.shots.length} shots, ${props.lyrics.length} lines on screen, ${durationS.toFixed(1)} s, ${Math.round(chorus.analysis.bpm)} BPM`);

// ---------------------------------------------------------------- 2. timing.json (the planner's output)

const media = { ...chorus.media, fontDirs: node.bundledFontDirs() };
const resolve = (src: string) => node.resolveMediaPath(src, media) ?? fail(`Not found: ${src}`);
const accent = props.lyricEffects?.accent ?? "#E8A3B5";
const timing = {
  song: title,
  section: { from_ms: chorus.section.start_ms, to_ms: chorus.section.end_ms },
  source: "Videomaker planner (makeVideos dry run): the stored alignment after the vocal-start check and the hand-set starts",
  fps: FPS,
  accent,
  // Seconds from the segment's first frame. show / hide: the line's on-screen window (our display rules:
  // 0.25 s before its stamp, gone 1 s after its last word before a pause); words: their sung starts.
  lines: props.lyrics.map((l) => ({
    text: l.text,
    hook: !!l.isHook,
    show: l.startFrame / FPS, // before 0: already on screen at the first frame (drawn settled)
    hide: Math.min(props.durationInFrames, l.endFrame) / FPS,
    words: (l.words?.length ? l.words : spread(l)).map((w) => ({ text: w.text, start: w.startFrame / FPS, end: w.endFrame / FPS })),
  })),
  style: { revealS: 0.22, risePx: 18, blurPx: 6, settleS: 0.7, glowPx: 18, hookGlowPx: 28, lineFadeS: 0.25 },
};
// Without aligned word times (should not happen with a stored alignment): spread over the line, as the app does.
function spread(l: (typeof props.lyrics)[number]) {
  const words = l.text.split(/\s+/).filter(Boolean);
  const a = l.stampFrame ?? l.startFrame;
  const b = l.sungEndFrame ?? l.endFrame;
  return words.map((text, k) => ({ text, startFrame: a + Math.round(((b - a) * k) / words.length), endFrame: a + Math.round(((b - a) * (k + 1)) / words.length) }));
}
writeFileSync(path.join(outDir, "timing.json"), `${JSON.stringify(timing, null, 2)}\n`);
log(`\ntiming.json: ${timing.lines.length} lines, ${timing.lines.reduce((n, l) => n + l.words.length, 0)} words (from our planner)`);

// ---------------------------------------------------------------- 3. the theme, filled in per format

const presets = node.loadPresets();
const reels = presets.reels;
const youtube = presets.youtube;
const baseSize = props.textSize / reels.textScale; // the style's size before the platform's scale
type Fmt = { key: "16x9" | "9x16"; width: number; height: number; area: { left: number; right: number; centerY: number }; size: number };
const formats: Fmt[] = [
  { key: "16x9", width: 1920, height: 1080, area: lyricArea({ width: 1920, height: 1080 }, youtube.safeZone, youtube.lyricsAt), size: Math.round(baseSize * youtube.textScale) },
  { key: "9x16", width: 1080, height: 1920, area: props.lyricArea ?? lyricArea({ width: 1080, height: 1920 }, reels.safeZone, reels.lyricsAt), size: props.textSize },
];
const verseFont = props.style;
const fontFiles = props.fonts.filter((f) => f.family === verseFont.font && f.weight === verseFont.weight && f.style === (verseFont.italic ? "italic" : "normal"));
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildComposition(f: Fmt): string {
  const dir = path.join(outDir, `composition-${f.key}`);
  mkdirSync(path.join(dir, "assets", "fonts"), { recursive: true });
  copyFileSync(path.join(HERE, "node_modules", "gsap", "dist", "gsap.min.js"), path.join(dir, "assets", "gsap.min.js"));
  const faces = fontFiles.map((ff) => {
    const name = path.basename(resolve(ff.src));
    copyFileSync(resolve(ff.src), path.join(dir, "assets", "fonts", name));
    return `@font-face { font-family: "${ff.family}"; src: url("assets/fonts/${name}") format("woff2"); font-weight: ${ff.weight}; font-style: ${ff.style};${ff.unicodeRange ? ` unicode-range: ${ff.unicodeRange};` : ""} }`;
  });
  const linesHtml = timing.lines
    .map((l, i) => {
      const words = l.words.map((w, k) => `<span class="w" id="l${i}w${k}">${esc(w.text)}</span>`).join(" ");
      const from = Math.max(0, l.show);
      return `      <div id="l${i}" class="line clip${l.hook ? " hook" : ""}" data-start="${from.toFixed(3)}" data-duration="${(l.hide - from).toFixed(3)}" data-track-index="1"><div class="inner">${words}</div></div>`;
    })
    .join("\n");
  const fill: Record<string, string> = {
    WIDTH: String(f.width), HEIGHT: String(f.height), DURATION: durationS.toFixed(3), FONT_FACES: faces.join("\n      "),
    ACCENT: accent, FONT: verseFont.font, SIZE: String(f.size), WEIGHT: String(verseFont.weight), FONT_STYLE: verseFont.italic ? "italic" : "normal",
    AREA_LEFT: String(f.area.left), AREA_WIDTH: String(f.area.right - f.area.left), AREA_CENTER_Y: String(f.area.centerY),
    LINES: linesHtml, TIMING: JSON.stringify(timing).replace(/</g, "\\u003c"),
  };
  const html = readFileSync(path.join(HERE, "template", "theme.html"), "utf8").replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => fill[k] ?? fail(`template: no value for ${k}`));
  writeFileSync(path.join(dir, "index.html"), html);
  return dir;
}

const hf = (args: string[], cwd: string) =>
  new Promise<void>((ok, bad) => {
    const child = spawn(process.execPath, [hfEntry, ...args], { cwd, env: hfEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => (code === 0 ? ok() : bad(new Error(`hyperframes ${args[0]} failed:\n${out.slice(-3000)}`))));
  });

// ---------------------------------------------------------------- 4. FFmpeg: clips, song, overlay

function backgroundVertical(file: string) {
  const inputs: string[] = [];
  const chains: string[] = [];
  props.shots.forEach((s, i) => {
    const src = resolve(s.src);
    if (s.kind === "photo") inputs.push("-loop", "1", "-framerate", String(FPS), "-i", src);
    else inputs.push("-i", src);
    const need = Math.ceil(s.duration * s.playbackRate) + 1;
    const head = s.kind === "photo" ? "" : `trim=start_frame=${s.clipStartFrame}:end_frame=${s.clipStartFrame + need},setpts=(PTS-STARTPTS)/${s.playbackRate},`;
    chains.push(`[${i}:v]${head}fps=${FPS},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,tpad=stop_mode=clone:stop=${s.duration},trim=end_frame=${s.duration},setpts=PTS-STARTPTS[v${i}]`);
  });
  const concat = `${props.shots.map((_, i) => `[v${i}]`).join("")}concat=n=${props.shots.length}:v=1:a=0[v]`;
  ffmpeg([...inputs, "-filter_complex", `${chains.join(";")};${concat}`, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS), file]);
}
function backgroundWide(vertical: string, file: string) {
  ffmpeg(["-i", vertical, "-filter_complex", "[0:v]split[a][b];[a]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=30:2,eq=brightness=-0.12[bg];[b]scale=-2:1080[fg];[bg][fg]overlay=(W-w)/2:0,setsar=1[v]", "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", file]);
}
// The song itself, cut to the section; a fade only where the music is cut (as the app does).
function songAudio(file: string) {
  const a = props.audio!;
  const fadeIn = a.fadeInFrames / FPS;
  const fadeOut = a.fadeOutFrames / FPS;
  const fades = [fadeIn > 0 ? `afade=t=in:d=${fadeIn}` : "", fadeOut > 0 ? `afade=t=out:st=${(durationS - fadeOut).toFixed(3)}:d=${fadeOut}` : ""].filter(Boolean).join(",");
  ffmpeg(["-ss", (a.startFrame / FPS).toFixed(3), "-t", durationS.toFixed(3), "-i", resolve(a.src), ...(fades ? ["-af", fades] : []), "-c:a", "aac", "-b:a", "320k", file]);
}
function composite(bg: string, overlay: string, audio: string, file: string) {
  ffmpeg(["-i", bg, ...(format === "webm" ? ["-c:v", "libvpx-vp9"] : []), "-i", overlay, "-i", audio, "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "copy", "-movflags", "+faststart", "-shortest", file]);
}

// ---------------------------------------------------------------- render both formats

const audioFile = path.join(outDir, "song-section.m4a");
await timed("audio", "The song, cut to the section (AAC 320 kbps, no other change)", () => songAudio(audioFile));
const bgVertical = path.join(outDir, "clips-9x16.mp4");
await timed("clips9x16", "The beat-cut clips from the plan (9:16)", () => backgroundVertical(bgVertical));
const bgWide = path.join(outDir, "clips-16x9.mp4");
await timed("clips16x9", "The same clips for 16:9 (over a blurred copy: our clips are vertical)", () => backgroundWide(bgVertical, bgWide));

const results: Record<string, { composition: string; overlay: string; final: string }> = {};
for (const f of formats) {
  const dir = buildComposition(f);
  const overlay = path.join(outDir, `lyrics-${f.key}.${format}`);
  await timed(`check${f.key}`, `HyperFrames check (${f.key}): its lint of the composition`, () =>
    hf(["check", dir], dir)
      .then(() => log("  no errors"))
      .catch((e) => {
        const errors = (e as Error).message.split("\n").filter((l) => l.trim().startsWith("✗"));
        log(`  ${errors.length ? errors.map((l) => l.trim()).join("\n  ") : "reported a problem (see hyperframes check)"}`);
      }),
  );
  await timed(`hf${f.key}`, `HyperFrames renders the lyric layer ${f.width}x${f.height}, transparent ${format.toUpperCase()}`, () => hf(["render", dir, "--format", format, "--output", overlay, "--quiet"], dir));
  const final = path.join(outDir, `here-${f.key}.mp4`.replace("here", title.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()));
  await timed(`mix${f.key}`, `FFmpeg lays the lyrics over the clips + song (${f.key})`, () => composite(f.key === "9x16" ? bgVertical : bgWide, overlay, audioFile, final));
  results[f.key] = { composition: dir, overlay, final };
}

// ---------------------------------------------------------------- 5. our current renderer, same plan

if (!values["no-compare"]) {
  const ours = path.join(outDir, "current-renderer-9x16.mp4");
  await timed("remotion", "Our current renderer (Remotion) renders the same 9:16 plan, clips + lyrics + audio in one pass", () =>
    node.renderLyricVideo({ props, media: chorus.media, outFile: ours, videoBitrate: reels.videoBitrate ?? null, log: () => {} }),
  );
}

// ---------------------------------------------------------------- 6. sync check

// Two measurements per word that lands inside the segment:
//   timeline  the theme's own timeline, seeked frame by frame in a browser: the first frame the word is fully
//             visible (exact; this is what HyperFrames captures);
//   pixels    the rendered layer's brightness on the word's spot: the brightest frame within 0.2 s of its
//             start must be that same frame (the render matches the timeline). A brightest frame on the
//             window's edge means something else lit that spot (the line around it, a line leaving): "not
//             measurable", never counted as early or late.
type WordSync = { id: string; text: string; start: number; landMs: number; pixelMs: number | null; agrees: boolean | null; early: boolean };
type Sync = { words: number; meanMs: number; maxMs: number; late: string[]; early: string[]; worst: string[]; pixelsAgree: number; notMeasurable: string[]; disagree: string[]; trace: string[] } | { error: string };

async function syncCheck(f: Fmt, dir: string, overlay: string): Promise<Sync> {
  const words = timing.lines
    .flatMap((l, i) => l.words.map((wd, k) => ({ id: `l${i}w${k}`, text: wd.text, start: wd.start })))
    .filter((wd) => wd.start >= 0.3 && wd.start <= durationS - 0.3);
  const traced = new Set(values.trace ? words.filter((wd) => norm(wd.text) === norm(values.trace!)).map((wd) => wd.id) : []);
  const reach = (id: string) => (traced.has(id) ? 12 : WINDOW); // a traced word: ±0.4 s
  const { boxes, opacity } = await timelineFrames(dir, words.map((wd) => ({ id: wd.id, first: Math.max(0, Math.round(wd.start * FPS) - reach(wd.id)), last: Math.round(wd.start * FPS) + reach(wd.id) })));
  const scale = 4; // the alpha plane is read at quarter size
  const w = Math.round(f.width / scale);
  const h = Math.round(f.height / scale);
  const frames = Math.ceil(durationS * FPS);
  const sums = new Map<string, number[]>();
  const want = new Map<number, string[]>(); // frame -> words to measure
  for (const wd of words) {
    const s = Math.round(wd.start * FPS);
    for (let fr = Math.max(0, s - reach(wd.id)); fr <= Math.min(frames - 1, s + reach(wd.id)); fr++) want.set(fr, [...(want.get(fr) ?? []), wd.id]);
    sums.set(wd.id, []);
  }
  const decoder = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", ...(format === "webm" ? ["-c:v", "libvpx-vp9"] : []), "-i", overlay, "-vf", `alphaextract,scale=${w}:${h}:flags=area`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { stdio: ["ignore", "pipe", "inherit"] });
  let buf = Buffer.alloc(0);
  let frame = 0;
  for await (const chunk of decoder.stdout) {
    buf = Buffer.concat([buf, chunk as Buffer]);
    while (buf.length >= w * h) {
      const img = buf.subarray(0, w * h);
      for (const id of want.get(frame) ?? []) {
        const b = boxes[id];
        if (!b) continue;
        // The word's glyphs (the middle 70% of its box, so a neighbour's glow hardly counts).
        const x0 = Math.max(0, Math.floor((b.x + b.w * 0.15) / scale));
        const x1 = Math.min(w, Math.ceil((b.x + b.w * 0.85) / scale));
        const y0 = Math.max(0, Math.floor((b.y + b.h * 0.15) / scale));
        const y1 = Math.min(h, Math.ceil((b.y + b.h * 0.85) / scale));
        let sum = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += img[y * w + x];
        sums.get(id)!.push(sum / Math.max(1, (x1 - x0) * (y1 - y0)));
      }
      buf = buf.subarray(w * h);
      frame++;
    }
  }
  const trace: string[] = [];
  const results: WordSync[] = words.map((wd) => {
    const s = Math.round(wd.start * FPS);
    const first = Math.max(0, s - reach(wd.id));
    const op = opacity[wd.id]; // per frame from `first`
    const landIdx = op.findIndex((o) => o >= 0.999);
    const landFrame = landIdx < 0 ? s + reach(wd.id) : first + landIdx;
    // Visible before its reveal: more than a trace of it before (start - reveal - 1 frame).
    const revealFrame = Math.ceil((wd.start - timing.style.revealS) * FPS) - 1;
    const early = op.some((o, k) => first + k < revealFrame && o > 0.02);
    // Pixels: the brightest frame in ±WINDOW.
    const px = sums.get(wd.id)!;
    const winFrom = Math.max(first, s - WINDOW);
    const win = px.slice(winFrom - first, winFrom - first + 2 * WINDOW + 1);
    const peakIdx = win.indexOf(Math.max(...win));
    const onEdge = peakIdx === 0 && winFrom > 0; // lit already when the window opened
    const pixelFrame = winFrom + peakIdx;
    if (traced.has(wd.id)) {
      trace.push(`"${wd.text}" sung at ${wd.start.toFixed(3)} s (frame ${(wd.start * FPS).toFixed(1)}), ${f.key}:`, "  frame   time    timeline opacity   pixel brightness");
      op.forEach((o, k) => trace.push(`  ${String(first + k).padStart(5)}  ${((first + k) / FPS).toFixed(3)}   ${o.toFixed(3).padStart(6)}            ${(px[k] ?? 0).toFixed(1).padStart(6)}${first + k === landFrame ? "   <- lands (timeline)" : ""}${first + k === pixelFrame && !onEdge ? "   <- brightest (pixels)" : ""}`));
    }
    return {
      ...wd,
      landMs: Math.round(((landFrame - wd.start * FPS) / FPS) * 1000),
      pixelMs: onEdge ? null : Math.round(((pixelFrame - wd.start * FPS) / FPS) * 1000),
      agrees: onEdge ? null : Math.abs(pixelFrame - landFrame) <= 1,
      early,
    };
  });
  const abs = results.map((r) => Math.abs(r.landMs));
  const fmt = (r: WordSync) => `"${r.text}" at ${r.start.toFixed(2)} s: ${r.landMs > 0 ? "+" : ""}${r.landMs} ms`;
  return {
    words: results.length,
    meanMs: Math.round(abs.reduce((a, b) => a + b, 0) / Math.max(1, abs.length)),
    maxMs: Math.max(0, ...abs),
    late: results.filter((r) => r.landMs > 67).map(fmt), // more than 2 frames after its start
    early: results.filter((r) => r.landMs < -67 || r.early).map(fmt),
    worst: [...results].sort((a, b) => Math.abs(b.landMs) - Math.abs(a.landMs)).slice(0, 5).map(fmt),
    pixelsAgree: results.filter((r) => r.agrees).length,
    notMeasurable: results.filter((r) => r.agrees === null).map((r) => `"${r.text}" at ${r.start.toFixed(2)} s`),
    disagree: results.filter((r) => r.agrees === false).map((r) => `"${r.text}" at ${r.start.toFixed(2)} s: timeline ${r.landMs} ms, pixels ${r.pixelMs} ms`),
    trace,
  };
}

// The composition in a browser: each word's place when it lands, and its opacity frame by frame in the
// theme's own timeline (what HyperFrames captures at that frame).
type Box = { x: number; y: number; w: number; h: number };
async function timelineFrames(dir: string, spans: { id: string; first: number; last: number }[]): Promise<{ boxes: Record<string, Box>; opacity: Record<string, number[]> }> {
  const puppeteer = (await import("puppeteer-core")).default;
  const browserPath = process.env.HYPERFRAMES_BROWSER_PATH || execFileSync(process.execPath, [hfEntry, "browser", "path"], { env: hfEnv, encoding: "utf8" }).trim().split(/\r?\n/).pop()!;
  // Served over http (fonts do not load from file://).
  const server = http.createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    if (!file.startsWith(dir) || !existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "font/woff2" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const html = readFileSync(path.join(dir, "index.html"), "utf8");
    const size = html.match(/width=(\d+), height=(\d+)/)!;
    await page.setViewport({ width: Number(size[1]), height: Number(size[2]) });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    return await page.evaluate(
      async (data: { spans: { id: string; first: number; last: number }[]; starts: Record<string, number>; fps: number }) => {
        await document.fonts.ready;
        const tl = (window as unknown as { __timelines: Record<string, { seek: (t: number) => void }> }).__timelines.lyrics;
        const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
        const opacity: Record<string, number[]> = {};
        for (const sp of data.spans) {
          const el = document.getElementById(sp.id)!;
          tl.seek(data.starts[sp.id]); // landed: no offset, full size
          const r = el.getBoundingClientRect();
          boxes[sp.id] = { x: r.x, y: r.y, w: r.width, h: r.height };
          opacity[sp.id] = [];
          for (let fr = sp.first; fr <= sp.last; fr++) {
            tl.seek(fr / data.fps);
            opacity[sp.id].push(Number(getComputedStyle(el).opacity));
          }
        }
        return { boxes, opacity };
      },
      { spans, starts: Object.fromEntries(timing.lines.flatMap((l, i) => l.words.map((wd, k) => [`l${i}w${k}`, wd.start]))), fps: FPS },
    );
  } finally {
    await browser.close();
    server.close();
  }
}

const sync: Record<string, Sync> = {};
for (const f of formats) {
  // A failing check never loses the videos and the times above.
  sync[f.key] = await syncCheck(f, results[f.key].composition, results[f.key].overlay).catch((e: Error) => ({ error: e.message.split("\n")[0] }));
}

// ---------------------------------------------------------------- report

const per = (k: "16x9" | "9x16") => ({
  hyperframes: times[`hf${k}`],
  clips: k === "9x16" ? times.clips9x16 : times.clips9x16 + times.clips16x9,
  mix: times[`mix${k}`],
  total: times[`hf${k}`] + times[`mix${k}`] + times.audio + (k === "9x16" ? times.clips9x16 : times.clips9x16 + times.clips16x9),
});
const machine = `${os.cpus()[0]?.model ?? "?"} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.platform()} ${os.release()}, Node ${process.versions.node}`;
const report = [
  `# HyperFrames spike: ${title}`,
  "",
  `${new Date().toISOString()} · ${machine}`,
  "",
  `Section (${values.section ? "fixed, as given" : "the planner's choice"}): ${secs(chorus.section.start_ms)} - ${secs(chorus.section.end_ms)} (${durationS.toFixed(1)} s), ${props.shots.length} shots, ${timing.lines.length} lines, ${timing.lines.reduce((n, l) => n + l.words.length, 0)} words. Lyric layer: transparent ${format.toUpperCase()} (alpha), laid over the clips by FFmpeg.`,
  "",
  "## Render times (seconds)",
  "",
  "| Step | 16:9 (1920x1080) | 9:16 (1080x1920) |",
  "| --- | --- | --- |",
  `| HyperFrames: lyric layer | ${per("16x9").hyperframes.toFixed(1)} | ${per("9x16").hyperframes.toFixed(1)} |`,
  `| FFmpeg: beat-cut clips | ${per("16x9").clips.toFixed(1)} | ${per("9x16").clips.toFixed(1)} |`,
  `| FFmpeg: song section | ${times.audio.toFixed(1)} | ${times.audio.toFixed(1)} |`,
  `| FFmpeg: lyrics over clips + song | ${per("16x9").mix.toFixed(1)} | ${per("9x16").mix.toFixed(1)} |`,
  `| **Total for the format** | **${per("16x9").total.toFixed(1)}** | **${per("9x16").total.toFixed(1)}** |`,
  times.remotion !== undefined ? `| Our current renderer (Remotion), whole video in one pass | — | **${times.remotion.toFixed(1)}** |` : "",
  "",
  `Our lyric timing + beat analysis (cached): ${times.sync.toFixed(1)} s; beat cuts for the chorus: ${times.cuts.toFixed(1)} s.`,
  "",
  "## Sync check (the frame where each word lands vs its sung start)",
  "",
  ...(["16x9", "9x16"] as const).flatMap((k) => {
    const r = sync[k];
    if ("error" in r) return [`**${k}:** the sync check could not run (${r.error}); watch the video instead.`, ""];
    return [
      `**${k}:** ${r.words} words landing in the section. Timeline (exact): mean ${r.meanMs} ms, worst ${r.maxMs} ms after the sung start (one frame = 33 ms). Late by more than 2 frames: ${r.late.length ? r.late.join("; ") : "none"}. Early or visible before its reveal: ${r.early.length ? r.early.join("; ") : "none"}.`,
      `Pixels confirm the timeline for ${r.pixelsAgree} of ${r.words} words${r.disagree.length ? `; differ: ${r.disagree.join("; ")}` : ""}${r.notMeasurable.length ? `; not measurable (the spot was already lit by the line around it): ${r.notMeasurable.join("; ")}` : ""}.`,
      `Largest: ${r.worst.join("; ")}.`,
      ...(r.trace.length ? ["", "```", ...r.trace, "```"] : []),
      "",
    ];
  }),
  "## Files",
  "",
  ...Object.entries(results).map(([k, r]) => `- ${k}: ${path.relative(outDir, r.final)} (lyric layer ${path.relative(outDir, r.overlay)}, composition ${path.relative(outDir, r.composition)})`),
  times.remotion !== undefined ? "- current-renderer-9x16.mp4: the same plan by our current renderer" : "",
  "- timing.json: the word times the template read (from our planner)",
  "",
  "Not in this spike: dissolves between shots (cut instead), the Reels loop ending, title cards, the app's other effects; 16:9 uses the vertical clips over a blurred copy.",
  "",
].filter((l) => l !== null).join("\n");
writeFileSync(path.join(outDir, "report.md"), report);
writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ title, machine, section: chorus.section, durationS, times, sync, format }, null, 2));
log(`\n${report}`);
log(`Done. Open the folder: ${outDir}`);
process.exit(0);
