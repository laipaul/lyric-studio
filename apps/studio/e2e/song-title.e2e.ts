// Browser test of the song title and Delete song (needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/song-title.e2e.ts
// The song page's title changes in place (the folder follows); "Delete song" asks, moves the folder to
// songs\_removed\ and goes back to the Library; "Deleted songs" there restores it.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace } from "@lyric/db";
import { createSong, songPathsById } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-title-"));
const wsDir = path.join(root, "workspace");
const port = 3198;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  mkdirSync(root, { recursive: true });
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, "Chorus:\nHold on to me\nNever let go\n");
  const ws = openWorkspace(wsDir);
  const ids: string[] = [];
  for (const [i, name] of ["Hold On", "Let Go"].entries()) {
    const song = path.join(root, `${name}.wav`);
    ffmpeg("-f", "lavfi", "-i", `sine=frequency=${330 + i * 110}:duration=${3 + i}`, song);
    ids.push((await createSong(ws, { song, lyrics })).id);
  }

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

    await page.goto(`${base}/songs/${ids[0]}`);
    await page.waitForSelector("[data-song-title]");
    // N1: the header's pencil opens Prepare → Texts, the one place the title is changed.
    await page.click("[data-song-title-edit]");
    await page.waitForSelector("[data-style-block=details] [data-card-title]");
    check(!(await page.$("[data-song-title-input]")), "the header has no title editor of its own (one place: Details)");
    await page.fill("[data-card-title]", "Hold On Tight");
    await page.press("[data-card-title]", "Enter");
    await page.waitForFunction(() => document.querySelector("[data-song-title]")?.textContent === "Hold On Tight");
    for (let i = 0; i < 20 && !existsSync(path.join(wsDir, "songs", "Life Lyrics", "Hold On Tight")); i++) await sleep(150);
    check(existsSync(path.join(wsDir, "songs", "Life Lyrics", "Hold On Tight", "Hold On.wav")) && !existsSync(path.join(wsDir, "songs", "Life Lyrics", "Hold On")), "a new title: the song folder follows (songs\\Life Lyrics\\Hold On Tight)");
    await page.reload();
    await page.waitForSelector("[data-song-title]");
    check((await page.textContent("[data-song-title]")) === "Hold On Tight", "…and stays after reloading");
    // Delete song: asks first, then the Library without it.
    await page.click("[data-row-menu=song]");
    await page.click("[role=menuitem][data-song-delete]");
    await page.waitForSelector("[data-song-delete-ask]");
    check(existsSync(songPathsById(ws, ids[0]).root), "Delete asks first (nothing moved yet)");
    await page.click("[data-song-delete-yes]");
    await page.waitForURL(`${base}/`);
    await page.waitForSelector("[data-deleted-songs]");
    const titles = await page.$$eval("h2", (e: Element[]) => e.map((x) => x.textContent));
    check(!titles.includes("Hold On Tight") && titles.includes("Let Go"), `the Library without it (${titles.join(", ")})`);
    check(existsSync(path.join(wsDir, "songs", "_removed")) && !existsSync(path.join(wsDir, "songs", "Life Lyrics", "Hold On Tight")), "its folder is in songs\\_removed\\ (nothing deleted)");
    await page.click("[data-deleted-songs] button[aria-expanded]");
    await page.click("[data-song-restore='Hold On Tight']");
    await page.waitForFunction(() => [...document.querySelectorAll("h2")].some((h) => h.textContent === "Hold On Tight"));
    check(existsSync(path.join(wsDir, "songs", "Life Lyrics", "Hold On Tight", "Hold On.wav")), "Restore: back in the Library and in its folder");
    await browser.close();
  } finally {
    server.kill();
    ws.close();
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
