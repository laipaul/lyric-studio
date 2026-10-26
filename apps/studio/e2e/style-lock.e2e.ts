// Browser test of the song page's Style and Generate tabs (needs a studio build: pnpm --filter
// @lyric/studio build, FFmpeg, and Playwright with Chromium, as in the cloud check):
//   pnpm test:e2e
// It reproduces the 6.2c-2a lock bug: typing a Reels length and clicking the Hook effect padlock right
// away (leaving the field saves it). The padlock must show "locked" at once and after saving, song.json
// must hold the lock, and Generate must show Hook effect locked (greyed out); unlocking undoes it.
// Also: the "videos per platform" placeholder, the empty-platforms note, per-platform effects in Generate.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace } from "@lyric/db";
import { findOrCreateSongProject, songPathsById } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-"));
const wsDir = path.join(root, "workspace");
const port = 3197;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  // A song folder with lyrics and a song.json that gives YouTube its own verse effect.
  const song = path.join(root, "Lock Test.wav");
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=8", song]);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  ws.close();
  writeFileSync(path.join(paths.root, "lyrics.txt"), "Line one\n* Hold on\n");
  writeFileSync(paths.recipe!, JSON.stringify({ perPlatform: { youtube: { verseEffect: "cinematic-fade" } } }));
  mkdirSync(path.join(wsDir, "collections", "wedding"), { recursive: true });

  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "ignore",
  });
  // Playwright is not a project dependency (it comes with the cloud check's browser).
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
    await page.click("[role=tab]:has-text('Style')");
    await page.waitForSelector("[data-field=hookEffect]");

    // Polish: wide "videos per platform" inputs with the preset's number; the empty-platforms note.
    check((await page.getAttribute("[data-field=variations] input", "placeholder")) === "3 (preset)", 'videos per platform placeholder "3 (preset)" (Reels)');
    check(!!(await page.$("[data-platforms-empty]")), "empty platforms: the note says Generate starts with Reels + YouTube");

    // The bug: type a length, then click the padlock straight away.
    await page.click("[data-per-platform=length]");
    await page.fill("[data-edit='length-reels']", "90");
    await page.click("[data-lock=hookEffect]");
    check((await page.getAttribute("[data-lock=hookEffect]", "aria-pressed")) === "true", "the padlock shows locked at once");
    await page.waitForSelector("[data-saving=saved]");
    check((await page.getAttribute("[data-lock=hookEffect]", "aria-pressed")) === "true", "the padlock still shows locked after saving");
    const recipe = JSON.parse(readFileSync(paths.recipe!, "utf8")) as { locked?: string[]; perPlatform?: { reels?: { length?: number } } };
    check(!!recipe.locked?.includes("hookEffect"), 'song.json holds "locked": ["hookEffect"]');
    check(recipe.perPlatform?.reels?.length === 90, "song.json holds the Reels length typed just before (90)");

    await page.click("[role=tab]:has-text('Generate')");
    await page.waitForSelector("[aria-label='Hook effect']");
    check(await page.$eval("[aria-label='Hook effect']", (s: HTMLSelectElement) => (s).disabled), "Generate: Hook effect is locked (greyed out)");
    check(await page.$eval("[aria-label='Verse effect']", (s: HTMLSelectElement) => !(s).disabled), "Generate: Verse effect can be changed");
    const chips = await page.$$eval("[data-platform-choice]", (e: Element[]) => e.filter((x) => x.className.includes("bg-brand")).map((x) => x.getAttribute("data-platform-choice")));
    check(JSON.stringify(chips) === JSON.stringify(["reels", "youtube"]), `Generate starts with Reels + YouTube (got ${(chips as string[]).join(", ")})`);
    check((await page.$eval("[aria-label='Verse effect'] option", (o: Element) => o.textContent)) === "From the recipe (glide)", 'the recipe option is short: "From the recipe (glide)"');
    check((await page.textContent("[data-per-platform-effects=verse]")) === "YouTube: cinematic-fade", 'per-platform effects on a line under the list ("YouTube: cinematic-fade")');

    // Unlock again.
    await page.click("[role=tab]:has-text('Style')");
    await page.waitForSelector("[data-lock=hookEffect][aria-pressed=true]");
    await page.click("[data-lock=hookEffect]");
    await page.waitForSelector("[data-saving=saved]");
    check((await page.getAttribute("[data-lock=hookEffect]", "aria-pressed")) === "false", "unlocked: the padlock opens");
    await page.click("[role=tab]:has-text('Generate')");
    await page.waitForSelector("[aria-label='Hook effect']");
    check(await page.$eval("[aria-label='Hook effect']", (s: HTMLSelectElement) => !(s).disabled), "Generate: Hook effect can be changed again");
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
