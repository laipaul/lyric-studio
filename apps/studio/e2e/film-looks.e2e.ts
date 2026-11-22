// Browser test of Film looks (22 Nov 2026; needs a studio build, FFmpeg and Playwright; the writer and the video
// services are stand-ins: LYRIC_GENERATE_STUB, nothing is sent anywhere):
//   npx tsx apps/studio/e2e/film-looks.e2e.ts
// The Film looks page in the top menu: a new look named first, a still dropped in, "Write it from the still" fills the
// look line and the Midjourney words; the song picks it in Prepare → Creation (song.json "filmLook"); the Library card
// shows it next to the theme; a look in use cannot be deleted; a rename takes the song along.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace } from "@lyric/db";
import { createSong, readRecipe, songPathsById } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-filmlook-"));
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

async function main() {
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, "Hold on to me\n* Never let go\n");
  const song = path.join(root, "Wedding Day.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=4", song);
  const ws = openWorkspace(wsDir);
  const { id } = await createSong(ws, { song, lyrics });
  const recipe = songPathsById(ws, id).recipe!;
  ws.close();
  const still = path.join(root, "shotdeck.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=orange:s=320x180", "-frames:v", "1", still);

  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1", LYRIC_GENERATE_STUB: "1" },
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

    // The page, from the top menu.
    await page.goto(`${base}/`);
    await page.click("header a[href='/film-looks']");
    await page.waitForSelector("[data-film-looks-page]");
    check(true, "Film looks is in the top menu");
    await page.click("[data-film-look-new]");
    await page.fill("[data-film-look-new-name]", "Warm wedding film");
    await page.click("[data-film-look-create] button[type=submit]");
    const card = "[data-film-look-card='Warm wedding film']";
    await page.waitForSelector(card);
    check(await page.$eval(`${card} [data-film-look-write]`, (e: Element) => (e as HTMLButtonElement).disabled), "Write it from the still: waits for a still");
    await page.setInputFiles(`${card} [data-film-look-still] input[type=file]`, still);
    await page.waitForSelector(`${card} [data-film-look-still] img`);
    check(true, "the still shows on the card");
    await page.click(`${card} [data-film-look-write]`);
    await page.waitForFunction((c: string) => ((document.querySelector(`${c} [data-film-look-line]`) as HTMLTextAreaElement | null)?.value ?? "").includes("ARRI"), card);
    const mj = await page.$eval(`${card} [data-film-look-midjourney]`, (e: Element) => (e as HTMLTextAreaElement).value);
    check(/--style raw$/.test(mj), `the Midjourney words are written too (${mj})`);

    // The song picks it in Creation.
    await page.goto(`${base}/songs/${id}?tab=production`);
    await page.waitForSelector("[data-film-look-select]");
    await page.selectOption("[data-film-look-select]", "Warm wedding film");
    await page.waitForSelector("[data-film-look-line]");
    await sleep(200);
    check(readRecipe(recipe).filmLook === "Warm wedding film", 'song.json holds "filmLook": "Warm wedding film"');
    check(((await page.textContent("[data-film-look-line]")) ?? "").includes("35mm"), "Creation shows the look's words");

    // The Library card.
    await page.goto(`${base}/`);
    await page.waitForSelector("[data-card-film-look='Warm wedding film']");
    check(true, "the Library card names the Film look");

    // In use: no Delete; a rename takes the song along.
    await page.goto(`${base}/film-looks`);
    await page.waitForSelector(card);
    check(await page.$eval(`${card} [data-film-look-delete]`, (e: Element) => (e as HTMLButtonElement).disabled), "a look a song uses cannot be deleted");
    check(((await page.textContent(`${card} [data-film-look-songs]`)) ?? "").includes("Wedding Day"), "the card names the song that uses it");
    await page.fill(`${card} [data-film-look-name]`, "Golden hour");
    await page.click(`${card} [data-film-look-save]`);
    await page.waitForSelector("[data-film-look-card='Golden hour']");
    check(readRecipe(recipe).filmLook === "Golden hour", "a rename: the song follows");
    const look = JSON.parse(readFileSync(path.join(wsDir, "film-looks", "Golden hour", "look.json"), "utf8")) as { line: string; still: string };
    check(look.still === "still.png" && look.line.includes("ARRI"), "film-looks\\Golden hour\\look.json keeps the still and the line");
    await browser.close();
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
