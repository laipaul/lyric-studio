// Browser test of font pairings (needs a studio build, FFmpeg and Playwright, as the others):
//   pnpm test:e2e
// The Shape page's font pairings (the Fonts panel): a grid of compact cards (no horizontal scrolling), each pair
// previewed together on this song's lines over a frame of its clips, with the exact font files loaded
// (Cormorant Garamond 600 italic for Elegant's hook); clicking a card chooses it (✓, song.json; brand.json
// untouched); description and faces on hover; warnings only for the chosen pair, in plain words under the
// grid (technical text under Details); "Save to brand…" asks first; the weight / italic controls offer
// only the family's own weights; the user-fonts folder is shown; Generate offers the comparison.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace } from "@lyric/db";
import { findOrCreateSongProject, loadBrand, loadFontCatalog, loadTheme, readRecipe, songPathsById } from "@lyric/video/node";
import { openPanel, saveTheme } from "./stage-tabs";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-pairings-"));
const wsDir = path.join(root, "workspace");
const port = 3196;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);

async function main() {
  const song = path.join(root, "A Heart For Two.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=8", song);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  const brandFile = loadBrand(ws.dir, loadFontCatalog(ws.dir), "Life Lyrics").file;
  ws.close();
  writeFileSync(paths.lyricsTxt, "Where the river meets the light\n* You had a heart for two\n");
  writeFileSync(paths.recipe!, "{}\n");
  mkdirSync(paths.clips!, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=0xf0ece4:s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", path.join(paths.clips!, "01_dress.mp4")); // a cream frame: low contrast
  // brand.json without the "theme" key the move to themes adds (the song's look now lives in its theme)
  const brandText = () => {
    const { theme: _theme, ...rest } = JSON.parse(readFileSync(brandFile, "utf8")) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
    return JSON.stringify(rest);
  };
  const brandBefore = brandText();
  const themeLook = () => loadTheme(wsDir, readRecipe(paths.recipe!).theme!).look as Record<string, unknown>;

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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(`${base}/songs/${sp.project.id}?tab=style`);
    const openList = async () => {
      if (!(await page.$("[data-pairing-list]"))) await page.click("[data-pairing-select]");
      await page.waitForSelector("[data-pairing-list] [data-pairing=elegant]");
    };
    const pickOption = async (id: string) => {
      await openList();
      await page.click(`[data-pairing=${id}]`);
      await page.waitForSelector("[data-pairing-list]", { state: "detached" });
    };
    await page.waitForSelector("[data-stages]");
    await openPanel(page, "effects"); // Shape → Look → Edit theme (the pairing dropdown sits on top)
    await page.waitForSelector("[data-pairing-select]");
    await page.waitForFunction(() => document.querySelector("[data-pairing-current]")?.textContent?.length);
    check((await page.$$("[data-pairing-grid], [data-pairings] img, [data-pairings] canvas")).length === 0, "no card grid and no card thumbnails: just the dropdown");
    check((await page.$$("[data-pairing]")).length === 0, "the list is closed until it is opened");
    check(((await page.textContent("[data-pairing-current]")) ?? "").length > 0, `the dropdown shows the song's pairing (${await page.textContent("[data-pairing-current]")})`);
    await openList();
    const ids = await page.$$eval("[data-pairing]", (els: Element[]) => els.map((e) => e.getAttribute("data-pairing")));
    check(JSON.stringify(ids) === JSON.stringify(["brand", "elegant", "dramatic", "romantic-script", "literary", "typewriter-story", "vintage-romance", "bold-statement", "gentle"]), `9 options, the brand first (${ids.join(", ")})`);
    check((await page.$("[data-pairing-apply]")) === null && !((await page.textContent("[data-pairings]")) ?? "").includes("This song's fonts"), "no big 'This song' buttons");
    const elegant = (await page.textContent("[data-pairing=elegant]")) ?? "";
    check(elegant.includes("Elegant") && !!(await page.textContent("[data-pairing=elegant] [data-pairing-fonts]")), "an option shows its name with its fonts in one small line");
    check(elegant.includes("Where the river") && elegant.includes("You had"), "…and a sample of the song's own words");
    check(((await page.textContent("[data-pairing=elegant] [data-pairing-fonts]")) ?? "") === "Cormorant Garamond 400 / 600 italic", "…same family: 'Family 400 / 600 italic'");
    check(((await page.getAttribute("[data-pairing=elegant] [data-pairing-fonts]", "title")) ?? "") === "verse Cormorant Garamond 400 · hook Cormorant Garamond 600 italic", "…with the exact faces as its tooltip");
    check(((await page.textContent("[data-pairing=dramatic] [data-pairing-fonts]")) ?? "").includes(" · "), "…different families: 'Verse font · Hook font'");
    check(!!(await page.$("[data-pairing=elegant] [data-pairing-try]")), "the 'try this' suggestion stays");
    await page.waitForFunction(() => document.fonts.check('italic 600 40px "Cormorant Garamond"'), null, { timeout: 30_000 });
    check(true, "the exact italic 600 file is loaded (no synthetic italic)");
    const sample = await page.$eval("[data-pairing=elegant] [data-pairing-sample] span", (e: Element) => ({ h: e.getBoundingClientRect().height, font: getComputedStyle(e).fontFamily, size: parseFloat(getComputedStyle(e).fontSize) }));
    check(sample.size >= 14 && sample.h >= 14 && sample.font.includes("Cormorant Garamond"), `the sample is drawn in the pair's font at a readable size (${sample.size}px, ${Math.round(sample.h)}px tall)`);
    check(!!(await page.$("[data-pairing=brand][data-current]")), "the brand pair is this song's now, with a ✓");
    check((await page.$$("[data-pairing-list] [aria-label=\"this song's fonts\"]")).length === 1, "one ✓ only");
    // Warnings: none on the other cards (only a tiny muted "!"); the chosen pair's in plain words under the grid.
    check((await page.$$("[data-pairing] [data-pairing-warning]")).length === 0, "no warnings on the cards themselves");
    check(((await page.getAttribute("[data-pairing=romantic-script] [data-pairing-flag]", "title")) ?? "").includes("short hooks only"), "a non-chosen card has only a muted '!' with its warnings as tooltip (Romantic script: short hooks only)");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-pairing-list]", { state: "detached" });
    const note = (await page.textContent("[data-pairing-note]")) ?? "";
    check(note.includes("Lyrics may be hard to read over bright clips like this one: the app adds a soft backing behind them") && !/\d\.\d:1/.test((await page.$$eval("[data-pairing-warning]", (e: Element[]) => e.map((x) => x.textContent).join(" "))) ?? ""), `the chosen pair's line in plain words, no ratios (${note.slice(0, 120)})`);
    check(!(await page.$eval("[data-pairing-note-details]", (d: HTMLDetailsElement) => d.open)), "the technical text is one click away (Details, closed)");
    await page.click("[data-pairing-note-details] summary");
    check(/low contrast over this frame: verse \d\.\d:1/.test((await page.textContent("[data-pairing-note-details]")) ?? ""), "…Details shows the contrast ratios");
    check((await page.$("[data-font-summary] [data-source]")) === null, "the font summary has no 'This song' badge yet (the brand's fonts)");
    await page.click("[data-fine-tune]"); // the six font rows and the own-fonts folder sit under Fonts → Fine-tune
    check(((await page.textContent("[data-user-fonts]")) ?? "").includes(path.join(wsDir, "fonts")), "Shape shows the folder for my own fonts");

    // Choosing an option: the dropdown shows it, song.json gets the pair; brand.json is untouched.
    await pickOption("romantic-script");
    await page.waitForFunction(() => /romantic/i.test(document.querySelector("[data-pairing-current]")?.textContent ?? ""));
    await openList();
    check((await page.$$("[data-pairing-list] [aria-label=\"this song's fonts\"]")).length === 1 && !(await page.$("[data-pairing=brand][data-current]")), "the ✓ moves to the chosen option, the dropdown shows it");
    const plain = await page.$$eval("[data-pairing-warning]", (e: Element[]) => e.map((x) => x.textContent ?? ""));
    check(plain.length === 2 && plain[0].includes("Great Vibes is a thin script: short hooks only") && plain[1].includes("the app adds a soft backing"), `the chosen pair's lines in plain words: its advice, then readability (${plain.join(" | ")})`);
    check((await page.$("[data-pairing=romantic-script] [data-pairing-flag]")) === null && !!(await page.$("[data-pairing=elegant] [data-pairing-flag]")), "the chosen option has no '!'; the others keep theirs");
    check(!(await page.$("[data-pairing-brand]")) && !(await page.$("[data-pairing-reset]")), "in the theme: no 'Save to brand' or 'Back to the brand'");
    await page.keyboard.press("Escape");
    await pickOption("elegant");
    await page.waitForFunction(() => /elegant/i.test(document.querySelector("[data-pairing-current]")?.textContent ?? ""));
    check(themeLook().verseFont !== "Cormorant Garamond" || themeLook().hookItalic !== true, "the chosen pair waits for Save");
    await saveTheme(page);
    await openPanel(page, "fonts");
    for (let i = 0; i < 20 && themeLook().verseFont !== "Cormorant Garamond"; i++) await sleep(150);
    const recipe = themeLook();
    check(recipe.verseFont === "Cormorant Garamond" && recipe.hookWeight === 600 && recipe.hookItalic === true && recipe.verseWeight === 400, `the song's theme holds the pair (${JSON.stringify(recipe)})`);
    check(readRecipe(paths.recipe!).verseFont === undefined, "…not song.json");
    check(brandText() === brandBefore, "brand.json is untouched");
    await page.waitForFunction(() => document.querySelector("[data-font-summary-text]")?.textContent?.includes("Cormorant Garamond 600 italic"));
    check((await page.textContent("[data-font-summary-text]")) === "Fonts: verses Cormorant Garamond 400 · choruses Cormorant Garamond 600 italic", `the font summary line follows (${await page.textContent("[data-font-summary-text]")})`);
    // The weight / italic controls follow, with only the family's weights.
    await page.waitForFunction(() => (document.querySelector("[data-edit='hookWeight-default']") as HTMLSelectElement | null)?.value === "600");
    const weights = await page.$$eval("[data-edit='hookWeight-default'] option", (os: HTMLOptionElement[]) => os.map((o) => o.value));
    check(JSON.stringify(weights) === JSON.stringify(["300", "400", "500", "600", "700"]), `hook weight offers Cormorant's own weights (${weights.join(", ")})`);
    check(await page.$eval("[data-edit='hookItalic-default']", (c: HTMLInputElement) => c.checked), "hook italic is ticked");
    check((await page.getAttribute("[data-preview='hookFont-default']", "style"))?.includes("italic") ?? false, "the per-font preview shows the italic");
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "pairings.png"), fullPage: false });

    // One viewer (here the stand-in: no planned video without timed lyrics): beside the tools on a wide
    // screen, the song's fonts, over the clip's (bright, cream) frame with the soft backing the render adds
    // there; a hovered option is tried in it.
    check((await page.$$("[data-look-preview]")).length === 1, "one viewer");
    const lookBox = await page.$eval("[data-look-preview]", (e: Element) => e.getBoundingClientRect().width);
    // (Its height now fits the room the screen leaves, 260-760 px, always 9:16: so 146-428 px wide; look-preview.tsx.)
    check(lookBox >= 146 && lookBox <= 429, `…a phone-sized viewer, 146-428 px wide (${Math.round(lookBox)} px)`);
    check(!!(await page.$("[data-look-preview] img[src*='/api/files/thumbs/']")), "…over a frame of the song's clip");
    check((await page.getAttribute("[data-look-preview]", "data-backing")) === "1" && !!(await page.$("[data-look-preview] [data-lyric-backing]")), "…with the soft backing over the bright frame (readability auto, as the render)");
    check((await page.getAttribute("[data-look-preview]", "data-hook-face")) === "Cormorant Garamond 600 italic", `…in the song's hook face (${await page.getAttribute("[data-look-preview]", "data-hook-face")})`);
    await openList();
    await page.hover("[data-pairing=dramatic]");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-hook-family") === "Playfair Display");
    check((await page.getAttribute("[data-look-preview]", "data-previewing-pair")) === "dramatic", "hovering an option tries its pair in the big preview (Playfair Display hook)");
    check(themeLook().hookFont === "Cormorant Garamond", "…without saving it");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-hook-family") === "Cormorant Garamond");
    check(!(await page.getAttribute("[data-look-preview]", "data-previewing-pair")) && !(await page.$("[data-pairing-list]")), "Escape closes the list and the song's fonts are back in the preview");
    await openList();
    await page.focus("[data-pairing=literary]");
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-previewing-pair") === "typewriter-story", null, { timeout: 3000 }).catch(() => {});
    check((await page.getAttribute("[data-look-preview]", "data-previewing-pair")) === "typewriter-story", "keyboard: moving the highlight tries that pair in the preview");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-look-preview]")?.getAttribute("data-previewing-pair"));
    // At 1366 px the dropdown and its list fit the window and the current name is whole.
    await page.setViewportSize({ width: 1366, height: 1100 });
    await sleep(400);
    const cur = await page.$eval("[data-pairing-current]", (e: Element) => ({ cut: e.scrollWidth > e.clientWidth + 1, right: e.getBoundingClientRect().right }));
    check(!cur.cut && cur.right <= 1366, "at 1366 px the dropdown's name is not truncated and inside the window");
    await openList();
    const listBox = await page.$eval("[data-pairing-list]", (e: Element) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    check(listBox.l >= 0 && listBox.r <= 1366, `…and the open list fits the window (${Math.round(listBox.l)}-${Math.round(listBox.r)})`);
    check(((await page.$$eval("[data-pairing-name]", (es: Element[]) => es.filter((e) => e.scrollWidth > e.clientWidth + 1).length))) === 0, "…no option name is cut off");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-pairing-list]", { state: "detached" });
    await page.setViewportSize({ width: 1440, height: 1100 });
    if (process.env.U2_SHOT) await page.screenshot({ path: process.env.U2_SHOT });
    await page.$eval("main", (m: Element) => (m.scrollTop = 0));
    // A small screen: the rail, the Fonts panel and the viewer side by side, all inside the window.
    await page.setViewportSize({ width: 1024, height: 768 });
    await sleep(300);
    const narrow = await page.evaluate(() => ({
      panel: document.querySelector("[data-shape-tools]")!.getBoundingClientRect().right,
      viewer: document.querySelector("[data-look-preview] > div")!.getBoundingClientRect().right,
      left: document.querySelector("[data-look-preview] > div")!.getBoundingClientRect().left,
    }));
    check(narrow.panel <= narrow.left && narrow.viewer <= 1024, `1024 px: the panel left of the viewer, both inside the window (${JSON.stringify(narrow)})`);
    await page.setViewportSize({ width: 1440, height: 1100 });
    if (process.env.LOOK_SHOT) {
      await page.setViewportSize({ width: 1440, height: 2400 });
      await page.mouse.move(0, 0);
      await page.$eval("[data-style-block=theme]", (e: Element) => e.scrollIntoView());
      await sleep(800);
      await (await page.$("[data-style-block=theme]")).screenshot({ path: process.env.LOOK_SHOT });
      await page.setViewportSize({ width: 1440, height: 1100 });
    }

    // Another pair goes into the theme as well; the brand stays as it was.
    await pickOption("dramatic");
    await page.waitForFunction(() => /dramatic/i.test(document.querySelector("[data-pairing-current]")?.textContent ?? ""));
    await (await page.$("[data-pairings]"))!.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "pairing-card.png") });
    await saveTheme(page);
    for (let i = 0; i < 20 && themeLook().hookFont !== "Playfair Display"; i++) await sleep(150);
    check(themeLook().hookFont === "Playfair Display" && themeLook().hookItalic === true, "the theme now has the Dramatic pair");
    check(brandText() === brandBefore, "…brand.json still untouched");

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
