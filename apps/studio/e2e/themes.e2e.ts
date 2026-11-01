// Browser test of the Themes page (needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/themes.e2e.ts
// The top menu's Themes page: the gallery with its filters, + New theme, a theme's detail view (designer,
// songs, Use this theme for the song, Edit on a song, Duplicate, Delete and Restore), and the theme on
// the Library cards.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRun, openWorkspace } from "@lyric/db";
import { createSong, loadTheme, readRecipe, songPathsById } from "@lyric/video/node";
import { openTab } from "./stage-tabs";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-themes-"));
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
  const theme = (id: string) => readRecipe(songPathsById(ws, id).recipe!).theme;

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

    // The Library cards name each song's theme; the top menu has Themes.
    await page.goto(base);
    await page.waitForSelector("[data-card-theme]");
    const cardThemes = await page.$$eval("[data-card-theme]", (e: Element[]) => e.map((x) => x.getAttribute("data-card-theme")));
    check(cardThemes.length === 2 && cardThemes.every((t: string | null) => t === "Life Lyrics"), `each Library card names its theme (${cardThemes.join(", ")})`);
    const nav = await page.$$eval("header nav a", (e: Element[]) => e.map((x) => x.textContent));
    check(JSON.stringify(nav) === JSON.stringify(["Library", "Themes", "Collections", "Releases"]), `the top menu: ${nav.join(" · ")}`);
    await page.click("header nav a:has-text('Themes')");
    await page.waitForSelector("[data-themes-tile]");
    check((await page.$$("[data-themes-tile]")).length === 1, "the gallery: the brand's theme");
    check(((await page.textContent("[data-themes-tile='Life Lyrics']")) ?? "").includes("2 songs") && ((await page.textContent("[data-themes-tile='Life Lyrics']")) ?? "").includes("Your lyric line here"), "a tile: the theme on neutral sample words (not a song's), with how many songs use it");
    await page.hover("[data-themes-tile='Life Lyrics']");
    await page.waitForSelector("[data-themes-tile='Life Lyrics'] .__remotion-player", { timeout: 10_000 }).catch(() => {});
    check(!!(await page.$("[data-themes-tile='Life Lyrics'] .__remotion-player")), "pointing at a tile plays it");

    // + New theme: named first, from another theme.
    check(!!(await page.$("[data-themes-grid] > [data-themes-new-tile]:first-child")), "the first tile is New theme");
    await page.click("[data-themes-new-tile]");
    await page.fill("[data-themes-new-name]", "Night Drive");
    await page.click("[data-themes-new-create]");
    await page.waitForSelector("[data-theme-detail='Night Drive']");
    check(loadTheme(wsDir, "Night Drive").look.verseFont === loadTheme(wsDir, "Life Lyrics").look.verseFont, "+ New theme: a copy of Life Lyrics named Night Drive, its detail view opens");
    check(((await page.textContent("[data-theme-detail-songs]")) ?? "").includes("Not used by a song yet"), "…not used by a song yet");
    await page.fill("[data-theme-detail-author]", "Paul");
    await page.click("[data-theme-detail-description]");
    for (let i = 0; i < 20 && loadTheme(wsDir, "Night Drive").author !== "Paul"; i++) await sleep(150);
    check(loadTheme(wsDir, "Night Drive").author === "Paul", "Designer: saved in theme.json (the credit for themes you buy or sell)");
    check(!!(await page.$("[data-theme-detail-like] [data-themes-tile='Life Lyrics']")), "More like this: Life Lyrics");
    // Use this theme for a song.
    await page.selectOption("[data-theme-detail-song]", ids[1]);
    await page.click("[data-theme-detail-use]");
    await page.waitForSelector("[data-theme-detail-notice]");
    check(theme(ids[1]) === "Night Drive" && theme(ids[0]) === "Life Lyrics", "Use this theme for the song: Let Go uses Night Drive, Hold On keeps Life Lyrics");
    check(((await page.textContent("[data-theme-detail-songs]")) ?? "").includes("Let Go"), "…and the detail view lists it");
    check(((await page.textContent("[data-theme-detail-kind]")) ?? "") === "Theme" && ((await page.getAttribute("[data-theme-detail-rename]", "aria-label")) ?? "") === "Rename the theme", "the detail view says Theme above the name; its pencil renames the theme");
    // Theme cover: none = a neutral backdrop (no song picture); set one, it shows; Remove puts it aside.
    check(!(await page.$("[data-theme-cover]")) && !(await page.$("[data-themes-tile] [data-tile-frame]")), "Theme cover: none yet, and no tile borrows a song's picture");
    const coverPic = path.join(root, "night cover.jpg");
    ffmpeg("-f", "lavfi", "-i", "color=c=navy:s=360x640", "-frames:v", "1", coverPic);
    await page.setInputFiles("[data-theme-cover-file]", coverPic);
    await page.waitForSelector("[data-theme-cover]", { timeout: 10_000 }).catch(() => {});
    const coverOk = await page.waitForFunction(() => ((document.querySelector("[data-theme-cover]") as HTMLImageElement | null)?.naturalWidth ?? 0) > 0, null, { timeout: 10_000 }).then(() => true).catch(() => false);
    check(coverOk && existsSync(path.join(wsDir, "themes", "Night Drive", "cover.jpg")), "Set theme cover…: the picture is kept in the theme folder and shown");
    await page.click("[data-theme-cover-remove]");
    await page.waitForFunction(() => !document.querySelector("[data-theme-cover]"), null, { timeout: 10_000 }).catch(() => {});
    check(!existsSync(path.join(wsDir, "themes", "Night Drive", "cover.jpg")) && existsSync(path.join(wsDir, "themes", "Night Drive", "_replaced")), "Remove: back to the neutral backdrop, the picture kept in _replaced");
    await page.keyboard.press("Escape");
    await page.click("[data-theme-detail] [aria-label=Close]");
    // Filters.
    await page.click("[data-theme-filter=unused]");
    check((await page.$$("[data-themes-tile]")).length === 0, "Not used yet: none");
    await page.click("[data-theme-filter=all]");
    // Duplicate, Delete, Restore.
    await page.click("[data-themes-grid] [data-themes-tile='Night Drive']");
    await page.waitForSelector("[data-theme-detail='Night Drive']");
    await page.click("[data-theme-detail-duplicate]");
    await page.waitForSelector("[data-themes-grid] [data-themes-tile='Night Drive copy']");
    check(true, "Duplicate: Night Drive copy");
    check(await page.$eval("[data-theme-detail-delete]", (b: HTMLButtonElement) => b.disabled), "Delete is off for a theme a song uses");
    await page.click("[data-theme-detail] [aria-label=Close]");
    await page.click("[data-themes-grid] [data-themes-tile='Night Drive copy']");
    await page.click("[data-theme-detail-delete]");
    await page.waitForSelector("[data-themes-removed]");
    check(!(await page.$("[data-themes-grid] [data-themes-tile='Night Drive copy']")), "Delete: gone from the gallery (themes\\_removed\\)");
    await page.click("[data-themes-removed] button[aria-expanded]");
    await page.click("[data-themes-restore='Night Drive copy']");
    await page.waitForSelector("[data-themes-grid] [data-themes-tile='Night Drive copy']");
    check(true, "Restore: back in the gallery");
    // Edit: the theme editor on a song (Shape → Theme), that theme open.
    await page.click("[data-themes-grid] [data-themes-tile='Night Drive copy']");
    await page.click("[data-theme-detail-edit]");
    await page.waitForSelector("[data-theme-editing='Night Drive copy']");
    check(((await page.textContent("[data-theme-editing]")) ?? "").includes("(shown on this song)"), "Edit opens the theme editor on a song, the theme shown on it");
    await page.click("[data-effect-picker]");
    await page.click("[data-try-effect=ink]");
    await page.click("[data-theme-save]");
    await page.waitForSelector("[data-theme-editors]", { state: "detached" });
    check(loadTheme(wsDir, "Night Drive copy").look.verseEffect === "ink" && theme(ids[0]) === "Life Lyrics" && loadTheme(wsDir, "Life Lyrics").look.verseEffect !== "ink", "Save edits that theme; the song keeps its own");
    // Make → Generate: the theme for this run and Compare themes (one run per theme, the same choices).
    await page.goto(`${base}/songs/${ids[0]}`);
    await page.waitForSelector("[data-stages]");
    await openTab(page, "Generate");
    await page.waitForSelector("[data-compare-themes]");
    await page.check("[data-theme-option='Life Lyrics']");
    await page.check("[data-theme-option='Night Drive']");
    check(await page.$eval("[data-generate-theme]", (s: HTMLSelectElement) => s.disabled), "Compare themes: the single theme choice steps aside");
    await page.click("[data-generate] button[type=submit]");
    await page.waitForSelector("[data-generate] [role=status], [data-generate] .text-emerald-300, [data-generate] p:has-text('Queued')", { timeout: 15_000 }).catch(() => {});
    const runs = ws.db.select().from(makeRun).all().map((r) => ({ label: r.label, theme: (r.options_json as { theme?: string }).theme }));
    check(runs.length === 2 && runs.some((r) => r.theme === "Life Lyrics" && r.label.includes("theme Life Lyrics")) && runs.some((r) => r.theme === "Night Drive"), `Compare themes: one run per theme (${JSON.stringify(runs)})`);
    if (process.env.THEMES_SHOT) {
      await page.goto(`${base}/themes`);
      await page.waitForSelector("[data-themes-tile]");
      await page.screenshot({ path: process.env.THEMES_SHOT });
      await page.click("[data-themes-grid] [data-themes-tile='Night Drive']");
      await sleep(1200);
      await page.screenshot({ path: process.env.THEMES_SHOT.replace(".png", "-detail.png") });
    }
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
