// Browser test of "Same look on every platform" (22 Nov 2026; needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/same-platforms.e2e.ts
// A theme that gives YouTube its own verse effect (like Midnight Highway): the Themes tile says "Differs on YouTube";
// Shape → Look → Edit theme shows the switch off with the difference in words; switching on asks once, then Save
// makes every platform follow the theme and keeps the theme as it was in its _replaced folder; while the switch is
// on, the effects' ⋯ menu has no Per platform….
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace } from "@lyric/db";
import { createSong, ensureSongTheme, loadFontCatalog, loadTheme, writeTheme } from "@lyric/video/node";
import { openPanel, openTab } from "./stage-tabs";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-same-platforms-"));
const wsDir = path.join(root, "workspace");
const port = 3203;
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
  const song = path.join(root, "Wedding Day.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=4", song);
  const id = (await createSong(ws, { song, lyrics })).id;
  const themeName = ensureSongTheme(ws, id, loadFontCatalog(wsDir)).theme!;
  const t = loadTheme(wsDir, themeName);
  writeTheme(wsDir, { ...t, look: { ...t.look, verseEffect: "typewriter:15" }, perPlatform: { youtube: { verseEffect: "cinematic-fade" } } });

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

    // The Themes page: the tile says where the theme differs.
    await page.goto(`${base}/themes`);
    await page.waitForSelector("[data-themes-tile]");
    check((await page.getAttribute(`[data-themes-tile='${themeName}'] [data-theme-differs]`, "data-theme-differs")) === "YouTube", "Themes tile: Differs on YouTube");

    // Shape → Look → Edit theme: the switch is off and says what differs.
    await page.goto(`${base}/songs/${id}`);
    await openTab(page, "Shape");
    await openPanel(page, "look");
    await page.click("[data-look-edit-theme]");
    await page.waitForSelector("[data-theme-editors]");
    check((await page.getAttribute("[data-same-platforms]", "data-same-platforms")) === "off", "the editor: the switch is off for a theme that differs");
    const diff = (await page.textContent("[data-same-platforms-differences]")) ?? "";
    check(diff.includes("Different on YouTube: verse effect cinematic-fade (typewriter:15 everywhere else)"), `the difference in words (${diff})`);
    if (process.env.SAME_SHOT) await page.locator("[data-same-platforms]").screenshot({ path: process.env.SAME_SHOT.replace(".png", "-off.png") });

    // Switching on asks once; Keep leaves it as it is.
    await page.click("[data-same-platforms-switch]");
    await page.waitForSelector("[data-same-platforms-ask]");
    const ask = (await page.textContent("[data-same-platforms-ask]")) ?? "";
    check(ask.includes("YouTube: verse effect becomes typewriter:15"), `the question names what changes (${ask})`);
    if (process.env.SAME_SHOT) await page.locator("[data-same-platforms]").screenshot({ path: process.env.SAME_SHOT.replace(".png", "-ask.png") });
    await page.click("[data-same-platforms-keep]");
    check(!(await page.$("[data-same-platforms-ask]")) && (await page.getAttribute("[data-same-platforms]", "data-same-platforms")) === "off", "Keep the differences: nothing changes");

    // Make them the same: the switch on, not saved yet; the effects' ⋯ menu has no Per platform….
    await page.click("[data-same-platforms-switch]");
    await page.click("[data-same-platforms-confirm]");
    check((await page.getAttribute("[data-same-platforms]", "data-same-platforms")) === "on" && !!(await page.$("[data-theme-unsaved]")), "Make them the same: switch on, not saved yet");
    check(Object.keys(loadTheme(wsDir, themeName).perPlatform).length === 1, "nothing saved before Save");
    await page.click("[data-row-menu='effects']").catch(() => {});
    await sleep(300);
    check(!(await page.$("[data-effects-per-platform]")), "switch on: no Per platform… in the effects menu");
    await page.keyboard.press("Escape");
    if (process.env.SAME_SHOT) await page.locator("[data-same-platforms]").screenshot({ path: process.env.SAME_SHOT.replace(".png", "-on.png") });

    // Save: every platform follows the theme; the theme as it was is kept.
    await page.click("[data-theme-save]");
    for (let i = 0; i < 20 && Object.keys(loadTheme(wsDir, themeName).perPlatform).length; i++) await sleep(250);
    check(JSON.stringify(loadTheme(wsDir, themeName).perPlatform) === "{}" && loadTheme(wsDir, themeName).look.verseEffect === "typewriter:15", "Save: typewriter on every platform");
    const replaced = path.join(wsDir, "themes", themeName, "_replaced");
    check(existsSync(replaced) && readdirSync(replaced).some((f) => /^theme-.*\.json$/.test(f)), "the theme as it was is kept in _replaced");

    // Switching off brings Per platform… back.
    await page.waitForSelector("[data-theme-unsaved]", { state: "detached" });
    if (!(await page.$("[data-theme-editors]"))) {
      await openPanel(page, "look");
      await page.click("[data-look-edit-theme]");
      await page.waitForSelector("[data-theme-editors]");
    }
    check((await page.getAttribute("[data-same-platforms]", "data-same-platforms")) === "on", "a theme without differences: the switch is on");
    await page.click("[data-same-platforms-switch]");
    check((await page.getAttribute("[data-same-platforms]", "data-same-platforms")) === "off" && !(await page.$("[data-same-platforms-ask]")), "switch off: no question, Per platform… is offered again");
    await page.click("[data-row-menu='effects']").catch(() => {});
    await sleep(300);
    check(!!(await page.$("[data-effects-per-platform]")), "switch off: Per platform… in the effects menu");

    await page.goto(`${base}/themes`);
    await page.waitForSelector("[data-themes-tile]");
    check(!(await page.$(`[data-themes-tile='${themeName}'] [data-theme-differs]`)), "Themes tile: no Differs note any more");
    await browser.close();
  } finally {
    server.kill();
    ws.close();
  }
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll browser checks passed");
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    process.exit(failures ? 1 : 0);
  })
  .catch((error) => {
    console.error(error);
    console.log("\n1 check(s) failed");
    rmSync(root, { recursive: true, force: true });
    process.exit(1);
  });
