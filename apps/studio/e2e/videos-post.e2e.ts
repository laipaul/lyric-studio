// Browser test of 6.2c-2b (needs a studio build, FFmpeg and Playwright, as style-lock.e2e.ts):
//   pnpm test:e2e
// Videos: a run's settings next to the recipe (differences marked) and "Use these settings" (Generate
// starts with that run's settings: the exact section "0:34–1:06 (from that run)", one click back to
// "auto · 32 s"). Post: only approved videos, with their caption. Tasks: "Clear finished" removes done
// tasks at once, asks before a stopped task that can still resume, never touches a running one or a file.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRun, openWorkspace } from "@lyric/db";
import { findOrCreateSongProject, songPathsById } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-post-"));
const wsDir = path.join(root, "workspace");
const port = 3198;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  const song = path.join(root, "Post Test.wav");
  execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=8", song]);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  writeFileSync(path.join(paths.root, "lyrics.txt"), "Line one\n* Hold on\n");
  mkdirSync(path.join(wsDir, "collections", "wedding"), { recursive: true });

  // A Reels run made with "floating" and an auto section 0:34–1:06 (target 32 s); the recipe now says glide.
  const runDir = path.join(paths.exports, "2026-10-20_1430", "reels");
  mkdirSync(runDir, { recursive: true });
  for (const n of ["v1", "v2"]) {
    // A realistic reel: 20 s of H.264 + AAC (the sound runs a little past the picture's last frame), faststart.
    execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30:d=20", "-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", path.join(runDir, `${n}.mp4`)]);
    writeFileSync(path.join(runDir, `${n}.qa.txt`), "Summary: PASS\n");
    writeFileSync(
      path.join(runDir, `${n}.manifest.json`),
      JSON.stringify({
        created_at: "2026-10-20T14:30:00.000Z",
        platform: { name: "reels", preset: { label: "Instagram Reels" } },
        section: { mode: "auto", start_ms: 34_213, end_ms: 66_000 },
        settings: { line_effect: "floating", hook_effect: "karaoke-highlight", collections: ["wedding"], target_length: 32 },
        props: { style: { font: "Cormorant Garamond" }, hookFont: { font: "Kaushan Script" }, lyricEffects: { accent: "#E8A3B5" } },
        output: { duration_s: 20 },
      }),
    );
  }
  // Tasks: one done, one stopped that can still resume, one running (this process).
  const task = (status: "done" | "stopped" | "running", label: string, extra = {}) =>
    ws.db.insert(makeRun).values({ project_id: sp.project.id, status, label, options_json: {}, ...extra }).run();
  task("done", "Done task");
  task("stopped", "Stopped task", { export_dir: path.join(paths.exports, "2026-10-20_1430") });
  task("running", "Running task", { pid: process.pid });
  ws.close();

  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1" },
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
    await page.goto(`${base}/songs/${sp.project.id}`);

    // Videos: the run's settings next to the recipe.
    await page.waitForSelector("[data-run-settings]");
    check(((await page.textContent("[data-run-settings] summary")) ?? "").includes("differ from the recipe now"), "Videos: the run says its settings differ from the recipe now");
    await page.click("[data-run-settings] summary");
    const verse = await page.$("[data-run-settings] [data-setting=verseEffect]");
    check(!!verse && (await verse.getAttribute("data-differs")) === "true" && ((await verse.textContent()) ?? "").includes("now: glide"), 'Verse effect "floating" marked, "now: glide"');

    // Use these settings -> Generate with that run's settings.
    await page.click("[data-use-settings]");
    await page.waitForSelector("[data-from-run]");
    check(page.url().includes("tab=generate") && page.url().includes("from=2026-10-20_1430"), "Use these settings opens Generate for that run");
    check((await page.textContent("[data-run-section-label]")) === "0:34–1:06 (from that run)", 'section "0:34–1:06 (from that run)"');
    check((await page.$eval("[aria-label='Verse effect']", (s: HTMLSelectElement) => s.value)) === "floating", "the verse effect of that run (floating) is chosen");
    const chips = await page.$$eval("[data-platform-choice]", (e: Element[]) => e.filter((x) => x.className.includes("bg-brand")).map((x) => x.getAttribute("data-platform-choice")));
    check(JSON.stringify(chips) === JSON.stringify(["reels"]), `the platforms of that run (got ${(chips as string[]).join(", ")})`);
    await page.click("[data-switch-auto]");
    check((await page.inputValue("input[name=section]")) === "auto" && (await page.inputValue("input[name=length]")) === "32", 'one click back to "auto · 32 s"');

    // The pro assessment on each tile, and a reaction: what it changes, then song.json.
    await page.goto(`${base}/songs/${sp.project.id}?tab=videos`);
    await page.waitForSelector("[data-video$='v1.manifest.json'] [data-verdict]");
    check((await page.getAttribute("[data-video$='v1.manifest.json'] [data-verdict]", "data-verdict")) === "ready", "v1 (QA passed) is ✅ Ready to post");
    await page.click("[data-video$='v1.manifest.json'] [data-reactions-toggle]");
    await page.click("[data-video$='v1.manifest.json'] [data-reaction=too-fast]");
    await page.waitForSelector("[data-video$='v1.manifest.json'] [data-reaction-plan]");
    const planText = (await page.textContent("[data-video$='v1.manifest.json'] [data-reaction-plan]")) ?? "";
    check(planText.includes("Next run: shots one bar longer"), `"cuts too fast" says what it changes (${planText.slice(0, 80)})`);
    await page.click("[data-video$='v1.manifest.json'] [data-reaction-apply=song]");
    await page.waitForSelector("[data-video$='v1.manifest.json'] [data-reaction-done]");
    check((JSON.parse(readFileSync(path.join(paths.root, "song.json"), "utf8")) as { paceShift?: number }).paceShift === 1, 'song.json holds "paceShift": 1');

    // The Compare player: its timeline covers the whole video, also on a second opening (video cached),
    // and after the end the bar can be dragged back and play starts again from 0.
    for (const round of ["first opening", "second opening (cached)"]) {
      await page.goto(`${base}/songs/${sp.project.id}?tab=videos`);
      await page.click("[data-video$='v1.manifest.json'] button:has-text('Compare')");
      await page.click("[data-video$='v2.manifest.json'] button:has-text('Compare')");
      await page.locator("button:has-text('Compare'):not([disabled])").last().click();
      await page.waitForSelector("input[aria-label=Timeline]");
      const bar = () => page.$eval("input[aria-label=Timeline]", (i: HTMLInputElement) => ({ max: Number(i.max), value: Number(i.value) }));
      const vids = () => page.$$eval("[role=dialog] video", (v: HTMLVideoElement[]) => v.map((x) => x.currentTime));
      await page.waitForFunction(() => Number((document.querySelector("input[aria-label=Timeline]") as HTMLInputElement).max) > 10, null, { timeout: 8000 }).catch(() => {});
      const max = (await bar()).max;
      check(Math.abs(max - 20) < 0.6, `Compare (${round}): the timeline covers the whole video (max ${max} s, video 20 s)`);
      // Play to the end.
      await page.click("button[aria-label=Play]");
      await page.$eval("[role=dialog] video", (v: HTMLVideoElement) => (v.currentTime = v.duration - 1.2));
      await page.waitForFunction(() => (document.querySelector("[role=dialog] video") as HTMLVideoElement).ended, null, { timeout: 8000 });
      await sleep(300);
      const end = await bar();
      check(end.value > 18.5 && end.value <= end.max, `Compare (${round}): at the end the bar is at the end (${end.value} of ${end.max})`);
      check((await page.$("button[aria-label=Play]")) !== null, `Compare (${round}): after the end the button says Play`);
      // Drag back.
      await page.$eval("input[aria-label=Timeline]", (i: HTMLInputElement) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        set.call(i, "5");
        i.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await sleep(400);
      const back = await vids();
      check(back.every((t) => Math.abs(t - 5) < 0.6), `Compare (${round}): dragging the bar back to 5 s moves every video (${back.map((t) => t.toFixed(2)).join(", ")})`);
      // Play after the end restarts from 0.
      await page.$eval("[role=dialog] video", (v: HTMLVideoElement) => (v.currentTime = v.duration));
      await page.waitForFunction(() => (document.querySelector("[role=dialog] video") as HTMLVideoElement).ended, null, { timeout: 8000 });
      await page.click("button[aria-label=Play]");
      await sleep(600);
      const again = await vids();
      check(again[0] < 3, `Compare (${round}): Play after the end starts again from the beginning (${again[0].toFixed(2)} s)`);
      await page.keyboard.press("Escape");
      await page.waitForSelector("[role=dialog]", { state: "detached" });
    }

    // Post: nothing approved yet; approve v1 in Videos, then it is there with its caption.
    await page.goto(`${base}/songs/${sp.project.id}?tab=post`);
    await page.waitForSelector("[data-post-empty]");
    check(true, "Post: empty until a video is approved");
    await page.goto(`${base}/songs/${sp.project.id}?tab=videos`);
    await page.click("[data-video$='v1.manifest.json'] button:has-text('Approve')");
    await page.waitForSelector("[data-video$='v1.manifest.json'][data-mark=approved]");
    await page.goto(`${base}/songs/${sp.project.id}?tab=post`);
    await page.waitForSelector("[data-post-video]");
    check((await page.$$("[data-post-video]")).length === 1, "Post lists the approved video only (v1, not v2)");
    await page.waitForSelector("[data-post-panel] [data-section]");
    check(((await page.textContent("[data-post-panel]")) ?? "").includes("Caption"), "with its caption to copy");
    // The Post player: seekable over the whole video, and still after the end.
    await page.waitForSelector("[data-post-video] video");
    const pv = () =>
      page.$eval("[data-post-video] video", (v: HTMLVideoElement) => ({ t: v.currentTime, d: v.duration, seekable: v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0, ended: v.ended }));
    await page.$eval("[data-post-video] video", (v: HTMLVideoElement) => v.load());
    await page.waitForFunction(() => (document.querySelector("[data-post-video] video") as HTMLVideoElement).readyState >= 1);
    const first = await pv();
    check(Math.abs(first.d - 20) < 0.6 && first.seekable >= first.d - 0.6, `Post player: duration ${first.d.toFixed(2)} s, seekable to ${first.seekable.toFixed(2)} s`);
    await page.$eval("[data-post-video] video", (v: HTMLVideoElement) => {
      v.currentTime = v.duration - 1;
      return v.play();
    });
    await page.waitForFunction(() => (document.querySelector("[data-post-video] video") as HTMLVideoElement).ended, null, { timeout: 8000 });
    await page.$eval("[data-post-video] video", (v: HTMLVideoElement) => (v.currentTime = 5));
    await sleep(500);
    const afterEnd = await pv();
    check(Math.abs(afterEnd.t - 5) < 0.6, `Post player: after the end, seeking back to 5 s works (${afterEnd.t.toFixed(2)} s)`);
    // The server answers ranges as a player needs them (also "bytes=0-", a tail and HEAD).
    const mp4Url = await page.$eval("[data-post-video] video", (v: HTMLVideoElement) => v.currentSrc);
    const zero = await fetch(mp4Url, { headers: { Range: "bytes=0-" } });
    const total = Number(/\/(\d+)$/.exec(zero.headers.get("content-range") ?? "")?.[1]);
    check(zero.status === 206 && Number(zero.headers.get("content-length")) === total && (await zero.arrayBuffer()).byteLength === total, "server: bytes=0- gives 206 with the whole file and a correct Content-Range / Content-Length");
    const tail = await fetch(mp4Url, { headers: { Range: `bytes=${total - 100}-` } });
    check(tail.status === 206 && (await tail.arrayBuffer()).byteLength === 100, "server: a range at the end gives exactly those bytes");
    const head = await fetch(mp4Url, { method: "HEAD" });
    check(head.status === 200 && Number(head.headers.get("content-length")) === total && head.headers.get("accept-ranges") === "bytes", "server: HEAD gives the length and Accept-Ranges");

    // Tasks: Clear finished.
    await page.click("[data-tasks-button]");
    await page.waitForSelector("[data-clear-finished]");
    await page.click("[data-clear-finished]");
    await page.waitForSelector("[data-clear-ask]");
    check(((await page.textContent("[data-clear-ask]")) ?? "").includes("1 stopped task can still resume — clear it too?"), '"1 stopped task can still resume — clear it too?"');
    await page.waitForFunction(() => !document.querySelector("[data-tasks]")?.textContent?.includes("Done task"));
    const tasksText = async () => (await page.textContent("[data-tasks]")) ?? "";
    check(!(await tasksText()).includes("Done task") && (await tasksText()).includes("Stopped task") && (await tasksText()).includes("Running task"), "done task cleared; stopped and running stay");
    await page.click("[data-clear-stopped]");
    await page.waitForFunction(() => !document.querySelector("[data-tasks]")?.textContent?.includes("Stopped task"));
    check((await tasksText()).includes("Running task"), "after the question: the stopped task is cleared, the running one stays");
    check(existsSync(path.join(runDir, "v1.mp4")) && existsSync(path.join(runDir, "v2.mp4")), "no video or file was removed");
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
