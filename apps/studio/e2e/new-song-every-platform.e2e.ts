// End-to-end test of the whole path (stability pass, 1 Nov 2026), needs a studio build, FFmpeg and
// Playwright with Chromium:   npx tsx apps/studio/e2e/new-song-every-platform.e2e.ts
// On a clean workspace, through the real screens: "+ New song" adds a song; the same file again is refused
// and changes nothing; Assets adds clips, Replace lyrics warns first and keeps the old ones under Replaced
// files, Restore brings them back; Make queues Reels, TikTok, Shorts, YouTube and Canvas; the real render
// worker makes them; every video exists in the right size and carries this song's own audio (Canvas none),
// and the song's collection choice was not changed by the run.
// The one stand-in: the lyric aligner (WhisperX, installed on the user's PC) is replaced by a fixed timing
// stored before Make, so the worker uses that stored alignment exactly as it would a real one.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRun, openWorkspace, project } from "@lyric/db";
import { desc, eq } from "drizzle-orm";
import { ensureAlignment, findOrCreateSongProject, readRecipe, songPathsById, type AlignRunner } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-every-"));
const inDir = path.join(root, "in");
const wsDir = path.join(root, "workspace");
const port = 3197;
const base = `http://127.0.0.1:${port}`;
const repo = path.resolve(__dirname, "..", "..", "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const PLATFORMS = ["reels", "tiktok", "shorts", "youtube", "canvas"] as const;
let failures = 0;
const check = (ok: boolean, what: string): boolean => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
  return ok;
};

type Probe = { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };
const probe = (file: string): Probe => JSON.parse(execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8" }));

// The stand-in aligner: every lyric line 3 s apart from 2 s, words 0.35 s apart.
const fixedAlign: AlignRunner = async (a) => {
  const texts = readFileSync(a.lyrics, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const stamp = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(2).padStart(5, "0")}`;
  const lines = texts.map((raw, i) => {
    const hook = raw.startsWith("* ");
    const text = raw.replace(/^\*\s+/, "");
    const start = 2000 + i * 3000;
    return { line: `[${stamp(start)}]${hook ? "* " : ""}${text.split(" ").map((w, k) => `<${stamp(start + k * 350)}>${w}`).join(" ")}`, report: { number: i + 1, text, is_hook: hook, start_ms: start, end_ms: start + 2400, confidence: 0.9 } };
  });
  writeFileSync(a.out, `${lines.map((l) => l.line).join("\n")}\n[${stamp(2000 + texts.length * 3000)}]\n`);
  writeFileSync(a.report, JSON.stringify({ model: "fixed (e2e)", lang: a.lang, low_confidence: 0.5, lines: lines.map((l) => l.report) }));
};

function inputs() {
  mkdirSync(inDir, { recursive: true });
  // 40 s at 120 BPM: a kick on every beat (clear beats for the analysis) under a soft tone.
  ffmpeg("-f", "lavfi", "-i", "aevalsrc=0.8*sin(2*PI*55*t)*exp(-18*mod(t\\,0.5))+0.15*sin(2*PI*330*t):s=44100:d=40", "-ac", "2", path.join(inDir, "Every Platform (Master).wav"));
  writeFileSync(
    path.join(inDir, "Every Platform lyrics.txt"),
    ["Morning light on the water", "Every road leads me home", "* Hold on, hold on to me", "* Never let the night come", "Quiet streets and open windows", "Every song I sing is yours", "* Hold on, hold on to me", "* Never let the night come", "Morning light on the water", "Every road leads me home", "* Hold on, hold on to me", "* Never let the night come"].join("\n") + "\n",
  );
  writeFileSync(path.join(inDir, "Every Platform lyrics v2.txt"), "A different first line\nEvery road leads me home\n* Hold on, hold on to me\n");
  ffmpeg("-f", "lavfi", "-i", "color=c=0x7a2e4d:s=640x640", "-frames:v", "1", path.join(inDir, "cover.jpg"));
  const hues = ["0x3b6ea5", "0xa53b6e", "0x6ea53b", "0xa58a3b", "0x3ba5a0", "0x7a3ba5"];
  hues.forEach((c, i) => ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=540x960:d=8,format=yuv420p`, "-f", "lavfi", "-i", "testsrc2=s=540x960:d=8", "-filter_complex", "[0][1]blend=all_mode=overlay:all_opacity=0.35", "-c:v", "libx264", "-r", "30", path.join(inDir, `vertical-${i + 1}.mp4`)));
  hues.slice(0, 3).forEach((c, i) => ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=960x540:d=10,format=yuv420p`, "-f", "lavfi", "-i", "testsrc2=s=960x540:d=10", "-filter_complex", "[0][1]blend=all_mode=overlay:all_opacity=0.35", "-c:v", "libx264", "-r", "30", path.join(inDir, `wide-${i + 1}.mp4`)));
}

async function main() {
  inputs();
  mkdirSync(wsDir, { recursive: true });
  const env = { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1", LYRIC_VOICE_MAP: "off" };
  const children: ChildProcess[] = [];
  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: path.resolve(__dirname, ".."), env, stdio: "ignore" });
  children.push(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let playwright: any;
  try {
    playwright = require("playwright"); // eslint-disable-line @typescript-eslint/no-require-imports -- found through NODE_PATH, not a dependency
  } catch {
    throw new Error("Playwright is not installed here: this browser test runs in the cloud check.");
  }
  const browser = await playwright.chromium.launch();
  try {
    for (let i = 0; i < 120; i++) {
      if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) break;
      await sleep(500);
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const dialogs: string[] = [];
    page.on("dialog", (d: { message: () => string; accept: () => Promise<void> }) => {
      dialogs.push(d.message());
      void d.accept();
    });

    // 1. "+ New song" in the Library.
    const addSong = async (title: string) => {
      await page.goto(`${base}/`);
      await page.click("[data-new-song-tile]");
      await page.setInputFiles("input[name=song]", path.join(inDir, "Every Platform (Master).wav"));
      await page.setInputFiles("input[name=lyrics]", path.join(inDir, "Every Platform lyrics.txt"));
      await page.setInputFiles("input[name=cover]", path.join(inDir, "cover.jpg"));
      await page.fill("input[name=title]", title);
      await page.click("button[type=submit]:has-text('Add song')");
    };
    await addSong("Every Platform");
    await page.waitForFunction(() => [...document.querySelectorAll("h2")].some((h) => h.textContent === "Every Platform"), null, { timeout: 30_000 });
    const ws = openWorkspace(wsDir);
    const songs = () => ws.db.select().from(project).all();
    check(songs().length === 1, "+ New song: the song is in the Library");
    const id = songs()[0].id;
    const folder = songPathsById(ws, id).root;
    check(existsSync(path.join(folder, "Every Platform (Master).wav")) && existsSync(path.join(folder, "Every Platform lyrics.txt")), "its folder keeps the files under their own names");

    // 2. The same song file again: refused, nothing changed.
    await addSong("Something Else");
    await page.waitForSelector("text=already in your library", { timeout: 30_000 });
    check(songs().length === 1 && songs()[0].title === "Every Platform", "the same song file again is refused; the song keeps its title");

    // 3. Assets: clips, Replace lyrics (warned, kept), Restore.
    await page.goto(`${base}/songs/${id}`);
    await page.click("[data-stage=prepare]");
    await page.click("[role=tab]:has-text('Assets')");
    await page.waitForSelector("[data-assets]");
    await page.setInputFiles("[data-clip-input]", [...readdirSync(inDir).filter((f) => f.endsWith(".mp4")).map((f) => path.join(inDir, f))]);
    await page.waitForFunction(() => document.querySelectorAll("[data-clip]").length === 9, null, { timeout: 120_000 });
    check(true, "Assets: 9 clips added to the song's own clips");
    dialogs.length = 0;
    await page.setInputFiles("[data-replace=lyrics]", path.join(inDir, "Every Platform lyrics v2.txt"));
    await page.waitForSelector("[data-replaced-files]", { timeout: 30_000 });
    check(dialogs.some((d) => /Replace the lyrics with Every Platform lyrics v2\.txt\?/.test(d) && /kept under Replaced files/.test(d)), "Replace lyrics warns first and says the old ones are kept");
    const lyricsNow = () => readFileSync(songPathsById(ws, id).lyricsTxt, "utf8");
    check(lyricsNow().startsWith("A different first line"), "…then the new lyrics are in use");
    await page.click("[data-replaced-files] summary");
    await page.click("[data-restore-replaced]");
    await page.waitForSelector("text=is the lyrics again", { timeout: 30_000 });
    check(lyricsNow().startsWith("Morning light on the water"), "Restore brings the original lyrics back");
    check(readdirSync(path.join(folder, ".studio", "replaced")).some((f) => readFileSync(path.join(folder, ".studio", "replaced", f), "utf8").startsWith("A different first line")), "…and keeps the replaced version too (nothing lost)");

    // 4. The lyric timing the worker will find stored (the stand-in for the aligner, see the top).
    const sp = await findOrCreateSongProject(ws, songPathsById(ws, id).audio);
    await ensureAlignment(ws, sp, { lyricsTxt: songPathsById(ws, id).lyricsTxt, durationMs: 40_000, align: fixedAlign });
    const collectionsBefore = readRecipe(songPathsById(ws, id).recipe!).collections;

    // 5. Make: every platform, made by the real render worker.
    const worker = spawn(process.execPath, [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repo, "apps", "worker", "src", "index.ts")], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
    children.push(worker);
    const workerLog: string[] = [];
    worker.stdout?.on("data", (c: Buffer) => workerLog.push(c.toString("utf8")));
    worker.stderr?.on("data", (c: Buffer) => workerLog.push(c.toString("utf8")));
    await page.click("[data-stage=make]");
    const toggle = await page.waitForSelector("button[aria-expanded]:has-text('Generate videos')");
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    for (const p of PLATFORMS) {
      const chip = await page.waitForSelector(`[data-platform-choice=${p}]`);
      if (!(await chip.getAttribute("class"))?.includes("bg-brand")) await chip.click();
    }
    await page.click("[data-generate] button[type=submit]");
    const deadline = Date.now() + 40 * 60_000;
    let run: { status: string; message: string | null; export_dir: string | null } | undefined;
    for (;;) {
      run = ws.db.select().from(makeRun).where(eq(makeRun.project_id, id)).orderBy(desc(makeRun.created_at)).get() ?? run;
      if (run && ["done", "failed", "interrupted", "stopped"].includes(run.status)) break;
      if (Date.now() > deadline) throw new Error(`the run did not finish in 40 minutes:\n${workerLog.join("").slice(-3000)}`);
      await sleep(3000);
    }
    check(run!.status === "done", `the worker made the run (${run!.status}${run!.message ? `: ${run!.message.split("\n")[0]}` : ""})`);
    if (run!.status !== "done") console.log(workerLog.join("").slice(-4000));

    // 6. Every video: there, the right size, this song's own audio (Canvas has none).
    const songSha = sha256(songPathsById(ws, id).audio);
    const runDir = path.join(wsDir, ...(run!.export_dir ?? "").split("/"));
    for (const p of PLATFORMS) {
      const dir = path.join(runDir, p);
      const mp4s = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".mp4") && !f.includes(".rerender")) : [];
      const videos = mp4s.filter((f) => existsSync(path.join(dir, f.replace(/\.mp4$/, ".manifest.json"))));
      if (!check(videos.length >= 1, `${p}: ${videos.length} video(s) made`)) continue;
      for (const v of videos) {
        const file = path.join(dir, v);
        const info = probe(file);
        const video = info.streams.find((s) => s.codec_type === "video");
        const audio = info.streams.some((s) => s.codec_type === "audio");
        const want = p === "youtube" ? [1920, 1080] : [1080, 1920];
        check(!!video && video.width === want[0] && video.height === want[1] && Number(info.format.duration) > 2 && statSync(file).size > 50_000, `${p}/${v}: ${video?.width}x${video?.height}, ${Number(info.format.duration).toFixed(1)} s`);
        check(p === "canvas" ? !audio : audio, `${p}/${v}: ${p === "canvas" ? "no audio (Canvas)" : "has audio"}`);
        const manifest = JSON.parse(readFileSync(path.join(dir, v.replace(/\.mp4$/, ".manifest.json")), "utf8")) as { project: { id: string }; song: { sha256: string } };
        check(manifest.project.id === id && manifest.song.sha256 === songSha, `${p}/${v}: made from this song's own song file`);
      }
    }
    check(JSON.stringify(readRecipe(songPathsById(ws, id).recipe!).collections) === JSON.stringify(collectionsBefore), "the run did not change the song's collection choice");
    ws.close();
  } finally {
    await browser.close();
    for (const c of children) c.kill();
  }
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll browser checks passed");
    rmSync(root, { recursive: true, force: true });
    process.exit(failures ? 1 : 0);
  })
  .catch((error) => {
    console.error(error);
    console.log("\n1 check(s) failed");
    rmSync(root, { recursive: true, force: true });
    process.exit(1);
  });
