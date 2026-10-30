// Browser test of the Library cards (Step H; needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/library.e2e.ts
// One colour system per platform chip (grey / amber / green / red), no truncated chip, a summary line,
// one action per card (Generate / Fix / Review), titles on two lines, filters, sorting, "Same cover as".
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, videoMark } from "@lyric/db";
import { createSong, songPathsById } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-lib-"));
const wsDir = path.join(root, "workspace");
const port = 3197;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};
// A finished video of a run (what "pnpm make" leaves: mp4, manifest, QA report).
const video = (dir: string, name: string, qa = "PASS") => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.mp4`), "x");
  writeFileSync(path.join(dir, `${name}.manifest.json`), JSON.stringify({ manifest_version: 1, created_at: "2026-10-29T09:00:00Z", command: "pnpm make song.wav lyrics.txt", variation: { order: "story", seed: 1, style: "Simple", cinematic_bars: false }, props: {} }));
  writeFileSync(path.join(dir, `${name}.qa.txt`), `x\nSummary: ${qa}\n`);
};

async function main() {
  mkdirSync(root, { recursive: true });
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, "Verse one\n* Hold on to me\n");
  ffmpeg("-f", "lavfi", "-i", "color=c=0xE8A3B5:s=64x64", "-frames:v", "1", path.join(root, "flowers.jpg"));
  ffmpeg("-f", "lavfi", "-i", "color=c=0x223355:s=64x64", "-frames:v", "1", path.join(root, "road.jpg"));
  const song = (title: string, hz: number) => {
    const f = path.join(root, `${title}.wav`);
    ffmpeg("-f", "lavfi", "-i", `sine=frequency=${hz}:duration=3`, f);
    return f;
  };
  const ws = openWorkspace(wsDir);
  await createSong(ws, { song: song("Tea With The Monk", 220), lyrics });
  const love = await createSong(ws, { song: song("Love Is A Good Thing", 330), lyrics, cover: path.join(root, "flowers.jpg") });
  const heart = await createSong(ws, { song: song("A Heart For Two", 440), lyrics, cover: path.join(root, "flowers.jpg") });
  const house = await createSong(ws, { song: song("The House My Heart Built Above The Quiet River", 550), lyrics, cover: path.join(root, "road.jpg") });
  // Love: Reels made (to review) + YouTube approved.  Heart: Reels approved only.  House: TikTok failed (v2 never finished).
  const ex = (id: string) => songPathsById(ws, id).exports;
  video(path.join(ex(love.id), "2026-10-29_1000", "reels"), "v1");
  video(path.join(ex(love.id), "2026-10-29_1000", "reels"), "v2", "WARN");
  video(path.join(ex(love.id), "2026-10-29_1000", "youtube"), "v1");
  const rel = (f: string) => path.relative(wsDir, f).split(path.sep).join("/");
  ws.db.insert(videoMark).values({ project_id: love.id, video: rel(path.join(ex(love.id), "2026-10-29_1000", "youtube", "v1.manifest.json")), status: "approved" }).run();
  video(path.join(ex(heart.id), "2026-10-28_1000", "reels"), "v1");
  ws.db.insert(videoMark).values({ project_id: heart.id, video: rel(path.join(ex(heart.id), "2026-10-28_1000", "reels", "v1.manifest.json")), status: "approved" }).run();
  video(path.join(ex(house.id), "2026-10-27_1000", "tiktok"), "v1");
  writeFileSync(path.join(ex(house.id), "2026-10-27_1000", "tiktok", "v2.mp4"), "x"); // started, never finished
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
    const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
    await page.goto(base);
    await page.waitForSelector("[data-song='Love Is A Good Thing']");
    const card = (t: string) => `[data-song='${t}']`;
    const state = (t: string, p: string) => page.getAttribute(`${card(t)} [data-platform=${p}]`, "data-state");

    check((await state("Love Is A Good Thing", "reels")) === "review" && (await state("Love Is A Good Thing", "youtube")) === "ready", "Love: Reels amber (to review), YouTube green (approved)");
    check((await state("Love Is A Good Thing", "tiktok")) === "none", "Love: TikTok grey (not made)");
    check((await state("The House My Heart Built Above The Quiet River", "tiktok")) === "error", "House: TikTok red (failed)");
    check((await page.$(`${card("Love Is A Good Thing")} [data-platform=standard]`)) === null, "Standard is hidden while a song has none");
    check(((await page.textContent(`${card("Love Is A Good Thing")} [data-summary]`)) ?? "").includes("1/5 ready · 1 to review"), "summary line: 1/5 ready · 1 to review");
    check(((await page.textContent(`${card("Tea With The Monk")} [data-summary]`)) ?? "").includes("No videos yet"), "summary: No videos yet");

    check((await page.getAttribute(`${card("Tea With The Monk")} [data-card-action]`, "data-card-action")) === "generate", "no videos: a Generate button");
    check((await page.getAttribute(`${card("The House My Heart Built Above The Quiet River")} [data-card-action]`, "data-card-action")) === "fix", "an error: a Fix button");
    check((await page.getAttribute(`${card("Love Is A Good Thing")} [data-card-action]`, "data-card-action")) === "review", "to review: a Review button");
    check((await page.$(`${card("A Heart For Two")} [data-card-action]`)) === null, "all made videos approved: no button");
    check(((await page.getAttribute(`${card("Tea With The Monk")} [data-card-action]`, "href")) ?? "").endsWith("?tab=generate"), "Generate opens the Generate tab");

    // No chip or title cut off.
    const cut = await page.$$eval("[data-platform] > *", (els: Element[]) => els.filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1).length);
    check(cut === 0, `no platform chip is truncated (${cut})`);
    const title = await page.$eval(`${card("The House My Heart Built Above The Quiet River")} h2`, (e: Element) => ({ lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) }));
    check(title.lines === 2, `a long title wraps onto 2 lines (${title.lines})`);

    // Same cover.
    check(((await page.textContent(`${card("A Heart For Two")} [data-same-cover]`)) ?? "").includes("Love Is A Good Thing"), "Same cover as Love Is A Good Thing");
    check((await page.$(`${card("Tea With The Monk")} [data-same-cover]`)) === null, "no warning without a shared cover");

    // Filters.
    const shown = async () => page.$$eval("[data-song]", (e: Element[]) => e.map((x) => x.getAttribute("data-song")).sort());
    await page.click("[data-filter=errors]");
    check(JSON.stringify(await shown()) === JSON.stringify(["The House My Heart Built Above The Quiet River"]), "Errors: only House");
    await page.click("[data-filter=review]");
    check(JSON.stringify(await shown()) === JSON.stringify(["Love Is A Good Thing"]), "Needs review: only Love");
    await page.click("[data-filter=ready]");
    check(JSON.stringify(await shown()) === JSON.stringify(["A Heart For Two"]), "Ready: only Heart");
    await page.click("[data-filter=none]");
    check(JSON.stringify(await shown()) === JSON.stringify(["Tea With The Monk"]), "No videos: only Monk");
    await page.click("[data-filter=all]");

    // Sorting.
    await page.selectOption("[data-sort]", "title");
    const order = await page.$$eval("[data-song]", (e: Element[]) => e.map((x) => x.getAttribute("data-song")));
    check(order[0] === "A Heart For Two" && order[3] === "The House My Heart Built Above The Quiet River", `Sort by title (${order.join(" | ")})`);
    await page.selectOption("[data-sort]", "last");
    const last = await page.$$eval("[data-song]", (e: Element[]) => e.map((x) => x.getAttribute("data-song")));
    // The most recently worked on first: Monk was only added (today), then the newest run (Love).
    check(last[0] === "Tea With The Monk" && last[1] === "Love Is A Good Thing", `Sort by last made (${last.join(" | ")})`);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
    await browser.close();
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
  if (failures) {
    console.log(`${failures} browser check(s) failed`);
    process.exit(1);
  }
  console.log("All browser checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
