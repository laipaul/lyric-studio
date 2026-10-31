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
import { menuItem, openTab } from "./stage-tabs";

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
    await openTab(page, "Style");
    // The effect settings are set in Set effect; their own rows (lock, per platform) under its ⋯ → Per platform.
    await menuItem(page, "effects", "data-effects-per-platform");
    await page.waitForSelector("[data-field=hookEffect]");

    // Polish: wide "videos per platform" inputs with the preset's number; the empty-platforms note.
    check((await page.getAttribute("[data-field=variations] input", "placeholder")) === "3 (preset)", 'videos per platform placeholder "3 (preset)" (Reels)');
    check(!!(await page.$("[data-platforms-empty]")), "empty platforms: the note says Generate starts with Reels + YouTube");

    // The bug: type a length, then click the padlock straight away.
    await menuItem(page, "length", 'data-per-platform="length"');
    await page.fill("[data-edit='length-reels']", "90");
    await menuItem(page, "hookEffect", 'data-lock="hookEffect"');
    check(!!(await page.$("[data-locked=hookEffect]")), "the padlock shows locked at once");
    await page.waitForSelector("[data-saving=saved]");
    check(!!(await page.$("[data-locked=hookEffect]")), "the padlock still shows locked after saving");
    await page.click("[data-part=hook]");
    await page.waitForSelector("[data-effect-part=hook]");
    check(await page.$eval("[data-try-effect=glide]", (b: HTMLButtonElement) => b.disabled), "Set effect: a locked chorus effect cannot be changed (chips greyed out)");
    await page.click("[data-part=verse]");
    const recipe = JSON.parse(readFileSync(paths.recipe!, "utf8")) as { locked?: string[]; perPlatform?: { reels?: { length?: number } } };
    check(!!recipe.locked?.includes("hookEffect"), 'song.json holds "locked": ["hookEffect"]');
    check(recipe.perPlatform?.reels?.length === 90, "song.json holds the Reels length typed just before (90)");
    // Ending (Reels, TikTok, Shorts): auto by default, the song may ask for one.
    check((await page.$eval("[data-edit='ending-default']", (e: Element) => (e as HTMLSelectElement).value)) === "auto", "Ending: auto by default (the app chooses)");
    await page.selectOption("[data-edit='ending-default']", "fade");
    await page.waitForSelector("[data-saving=saved]");
    await sleep(300);
    check((JSON.parse(readFileSync(paths.recipe!, "utf8")) as { ending?: string }).ending === "fade", 'song.json holds "ending": "fade"');
    await page.selectOption("[data-edit='ending-default']", "auto");
    await page.waitForSelector("[data-saving=saved]");
    await sleep(300);
    check((JSON.parse(readFileSync(paths.recipe!, "utf8")) as { ending?: string }).ending === undefined, "back to auto: the song's own ending setting is gone");
    // Title opening (Step D): off by default; on = title, artist and tagline before the first hook.
    check((await page.$eval("[data-edit='titleOpening-default']", (e: Element) => (e as HTMLSelectElement).value)) === "off", "Title opening: off by default");
    await page.selectOption("[data-edit='titleOpening-default']", "on");
    await page.waitForSelector("[data-saving=saved]");
    await sleep(300);
    check((JSON.parse(readFileSync(paths.recipe!, "utf8")) as { titleOpening?: string }).titleOpening === "on", 'song.json holds "titleOpening": "on"');
    await page.selectOption("[data-edit='titleOpening-default']", "off");
    await page.waitForSelector("[data-saving=saved]");
    await sleep(300);
    check((JSON.parse(readFileSync(paths.recipe!, "utf8")) as { titleOpening?: string }).titleOpening === undefined, "back to off: the song's own title opening setting is gone");
    // The tagline lives on the Assets tab (song.json "tagline").
    await openTab(page, "Assets");
    await page.waitForSelector("[data-tagline-input]");
    await page.fill("[data-tagline-input]", "A song for the road");
    await page.press("[data-tagline-input]", "Enter");
    await sleep(800);
    check((JSON.parse(readFileSync(paths.recipe!, "utf8")) as { tagline?: string }).tagline === "A song for the road", 'Assets: the tagline is saved in song.json');
    await page.fill("[data-tagline-input]", "");
    await page.press("[data-tagline-input]", "Enter");
    await sleep(800);
    check((JSON.parse(readFileSync(paths.recipe!, "utf8")) as { tagline?: string }).tagline === undefined, "Assets: an empty tagline removes it");
    await openTab(page, "Style");
    await page.waitForSelector("[data-edit='ending-default']");

    await openTab(page, "Generate");
    await page.waitForSelector("[aria-label='Hook effect']");
    check(await page.$eval("[aria-label='Hook effect']", (s: HTMLSelectElement) => (s).disabled), "Generate: Hook effect is locked (greyed out)");
    check(await page.$eval("[aria-label='Verse effect']", (s: HTMLSelectElement) => !(s).disabled), "Generate: Verse effect can be changed");
    const chips = await page.$$eval("[data-platform-choice]", (e: Element[]) => e.filter((x) => x.className.includes("bg-brand")).map((x) => x.getAttribute("data-platform-choice")));
    check(JSON.stringify(chips) === JSON.stringify(["reels", "youtube"]), `Generate starts with Reels + YouTube (got ${(chips as string[]).join(", ")})`);
    check((await page.$eval("[aria-label='Verse effect'] option", (o: Element) => o.textContent)) === "From the recipe (glide)", 'the recipe option is short: "From the recipe (glide)"');
    check((await page.textContent("[data-per-platform-effects=verse]")) === "YouTube: cinematic-fade", 'per-platform effects on a line under the list ("YouTube: cinematic-fade")');

    // Unlock again.
    await openTab(page, "Style");
    if (!(await page.$("[data-field=hookEffect]"))) await menuItem(page, "effects", "data-effects-per-platform");
    await page.waitForSelector("[data-locked=hookEffect]");
    check((await page.getAttribute(`[data-row-menu="hookEffect"]`, "aria-label")) === "More for Hook effect", "the ⋯ menu names its setting");
    await menuItem(page, "hookEffect", 'data-lock="hookEffect"');
    await page.waitForSelector("[data-saving=saved]");
    await page.waitForFunction(() => !document.querySelector("[data-locked=hookEffect]"), null, { timeout: 5000 }).catch(() => {});
    check(!(await page.$("[data-locked=hookEffect]")), "unlocked: the padlock is gone");
    await openTab(page, "Generate");
    await page.waitForSelector("[aria-label='Hook effect']");
    // The page refreshes after the unlock: give it a moment before checking.
    await page.waitForFunction(() => !(document.querySelector("[aria-label='Hook effect']") as HTMLSelectElement | null)?.disabled, null, { timeout: 10_000 }).catch(() => {});
    check(await page.$eval("[aria-label='Hook effect']", (s: HTMLSelectElement) => !(s).disabled), "Generate: Hook effect can be changed again");

    // + New song: Instrumental -> an optional story.txt instead of lyrics.txt; song.json "instrumental".
    const instrumentalSong = path.join(root, "Tea With The Monk.wav");
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=8", instrumentalSong]);
    const storyFile = path.join(root, "story.txt");
    writeFileSync(storyFile, "There's a secret place\n\nTea with the monk\n");
    await page.goto(base);
    await page.click("button:has-text('New song')");
    await page.waitForSelector("input[name=lyrics][required]");
    await page.check("[data-instrumental]");
    check(!(await page.$("input[name=lyrics][required]")) && !!(await page.$("input[name=lyrics]")), "Instrumental: the lyrics field becomes an optional story");
    check(!(await page.$("input[name=hints]")), "Instrumental: no tapped hints");
    await page.setInputFiles("input[name=song]", instrumentalSong);
    await page.setInputFiles("input[name=lyrics]", storyFile);
    await page.click("form button[type=submit]");
    await page.waitForSelector("text=Song added to your library.", { timeout: 60_000 }).catch(() => null);
    const ws2 = openWorkspace(wsDir);
    const added = ws2.db.select().from((await import("@lyric/db")).project).all().find((p) => p.title === "Tea With The Monk");
    const addedPaths = added ? songPathsById(ws2, added.id) : null;
    ws2.close();
    check(!!addedPaths?.instrumental, 'the new song is an instrumental (song.json "instrumental": true)');
    check(!!addedPaths && readFileSync(addedPaths.lyricsTxt, "utf8").includes("Tea with the monk") && addedPaths.lyricsTxt.endsWith("story.txt"), "its story is saved as story.txt");
    if (added) {
      await page.goto(`${base}/songs/${added.id}`);
      await openTab(page, "Assets");
      await page.waitForSelector("text=Story (instrumental)");
      check(((await page.textContent("body")) ?? "").includes("story.txt · 2 sentences, timed by the app"), "Assets: the story row says story.txt · 2 sentences");
    }
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
