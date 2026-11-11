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

import { makeRun, openWorkspace, videoMark } from "@lyric/db";
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

  // More runs: an old-style run (manifests from before the assessment: no settings.pace / ending / props, only
  // created_at + output) with six TikTok videos of mixed QA, a YouTube run with one video, a Shorts group with
  // nothing finished, and a whole run with nothing finished.
  const plain = (dir: string, n: string, qa: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${n}.mp4`), "not a real video");
    writeFileSync(path.join(dir, `${n}.qa.txt`), qa);
    writeFileSync(path.join(dir, `${n}.manifest.json`), JSON.stringify({ created_at: "2026-10-22T10:00:00.000Z", output: { duration_s: 5 } }));
  };
  const READY = "[ok  ] Video length\nSummary: PASS - all checks passed\n";
  const GOOD = "[ok  ] Video length\n[WARN] Clips repeated within 3 shots\n  shot 4 (0:05.0) repeats a.mp4\nSummary: WARN - 1 warning\n";
  const BAD = "[WARN] Video length\n  the file is shorter than it should be\nSummary: WARN - 1 warning\n";
  const tiktok = path.join(paths.exports, "2026-10-22_1000", "tiktok");
  ["v1", "v4", "v5", "v6"].forEach((n) => plain(tiktok, n, READY));
  plain(tiktok, "v2", GOOD);
  plain(tiktok, "v3", BAD);
  plain(path.join(paths.exports, "2026-10-23_0900", "youtube"), "v1", GOOD);
  mkdirSync(path.join(paths.exports, "2026-10-22_1000", "shorts"), { recursive: true });
  writeFileSync(path.join(paths.exports, "2026-10-22_1000", "shorts", "v1.mp4"), "unfinished");
  mkdirSync(path.join(paths.exports, "2026-10-18_0900", "reels"), { recursive: true });
  writeFileSync(path.join(paths.exports, "2026-10-18_0900", "reels", "v1.mp4"), "unfinished");
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
    // Review (11 Nov 2026): one tab per platform with videos; a platform's videos only show in its tab.
    const showTab = async (plat: string) => {
      await page.click(`[data-review-tab=${plat}]`);
      await page.waitForSelector(`[data-review-platform=${plat}]`);
    };
    await page.goto(`${base}/songs/${sp.project.id}`);
    await page.waitForSelector("[data-review-tabs]");
    await showTab("reels");
    if (process.env.REVIEW_SHOT) await page.screenshot({ path: process.env.REVIEW_SHOT });

    // Videos: the run's settings next to the recipe (on each card, folded).
    await page.waitForSelector("[data-run='2026-10-20_1430'] [data-run-settings]");
    const summary = (await page.textContent("[data-run='2026-10-20_1430'] [data-run-settings] summary")) ?? "";
    check(/\d+ differ(s)? from the recipe now/.test(summary), `Videos: the run says its settings differ from the recipe now (${summary.trim()})`);
    const nDiffer = Number(/(\d+) differ/.exec(summary)?.[1]);
    check(summary.includes(nDiffer === 1 ? "1 differs from" : `${nDiffer} differ from`), `grammar: "${nDiffer === 1 ? "1 differs" : `${nDiffer} differ`} from the recipe now"`);
    await page.click("[data-run='2026-10-20_1430'] [data-run-settings] summary");
    const verse = await page.$("[data-run='2026-10-20_1430'] [data-run-settings] [data-setting=verseEffect]");
    check(!!verse && (await verse.getAttribute("data-differs")) === "true" && ((await verse.textContent()) ?? "").includes("now: glide"), 'Verse effect "floating" marked, "now: glide"');

    // Use these settings -> Generate with that run's settings.
    await page.click("[data-run='2026-10-20_1430'] [data-use-settings]");
    await page.waitForSelector("[data-from-run]");
    check(page.url().includes("tab=generate") && page.url().includes("from=2026-10-20_1430"), "Use these settings opens Generate for that run");
    check((await page.textContent("[data-run-section-label]")) === "0:34–1:06 (from that run)", 'section "0:34–1:06 (from that run)"');
    const chips = await page.$$eval("[data-platform-choice]", (e: Element[]) => e.filter((x) => x.className.includes("bg-brand")).map((x) => x.getAttribute("data-platform-choice")));
    check(JSON.stringify(chips) === JSON.stringify(["reels"]), `the platforms of that run (got ${(chips as string[]).join(", ")})`);
    await page.click("[data-switch-auto]");
    // N1: no editable section / length in Make any more; the run's values are shown read-only.
    check(((await page.textContent("[data-run-section]")) ?? "").includes("auto · 32 s") && !(await page.$("input[name=section]")), 'one click back to "auto · 32 s" (shown, not an input)');

    // The pro assessment on each tile, and a reaction: what it changes, then song.json.
    await page.goto(`${base}/songs/${sp.project.id}?tab=videos`);
    await showTab("reels");
    await page.waitForSelector("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] [data-verdict]");
    check((await page.getAttribute("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] [data-verdict]", "data-verdict")) === "ready", "v1 (QA passed) is ✅ Ready to post");
    await page.click("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] [data-reactions-toggle]");
    await page.click("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] [data-reaction=too-fast]");
    await page.waitForSelector("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] [data-reaction-plan]");
    const planText = (await page.textContent("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] [data-reaction-plan]")) ?? "";
    check(planText.includes("Next run: shots one bar longer"), `"cuts too fast" says what it changes (${planText.slice(0, 80)})`);
    await page.click("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] [data-reaction-apply=song]");
    await page.waitForSelector("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] [data-reaction-done]");
    check((JSON.parse(readFileSync(path.join(paths.root, "song.json"), "utf8")) as { paceShift?: number }).paceShift === 1, 'song.json holds "paceShift": 1');

    // The Compare player: its timeline covers the whole video, also on a second opening (video cached),
    // and after the end the bar can be dragged back and play starts again from 0.
    for (const round of ["first opening", "second opening (cached)"]) {
      await page.goto(`${base}/songs/${sp.project.id}?tab=videos`);
      await showTab("reels");
      await page.click("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] button:has-text('Compare')");
      await page.click("[data-video*='2026-10-20_1430/reels/'][data-video$='v2.manifest.json'] button:has-text('Compare')");
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
    await showTab("reels");
    await Promise.all([page.waitForResponse((r: { url(): string }) => r.url().includes("/api/marks")), page.click("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'] button:has-text('Approve')")]);
    await page.waitForSelector("[data-video*='2026-10-20_1430/reels/'][data-video$='v1.manifest.json'][data-mark=approved]");
    await page.goto(`${base}/songs/${sp.project.id}?tab=post`);
    await page.waitForSelector("[data-post-video]");
    check((await page.$$("[data-post-video]")).length === 1, "Post lists the approved video only (v1, not v2)");
    await page.waitForSelector("[data-post-panel] [data-section]");
    check(((await page.textContent("[data-post-panel]")) ?? "").includes("Caption"), "with its caption to copy");
    // Song links: none yet = a pointer to Prepare → Details; added there (N1; was Assets) (the service recognised from the link),
    // the Reel's post shows the best one (the smart link) with a copy button; "Add a link" picks another,
    // kept per platform in song.json postLinks.
    await page.waitForSelector("[data-post-links-none]");
    check(((await page.textContent("[data-post-links-none]")) ?? "").includes("Prepare → Details"), "Post: no links yet, with a pointer to Prepare → Details");
    await page.goto(`${base}/songs/${sp.project.id}?tab=details`);
    await page.waitForSelector("[data-links] [data-link-new]");
    for (const url of ["https://open.spotify.com/track/abc", "https://ffm.to/posttest", "https://www.facebook.com/lifelyrics"]) {
      await page.fill("[data-link-new]", url);
      await Promise.all([page.waitForResponse((r: { url(): string; request(): { method(): string } }) => r.url().includes("/links") && r.request().method() === "PUT"), page.press("[data-link-new]", "Enter")]);
    }
    await page.waitForSelector("[data-link-row=facebook]");
    const savedLinks = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { links?: { service: string }[] }).links ?? [];
    check(savedLinks.map((l) => l.service).join(",") === "spotify,featurefm,facebook", `Assets: links saved with their services (${savedLinks.map((l) => l.service).join(",")})`);
    await page.goto(`${base}/songs/${sp.project.id}?tab=post`);
    await page.waitForSelector("[data-post-links] [data-post-link]");
    const shown = await page.$$eval("[data-post-link]", (els: Element[]) => els.map((e) => e.getAttribute("data-post-link")));
    check(shown.join(",") === "featurefm", `Post (Reels): the smart link by default (${shown.join(",")})`);
    await page.click("[data-picker-open=post-links]");
    await Promise.all([page.waitForResponse((r: { url(): string; request(): { method(): string } }) => r.url().includes("/links") && r.request().method() === "POST"), page.click("[data-picker=post-links] [data-picker-item='https://open.spotify.com/track/abc']")]);
    await page.waitForSelector("[data-post-link=spotify]");
    const picks = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { postLinks?: Record<string, string[]> }).postLinks ?? {};
    check(JSON.stringify(picks.reels) === JSON.stringify(["https://ffm.to/posttest", "https://open.spotify.com/track/abc"]), `Post: the pick is kept for Reels (${JSON.stringify(picks)})`);
    await page.keyboard.press("Escape");
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


    // ---- Videos tab: verdicts, empty runs, the player, and fast clicks ----
    await page.goto(`${base}/songs/${sp.project.id}?tab=videos`);
    await showTab("tiktok");
    const tt = "[data-review-platform=tiktok] [data-review-header]";
    const tile = (run: string, plat: string, n: string) => `[data-video*='${run}/${plat}/'][data-video$='${n}.manifest.json']`;
    const tk = (n: string) => tile("2026-10-22_1000", "tiktok", n);
    // 1 + 4: the tab's header shows the verdict of the platform's videos; old-style manifests get a verdict too.
    check((await page.getAttribute(`${tt} [data-platform-verdict]`, "data-platform-verdict")) === "not-ready", "the TikTok tab's header: the worst verdict of its videos (Not ready)");
    check((((await page.textContent(`${tt} [data-platform-verdict]`)) ?? "").toLowerCase()).includes("not ready"), "the header says it in plain words");
    const verdictOf = (sel: string) => page.getAttribute(`${sel} [data-verdict]`, "data-verdict");
    check((await verdictOf(tk("v1"))) === "ready" && (await verdictOf(tk("v2"))) === "good" && (await verdictOf(tk("v3"))) === "not-ready", "old-style manifests (no pace / ending / props): verdicts ready / good / not-ready on the tiles");
    const runsText = await page.$$eval("[data-review-platform] [data-card]", (els: Element[]) => els.map((e) => e.textContent).join("\n"));
    check(!/\b(WARN|PASS)\b/.test(runsText), "no WARN / PASS wording in Review");
    await showTab("reels");
    check((await page.getAttribute("[data-review-platform=reels] [data-review-header] [data-platform-verdict]", "data-platform-verdict")) === "ready", "the Reels tab's header: both reels ready -> Ready");
    await showTab("youtube");
    check((await page.$("[data-review-platform=youtube] [data-review-header] [data-platform-verdict]")) === null, "no summary for a platform with one video");
    check((await verdictOf(tile("2026-10-23_0900", "youtube", "v1"))) === "good", "old-style YouTube video has its verdict too");
    // Tabs: only the platforms with videos (Shorts has nothing finished: no tab), each with its count.
    const tabNames = await page.$$eval("[data-review-tabs] [role=tab]", (e: Element[]) => e.map((x) => x.getAttribute("data-review-tab")));
    check(JSON.stringify(tabNames) === JSON.stringify(["reels", "tiktok", "youtube", "post"]), `Review's tabs: Reels, TikTok, YouTube, Post (${tabNames.join(", ")})`);

    // 2: empty runs hidden inside the tab, the link brings them back, remembered.
    await showTab("reels");
    check((await page.$("[data-run='2026-10-18_0900']")) === null, "the Reels tab hides its empty run");
    check(((await page.textContent("[data-show-empty]")) ?? "").trim() === "Show 1 empty run", 'link "Show 1 empty run"');
    await page.click("[data-show-empty]");
    await page.waitForSelector("[data-run='2026-10-18_0900']");
    check(((await page.textContent("[data-run='2026-10-18_0900']")) ?? "").includes("No finished videos in this run."), "empty run is back, saying so");
    await page.reload();
    await page.waitForSelector("[data-review-platform=reels] [data-run='2026-10-18_0900']");
    check(true, "the choice and the tab are remembered after a reload");
    await page.click("[data-show-empty]");
    await page.waitForFunction(() => !document.querySelector("[data-run='2026-10-18_0900']"));
    check(((await page.textContent("[data-show-empty]")) ?? "").trim() === "Show 1 empty run", "hidden again with the toggle");

    // 6: Ready to post shows the video with controls and sound.
    await page.click(`${tile("2026-10-20_1430", "reels", "v1")} button:has-text('Post')`);
    await page.waitForSelector("[role=dialog] video[data-player]");
    check((((await page.textContent("[role=dialog] h2")) ?? "").trim()) === "Post Reels v1", 'the Post dialog is titled "Post Reels v1" (the verdict badge keeps "Ready to post")');
    const dv = "[role=dialog] video[data-player]";
    await page.waitForFunction((sel: string) => (document.querySelector(sel) as HTMLVideoElement).readyState >= 1, dv);
    const info = await page.$eval(dv, (v: HTMLVideoElement) => ({ d: v.duration, controls: v.controls, muted: v.muted, poster: v.poster, preload: v.preload }));
    check(info.d > 10 && info.controls && !info.muted && info.poster.includes("/api/poster/") && info.preload === "metadata", `Ready to post: playable video with controls and sound (${info.d.toFixed(1)} s)`);
    await page.$eval(dv, (v: HTMLVideoElement) => {
      v.currentTime = v.duration - 1;
      return v.play();
    });
    await page.waitForFunction((sel: string) => (document.querySelector(sel) as HTMLVideoElement).ended, dv, { timeout: 8000 });
    await page.$eval(dv, (v: HTMLVideoElement) => (v.currentTime = 5));
    await sleep(400);
    check(Math.abs((await page.$eval(dv, (v: HTMLVideoElement) => v.currentTime)) - 5) < 0.6, "Ready to post: after the end, seeking back works");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[role=dialog]", { state: "detached" });

    // 6: a click on the tile's picture opens the player; the star does not.
    const r2 = tile("2026-10-20_1430", "reels", "v2");
    await page.click(`${r2} button[aria-label='Add to favourites']`);
    await sleep(300);
    check((await page.$("[data-player-dialog]")) === null, "the star does not open the player");
    await page.click(`${r2} button[aria-label='Remove from favourites']`);
    await page.click(`${r2} [data-tile-picture]`, { position: { x: 60, y: 200 } });
    await page.waitForSelector("[data-player-dialog]");
    check((((await page.textContent("[data-player-dialog] h2")) ?? "").trim()) === "Reels v2", "player dialog titled Reels v2");
    check(((await page.textContent("[data-player-verdict]")) ?? "").includes("Ready to post"), "player dialog shows the verdict");
    check((await page.$$("[data-player-dialog] button:has-text('Approve'), [data-player-dialog] button:has-text('Discard'), [data-player-dialog] button:has-text('Post')")).length === 3, "player dialog has Approve / Discard / Post");
    await page.waitForFunction(() => (document.querySelector("[data-player-dialog] video") as HTMLVideoElement).readyState >= 1);
    await page.$eval("[data-player-dialog] video", (v: HTMLVideoElement) => v.play());
    await sleep(1200);
    check((await page.$eval("[data-player-dialog] video", (v: HTMLVideoElement) => v.currentTime)) > 0.3 && !(await page.$eval("[data-player-dialog] video", (v: HTMLVideoElement) => v.muted)), "the player plays, with sound");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-player-dialog]", { state: "detached" });

    // 5: fast clicks. Discard six videos at once (three with Playwright clicks and no waits, three in one
    // synchronous burst): they stay hidden, the marks are stored, nothing comes back, also after a reload.
    await showTab("tiktok");
    const discardBtn = (n: string) => `${tk(n)} button:has-text('Discard')`;
    const tilesLeft = () => page.$$eval("[data-video*='2026-10-22_1000/tiktok/']", (e: Element[]) => e.length);
    check((await tilesLeft()) === 6, "six TikTok tiles before");
    let maxBack = 0;
    let watching = true;
    const watcher = (async () => {
      let lowest = 6;
      while (watching) {
        const n = await tilesLeft().catch(() => 0);
        lowest = Math.min(lowest, n);
        if (n > lowest) maxBack = Math.max(maxBack, n - lowest); // tiles that came back
        await sleep(40);
      }
    })();
    for (const n of ["v1", "v2", "v3"]) await page.click(discardBtn(n), { noWaitAfter: true }); // back to back, no waits for the app
    await page.evaluate(() => {
      for (const n of ["v4", "v5", "v6"]) {
        const t = document.querySelector(`[data-video*='2026-10-22_1000/tiktok/'][data-video$='${n}.manifest.json']`);
        Array.from(t?.querySelectorAll("button") ?? []).find((b) => b.textContent?.trim() === "Discard")?.click();
      }
    });
    await page.waitForFunction(() => document.querySelectorAll("[data-video*='2026-10-22_1000/tiktok/']").length === 0, null, { timeout: 8000 }).catch(async () => {
      console.log("left:", await page.$$eval("[data-video*='2026-10-22_1000/tiktok/']", (e: Element[]) => e.map((x) => x.getAttribute("data-video")!.split("/").pop() + ":" + x.getAttribute("data-mark"))));
    });
    await page.waitForLoadState("networkidle");
    await sleep(3000);
    watching = false;
    await watcher;
    check((await tilesLeft()) === 0 && maxBack === 0, `fast Discard x6: all stay hidden, nothing reappears (came back: ${maxBack})`);
    const stored = () => {
      const w = openWorkspace(wsDir);
      try {
        return w.db.select().from(videoMark).all();
      } finally {
        w.close();
      }
    };
    const discardedStored = () => stored().filter((m) => m.video.includes("2026-10-22_1000/tiktok/") && m.status === "discarded").length;
    check(discardedStored() === 6, `all six marks stored (${discardedStored()})`);
    await page.reload();
    await page.waitForSelector("[data-review-platform=tiktok]");
    check((await tilesLeft()) === 0, "after a reload they are still hidden");
    // Mixed quick clicks on the discarded ones: restore three, favourite one, approve one.
    await page.click("button:has-text('Show discarded')");
    await page.waitForSelector(tk("v6"));
    for (const n of ["v1", "v2", "v3"]) await page.click(`${tk(n)} button:has-text('Restore')`, { noWaitAfter: true });
    await page.click(`${tk("v4")} button[aria-label='Add to favourites']`, { noWaitAfter: true });
    await page.click(`${tk("v5")} button:has-text('Approve')`, { noWaitAfter: true });
    await page.waitForLoadState("networkidle");
    await sleep(2500);
    const marksShown = async (): Promise<Record<string, unknown>> => page.$$eval("[data-video*='2026-10-22_1000/tiktok/']", (e: Element[]) => Object.fromEntries(e.map((x) => [x.getAttribute("data-video")!.split("/").pop()!.split(".")[0], x.getAttribute("data-mark")])));
    // By name (the order on screen: the approved ones first, since 11 Nov 2026).
    const marksNow = async () => Object.fromEntries(Object.entries(await marksShown()).sort(([a], [b]) => a.localeCompare(b)));
    const want = { v1: "generated", v2: "generated", v3: "generated", v4: "discarded", v5: "approved", v6: "discarded" };
    check(JSON.stringify(await marksNow()) === JSON.stringify(want), `mixed quick clicks end as clicked (${JSON.stringify(await marksNow())})`);
    const st = stored().filter((m) => m.video.includes("2026-10-22_1000/tiktok/"));
    const byName = Object.fromEntries(st.map((m) => [m.video.split("/").pop()!.split(".")[0], m]));
    check(["v1", "v2", "v3"].every((n) => byName[n]?.status === "generated") && byName.v4?.favourite === true && byName.v5?.status === "approved" && byName.v6?.status === "discarded", "and are stored that way");
    await page.reload();
    await page.click("button:has-text('Show discarded')");
    await page.waitForSelector(tk("v6"));
    check(JSON.stringify(await marksNow()) === JSON.stringify(want), "same after a reload");

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
