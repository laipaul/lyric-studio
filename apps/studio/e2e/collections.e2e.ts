// Browser test of the Collections page (needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/collections.e2e.ts
// The header link, a collection's card (counts, the song that uses it), a new collection, clips added by
// "Add clips", Remove (to _removed\, nothing deleted), Restore, and the clip files served for hover play.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace } from "@lyric/db";
import { findOrCreateSongProject, songPathsById } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-coll-"));
const wsDir = path.join(root, "workspace");
const port = 3199;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
const clip = (file: string, colour: string, size = "216x384") => ffmpeg("-f", "lavfi", "-i", `testsrc2=s=${size}:r=30:d=2`, "-vf", `drawbox=c=${colour}@0.6:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  const wedding = path.join(wsDir, "collections", "wedding");
  mkdirSync(wedding, { recursive: true });
  clip(path.join(wedding, "01_vows.mp4"), "blue");
  clip(path.join(wedding, "02_rings.mp4"), "red", "384x216");
  const extra = path.join(root, "03_dance.mp4");
  clip(extra, "green");
  const song = path.join(root, "Hold On.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=4", song);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  writeFileSync(songPathsById(ws, sp.project.id).recipe!, JSON.stringify({ collections: ["wedding"] }));
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
    await page.goto(base);
    await page.click("header a:has-text('Collections')");
    await page.waitForSelector("[data-collection=wedding]");
    const counts = (await page.textContent("[data-collection=wedding] [data-counts]")) ?? "";
    check(counts.includes("2 clips") && counts.includes("9:16 can use 1") && counts.includes("16:9 can use 1"), `the wedding card: 2 clips, 1 for 9:16, 1 for 16:9 (${counts})`);
    check(((await page.textContent("[data-collection=wedding]")) ?? "").includes("Used by Hold On"), "the card says which song uses it");

    // A new collection.
    await page.fill("[data-new-collection]", "City nights");
    await page.click("button:has-text('New collection')");
    await page.waitForSelector("[data-collection-view='City nights']");
    check(existsSync(path.join(wsDir, "collections", "City nights")), "New collection: the folder collections\\City nights\\ exists");

    // Add, remove, restore in wedding.
    await page.goto(`${base}/collections/wedding`);
    await page.waitForSelector("[data-clip='01_vows.mp4']");
    await page.setInputFiles("[data-clip-input]", extra);
    await page.waitForSelector("[data-clip='03_dance.mp4']", { timeout: 60_000 });
    check(existsSync(path.join(wedding, "03_dance.mp4")), "Add clips: copied into collections\\wedding\\");
    const src = await page.getAttribute("[data-clip='03_dance.mp4'] video", "src");
    check(!!src && (await fetch(`${base}${src}`).then((r) => r.ok)), "the clip file is served (hover plays it)");
    await page.click("[data-remove='02_rings.mp4']");
    await page.waitForSelector("[data-restore='02_rings.mp4']", { state: "attached" });
    check(!existsSync(path.join(wedding, "02_rings.mp4")) && readdirSync(path.join(wedding, "_removed")).includes("02_rings.mp4"), "Remove: moved to _removed\\ (not deleted)");
    await page.click("[data-removed] summary");
    await page.click("[data-restore='02_rings.mp4']");
    await page.waitForSelector("[data-clip='02_rings.mp4']");
    check(existsSync(path.join(wedding, "02_rings.mp4")), "Restore: back in the collection");
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
