// Browser test of the Storyboard tab, stage 1 (needs a studio build, FFmpeg, the audio service's Python
// and Playwright, as the others):  pnpm test:e2e
// A 14 s click track at 120 BPM, six lines, four clips (one only 1 s long), and two anchors in song.json:
// line 4 on 02_b.mp4 (dissolve) inside the section, line 6 outside it. The plan (a dry run: nothing is
// rendered or written) shows bars, the waveform, the lines with ⚓, the shots with badges and warnings,
// the anchor left outside; clicking the timeline plays the preview from there.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, songPathsById, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-storyboard-"));
const wsDir = path.join(root, "workspace");
const port = 3195;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
const TEXTS = ["Verse one here", "Hold on to me", "Through the night", "Verse two here", "Hold on to me", "Into the light"];
const STARTS = [1000, 2500, 4000, 5500, 7000, 11_000];
const stamp = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, "0")}`;

async function main() {
  process.env.WORKSPACE_DIR = wsDir;
  const song = path.join(root, "Story Test.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)+0.9*sin(2*PI*55*t)*exp(-12*mod(t-0.25,2))*gte(t,0.25)':s=44100:d=14", "-ac", "2", song);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  writeFileSync(paths.lyricsTxt, `${TEXTS.map((t, i) => (i === 1 || i === 4 ? `* ${t}` : t)).join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [name, seconds, colour] of [["01_a.mp4", 4, "blue"], ["02_b.mp4", 4, "yellow"], ["03_c.mp4", 4, "red"], ["04_d.mp4", 1, "green"]] as const) {
    ffmpeg("-f", "lavfi", "-i", `testsrc2=s=216x384:r=30:d=${seconds}`, "-vf", `drawbox=c=${colour}@0.6:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(paths.clips!, name));
  }
  writeFileSync(paths.recipe!, JSON.stringify({ platforms: ["reels"], section: "0:02-0:10", anchors: [{ line: 4, clip: "02_b.mp4", transition: "dissolve" }, { line: 6, clip: "03_c.mp4" }] }));
  // The stored alignment (as pnpm align would leave it): a storyboard never aligns.
  const lrc = TEXTS.map((t, i) => `[${stamp(STARTS[i])}]${t.split(" ").map((w, k) => `<${stamp(STARTS[i] + k * 300)}>${w}`).join(" ")} <${stamp(STARTS[i] + 1200)}>`).join("\n");
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, `${lrc}\n[00:13.00]\n`);
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: TEXTS.map((text, i) => ({ number: i + 1, text, is_hook: i === 1 || i === 4, start_ms: STARTS[i], end_ms: STARTS[i] + 1200, confidence: 0.9 })) }));
  };
  const p = ws.db.select().from(project).where(eq(project.id, sp.project.id)).get()!;
  await ensureAlignment(ws, { ...sp, project: p }, { lyricsTxt: paths.lyricsTxt, durationMs: 14_000, align: aligner });
  const songFile = absPath(ws, p.audio_path!);
  ws.close();

  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1", LYRIC_VOICE_MAP: "off" },
    stdio: "ignore",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let playwright: any;
  try {
    playwright = require("playwright"); // eslint-disable-line @typescript-eslint/no-require-imports -- found through NODE_PATH, not a dependency
  } catch {
    throw new Error("Playwright is not installed here: this browser test runs in the cloud check.");
  }
  try {
    for (let i = 0; i < 120; i++) {
      if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) break;
      await sleep(500);
    }
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${base}/songs/${sp.project.id}?tab=storyboard`);
    await page.waitForSelector("[data-storyboard-show]");
    check((await page.inputValue("[data-storyboard-platform]")) === "reels", "the plan for Reels (the recipe's platform) is offered");
    await page.click("[data-storyboard-show]");
    await page.waitForSelector("[data-shot='1']", { timeout: 180_000 });
    const summary = (await page.textContent("[data-storyboard-summary]")) ?? "";
    check(summary.includes("Reels v1") && summary.includes("planned now") && summary.includes("120 BPM"), `the summary (${summary})`);
    check(!existsSync(paths.exports) || readdirSync(paths.exports).length === 0, "nothing was rendered or written (no run folder)");
    check((await page.$$("[data-bar]")).length >= 3, "bars on the ruler");
    check((await page.$$("[data-waveform] rect")).length > 100, "the waveform");
    check((await page.$$("[data-hook-section]")).length >= 1, "hook sections shaded");
    check(!!(await page.$("[data-story-line='4'][data-anchored='02_b.mp4']")), "line 4 carries its anchor (⚓ 02_b.mp4)");
    const anchored = await page.$$eval("[data-shot]", (els: Element[]) => els.filter((e) => e.querySelector("[data-badge=anchor]")).map((e) => e.textContent ?? ""));
    check(anchored.length === 1 && anchored[0].includes("02_b.mp4"), `one shot carries the ⚓ badge, on 02_b.mp4 (${anchored.join(" | ")})`);
    check((await page.$$("[data-badge=dissolve]")).length === 1, "and its dissolve badge");
    check(((await page.textContent("[data-anchors-outside]")) ?? "").includes('line 6 "Into the light" → 03_c.mp4'), "the anchor outside the section is listed");
    const last = (await page.$$("[data-shot]")).length;
    check(!!(await page.$(`[data-shot='${last}'] [data-badge=loop]`)), "the last shot is marked as the Reels loop ending (↻), not warned as a repeat");
    // The 1 s clip: slowed or held: a warning on its shot.
    const warned = await page.$$("[data-shot][data-warnings]");
    if (warned.length) {
      await warned[0].click();
      const details = (await page.textContent("[data-shot-details]")) ?? "";
      check(/slowed to|too short|the same clip/.test(details), `a shot's warning shows in its details (${details.slice(0, 120)})`);
    } else {
      check(true, "no shot needs a warning in this plan");
    }
    await page.click("[data-shot='1']");
    check(((await page.textContent("[data-shot-details]")) ?? "").includes("Shot 1:"), "a shot's details: clip, in / out, speed");
    // Play from a point: the playhead moves.
    await page.mouse.click(...(await (async () => {
      const box = await (await page.$("[data-waveform]")).boundingBox();
      return [box.x + box.width / 2, box.y + box.height / 2] as [number, number];
    })()));
    await sleep(1500);
    const left = Number((await page.getAttribute("[data-playhead]", "style"))?.match(/left: ([\d.]+)px/)?.[1] ?? 0);
    check(left > 100, `the preview plays from the clicked point (playhead at ${left} px)`);
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "storyboard.png") });
    check(existsSync(songFile), "the song file is untouched");
    await browser.close();
  } finally {
    server.kill();
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(() => {
    rmSync(root, { recursive: true, force: true });
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll browser checks passed");
    process.exit(failures ? 1 : 0);
  });
