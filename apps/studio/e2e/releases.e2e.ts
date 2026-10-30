// Browser test of Releases (needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/releases.e2e.ts
// The header link, New release (Pick an EP ticks its songs), the grid (songs x platforms in the Library's
// colours, "·" for a platform a song does not use), Make all (a preview of what is missing, what cannot
// be made and an estimate; then queued, nothing approved or waiting made again), rename, delete, restore.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRun, openWorkspace, videoMark } from "@lyric/db";
import { createSong, readRecipe, songPathsById, writeRecipe } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-rel-"));
const wsDir = path.join(root, "workspace");
const port = 3195;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};
const video = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.mp4`), "x");
  writeFileSync(path.join(dir, `${name}.manifest.json`), JSON.stringify({ manifest_version: 1, created_at: "2026-10-29T09:00:00Z", command: "pnpm make", variation: { order: "story", seed: 1, style: "Simple", cinematic_bars: false }, props: {} }));
  writeFileSync(path.join(dir, `${name}.qa.txt`), "x\nSummary: PASS\n");
};

async function main() {
  mkdirSync(root, { recursive: true });
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, "Hold on to me\n");
  ffmpeg("-f", "lavfi", "-i", "color=c=0xE8A3B5:s=64x64", "-frames:v", "1", path.join(root, "cover.jpg"));
  const ws = openWorkspace(wsDir);
  const ids: Record<string, string> = {};
  for (const [title, hz, ep] of [["A Heart For Two", 330, "In The Mood"], ["Love Is A Good Thing", 440, "In The Mood"], ["These Empty Roads", 550, ""]] as const) {
    const f = path.join(root, `${title}.wav`);
    ffmpeg("-f", "lavfi", "-i", `sine=frequency=${hz}:duration=3`, f);
    ids[title] = (await createSong(ws, { song: f, lyrics, cover: path.join(root, "cover.jpg"), ...(ep ? { ep } : {}) })).id;
  }
  const heart = songPathsById(ws, ids["A Heart For Two"]);
  writeRecipe(heart.recipe!, { ...readRecipe(heart.recipe!), platforms: ["reels", "youtube"], collections: ["wedding"] });
  video(path.join(heart.exports, "2026-10-29_1000", "reels"), "v1");
  video(path.join(heart.exports, "2026-10-29_1000", "youtube"), "v1");
  ws.db.insert(videoMark).values({ project_id: ids["A Heart For Two"], video: path.relative(wsDir, path.join(heart.exports, "2026-10-29_1000", "reels", "v1.manifest.json")).split(path.sep).join("/"), status: "approved" }).run();
  const love = songPathsById(ws, ids["Love Is A Good Thing"]);
  writeRecipe(love.recipe!, { ...readRecipe(love.recipe!), collections: ["wedding"] });
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(base);
    await page.click("header a:has-text('Releases')");
    await page.waitForSelector("[data-new-release]");

    // New release: Pick an EP ticks its two songs and fills the name; add the third by hand.
    await page.click("[data-new-release]");
    await page.click("[data-pick-ep='In The Mood']");
    check((await page.inputValue("[data-release-name]")) === "In The Mood", "Pick an EP fills in the name");
    const ticked = await page.$$eval("[data-song-choice]", (e: Element[]) => e.filter((x) => (x as HTMLInputElement).checked).map((x) => x.getAttribute("data-song-choice")));
    check(JSON.stringify(ticked.sort()) === JSON.stringify(["A Heart For Two", "Love Is A Good Thing"]), `…and ticks the EP's songs (${ticked.join(", ")})`);
    await page.check("[data-song-choice='These Empty Roads']");
    await page.click("[data-save-release]");
    await page.waitForSelector("[data-release-grid]");
    check(existsSync(path.join(wsDir, "releases", "In The Mood.json")), "the release is a file in workspace\\releases\\");

    // The grid.
    const cell = (song: string, p: string) => page.getAttribute(`[data-cell='${song}:${p}']`, "data-state");
    check((await cell("A Heart For Two", "reels")) === "ready" && (await cell("A Heart For Two", "youtube")) === "review", "Heart: Reels approved, YouTube to review");
    check((await cell("A Heart For Two", "tiktok")) === "unused", "Heart: TikTok is not one of its platforms (·)");
    check((await cell("Love Is A Good Thing", "canvas")) === "none", "Love: Canvas not made (—)");
    check(((await page.textContent("[data-release-summary]")) ?? "").includes("1 of 12 ready to post"), "summary: 1 of 12 ready to post");
    check(((await page.getAttribute("[data-cell='Love Is A Good Thing:reels']", "href")) ?? "").endsWith("?tab=generate"), "a cell links to the song");

    // Make all: preview, then queue.
    await page.click("[data-make-all]");
    await page.waitForSelector("[data-make-estimate]");
    const planned = await page.$$eval("[data-plan-song]", (e: Element[]) => e.map((x) => x.getAttribute("data-plan-song")));
    check(JSON.stringify(planned) === JSON.stringify(["Love Is A Good Thing"]), `Make all plans only Love (Heart has nothing missing) (${planned.join(", ")})`);
    check(((await page.textContent("[data-make-skipped]")) ?? "").includes("These Empty Roads"), "These Empty Roads is listed as not made yet (no clips), with the reason");
    check(((await page.textContent("[data-make-estimate]")) ?? "").includes("5 videos"), "estimate: 5 videos and a time");
    await page.click("[data-confirm-make-all]");
    await page.waitForSelector("text=Queued 1 song");
    const ws2 = openWorkspace(wsDir);
    const runs = ws2.db.select().from(makeRun).all();
    check(runs.length === 1 && (runs[0].options_json as { platforms?: string; variations?: number }).platforms === "reels,tiktok,shorts,youtube,canvas" && (runs[0].options_json as { variations?: number }).variations === 1, "one run queued for Love: its 5 platforms, one video each");
    ws2.close();
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

    // Rename, delete, restore.
    await page.click("[data-rename-release]");
    await page.fill("[data-release-new-name]", "In The Mood EP");
    await page.click("[data-save-rename]");
    await page.waitForSelector("[data-release-view='In The Mood EP']");
    check(existsSync(path.join(wsDir, "releases", "In The Mood EP.json")) && !existsSync(path.join(wsDir, "releases", "In The Mood.json")), "Rename: the file follows");
    await page.click("[data-release-view='In The Mood EP'] [data-delete-release]"); // the page before the rename stays hidden in the background
    await page.click("[data-confirm-delete-release]");
    await page.waitForSelector("[data-new-release]");
    check((await page.$("[data-release]")) === null, "Delete: gone from the list (moved to releases\\_removed\\)");
    await page.click("[data-removed-releases] summary");
    await page.click("[data-restore-release='In The Mood EP']");
    await page.waitForSelector("[data-release='In The Mood EP']");
    check(((await page.textContent("[data-release='In The Mood EP'] [data-release-ready]")) ?? "").includes("1 of 12"), "Restore: back, with its songs");
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
