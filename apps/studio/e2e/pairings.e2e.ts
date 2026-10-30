// Browser test of font pairings (needs a studio build, FFmpeg and Playwright, as the others):
//   pnpm test:e2e
// The Style tab's font pairings (Look block): a grid of compact cards (no horizontal scrolling), each pair
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
import { findOrCreateSongProject, loadBrand, loadFontCatalog, songPathsById } from "@lyric/video/node";
import { openTab } from "./stage-tabs";

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
  const brandBefore = readFileSync(brandFile, "utf8");

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
    await page.waitForSelector("[data-pairing=elegant]");
    const ids = await page.$$eval("[data-pairing]", (els: Element[]) => els.map((e) => e.getAttribute("data-pairing")));
    check(JSON.stringify(ids) === JSON.stringify(["brand", "elegant", "dramatic", "romantic-script", "literary", "typewriter-story", "vintage-romance", "bold-statement", "gentle"]), `9 pairing cards, the brand first (${ids.join(", ")})`);
    // A grid, no horizontal scrolling; compact cards (several per row).
    const grid = await page.$eval("[data-pairing-grid]", (g: HTMLElement) => ({ scroll: g.scrollWidth, client: g.clientWidth, cols: getComputedStyle(g).gridTemplateColumns.split(" ").length }));
    check(grid.scroll <= grid.client && grid.cols >= 3 && grid.cols <= 5, `the cards sit in a grid without horizontal scrolling (${grid.cols} per row, ${grid.scroll}/${grid.client} px)`);
    check((await page.$("[data-pairing-apply]")) === null && !((await page.textContent("[data-pairings]")) ?? "").includes("This song's fonts"), "no big 'This song' buttons");
    // Each card shows the pair together: this song's verse and hook lines.
    await page.waitForFunction(() => document.querySelector("[data-pairing=elegant]")?.textContent?.includes("You had a heart for two"));
    const elegant = (await page.textContent("[data-pairing=elegant] [data-pairing-choose]")) ?? "";
    check(elegant.includes("Where the river meets the light") && elegant.includes("You had a heart for two"), "the Elegant card shows the song's verse and hook lines together");
    check(elegant.includes("Elegant") && !elegant.includes("Cormorant Garamond 400"), "…and its name; the faces are not on the card itself");
    check(!!(await page.$("[data-pairing=elegant] [data-pairing-try]")), "the 'try this' suggestion stays");
    const isShown = (sel: string) => page.$eval(sel, (e: Element) => getComputedStyle(e).display !== "none" && getComputedStyle(e).opacity !== "0");
    check(!(await isShown("[data-pairing=elegant] [data-pairing-details]")) && !(await isShown("[data-pairing=elegant] [data-pairing-brand]")), "description, faces and 'Save to brand…' hidden until hover");
    await page.hover("[data-pairing=elegant] [data-pairing-choose]");
    await sleep(200);
    check(await isShown("[data-pairing=elegant] [data-pairing-details]"), "hover shows the description and faces");
    check(((await page.textContent("[data-pairing=elegant] [data-pairing-faces]")) ?? "") === "verse Cormorant Garamond 400 · hook Cormorant Garamond 600 italic", "with its exact faces");
    check(await isShown("[data-pairing=elegant] [data-pairing-brand]"), "…and the small 'Save to brand…' link");
    await page.waitForFunction(() => document.fonts.check('italic 600 40px "Cormorant Garamond"'), null, { timeout: 30_000 });
    check(true, "the exact italic 600 file is loaded for the preview (no synthetic italic)");
    check(!!(await page.$("[data-pairing=elegant] img[src*='/api/files/thumbs/']")), "over a frame of the song's clips");
    check(!!(await page.$("[data-pairing=brand][data-current] [data-pairing-check]")), "the brand pair is this song's now, with a ✓");
    check((await page.$$("[data-pairing-check]")).length === 1, "one ✓ only");
    // Warnings: none on the other cards (only a tiny muted "!"); the chosen pair's in plain words under the grid.
    check((await page.$$("[data-pairing] [data-pairing-warning]")).length === 0, "no warnings on the cards themselves");
    check(((await page.getAttribute("[data-pairing=romantic-script] [data-pairing-flag]", "title")) ?? "").includes("short hooks only"), "a non-chosen card has only a muted '!' with its warnings as tooltip (Romantic script: short hooks only)");
    const note = (await page.textContent("[data-pairing-note]")) ?? "";
    check(note.includes("Lyrics may be hard to read over bright clips like this one: the app adds a soft backing behind them") && !/\d\.\d:1/.test((await page.$$eval("[data-pairing-warning]", (e: Element[]) => e.map((x) => x.textContent).join(" "))) ?? ""), `the chosen pair's line in plain words, no ratios (${note.slice(0, 120)})`);
    check(!(await page.$eval("[data-pairing-note-details]", (d: HTMLDetailsElement) => d.open)), "the technical text is one click away (Details, closed)");
    await page.click("[data-pairing-note-details] summary");
    check(/low contrast over this frame: verse \d\.\d:1/.test((await page.textContent("[data-pairing-note-details]")) ?? ""), "…Details shows the contrast ratios");
    check((await page.$("[data-font-summary] [data-source]")) === null, "the font summary has no 'This song' badge yet (the brand's fonts)");
    await page.click("[data-fine-tune]"); // the six font rows and the own-fonts folder sit under Look → Fine-tune
    check(((await page.textContent("[data-user-fonts]")) ?? "").includes(path.join(wsDir, "fonts")), "the Style tab shows the folder for my own fonts");

    // Clicking a card chooses it: ✓, song.json gets the pair; brand.json is untouched.
    await page.click("[data-pairing=romantic-script] [data-pairing-choose]");
    await page.waitForSelector("[data-pairing=romantic-script][data-current] [data-pairing-check]");
    check((await page.$$("[data-pairing-check]")).length === 1 && !(await page.$("[data-pairing=brand][data-current]")), "the ✓ moves to the clicked card");
    const plain = await page.$$eval("[data-pairing-warning]", (e: Element[]) => e.map((x) => x.textContent ?? ""));
    check(plain.length === 2 && plain[0].includes("Great Vibes is a thin script: short hooks only") && plain[1].includes("the app adds a soft backing"), `the chosen pair's lines in plain words: its advice, then readability (${plain.join(" | ")})`);
    check((await page.$("[data-pairing=romantic-script] [data-pairing-flag]")) === null && !!(await page.$("[data-pairing=elegant] [data-pairing-flag]")), "the chosen card has no '!'; the others keep theirs");
    check(await isShown("[data-pairing=romantic-script] [data-pairing-brand]"), "'Save to brand…' shows on the chosen card");
    await page.click("[data-pairing=elegant] [data-pairing-choose]");
    await page.waitForSelector("[data-pairing=elegant][data-current]");
    const recipe = JSON.parse(readFileSync(paths.recipe!, "utf8")) as Record<string, unknown>;
    check(recipe.verseFont === "Cormorant Garamond" && recipe.hookWeight === 600 && recipe.hookItalic === true && recipe.verseWeight === 400, `song.json holds the pair (${JSON.stringify(recipe)})`);
    check(readFileSync(brandFile, "utf8") === brandBefore, "brand.json is untouched");
    await page.waitForFunction(() => document.querySelector("[data-font-summary-text]")?.textContent?.includes("Cormorant Garamond 600 italic"));
    check((await page.textContent("[data-font-summary-text]")) === "Fonts: verses Cormorant Garamond 400 · choruses Cormorant Garamond 600 italic", `the font summary line follows (${await page.textContent("[data-font-summary-text]")})`);
    check((await page.textContent("[data-font-summary] [data-source]")) === "This song", "…with the 'This song' badge");
    // The weight / italic controls follow, with only the family's weights.
    await page.waitForFunction(() => (document.querySelector("[data-edit='hookWeight-default']") as HTMLSelectElement | null)?.value === "600");
    const weights = await page.$$eval("[data-edit='hookWeight-default'] option", (os: HTMLOptionElement[]) => os.map((o) => o.value));
    check(JSON.stringify(weights) === JSON.stringify(["300", "400", "500", "600", "700"]), `hook weight offers Cormorant's own weights (${weights.join(", ")})`);
    check(await page.$eval("[data-edit='hookItalic-default']", (c: HTMLInputElement) => c.checked), "hook italic is ticked");
    check((await page.getAttribute("[data-preview='hookFont-default']", "style"))?.includes("italic") ?? false, "the per-font preview shows the italic");
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "pairings.png"), fullPage: false });

    // One big Look preview: sticky beside the choices on a wide screen, the song's fonts, over the clip's
    // (bright, cream) frame with the soft backing the render adds there; a hovered card is tried in it.
    check((await page.$$("[data-look-preview]")).length === 1, "one big Look preview");
    check((await page.$eval("[data-look-preview]", (e: Element) => getComputedStyle(e).position)) === "sticky", "…sticky on a wide screen");
    const lookBox = await page.$eval("[data-look-preview]", (e: Element) => e.getBoundingClientRect().width);
    check(lookBox >= 300 && lookBox <= 360, `…about 300-360 px wide (${Math.round(lookBox)} px)`);
    check(!!(await page.$("[data-look-preview] img[src*='/api/files/thumbs/']")), "…over the same frame of the song's clip as the cards");
    check((await page.getAttribute("[data-look-preview]", "data-backing")) === "1" && !!(await page.$("[data-look-preview] [data-lyric-backing]")), "…with the soft backing over the bright frame (readability auto, as the render)");
    check((await page.getAttribute("[data-look-preview]", "data-hook-face")) === "Cormorant Garamond 600 italic", `…in the song's hook face (${await page.getAttribute("[data-look-preview]", "data-hook-face")})`);
    await page.hover("[data-pairing=dramatic] [data-pairing-choose]");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-hook-family") === "Playfair Display");
    check((await page.getAttribute("[data-look-preview]", "data-previewing-pair")) === "dramatic", "hovering a card tries its pair in the big preview (Playfair Display hook)");
    check(JSON.parse(readFileSync(paths.recipe!, "utf8")).hookFont === "Cormorant Garamond", "…without saving it");
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-hook-family") === "Cormorant Garamond");
    check(!(await page.getAttribute("[data-look-preview]", "data-previewing-pair")), "leaving the card restores the song's fonts");
    // The screenshot: the Look block scrolled to its middle, the preview still on screen (sticky).
    await page.$eval("[data-style-block=look]", (e: Element) => {
      const main = document.querySelector("main")!;
      const r = e.getBoundingClientRect();
      main.scrollTop += r.top + r.height / 2 - main.clientHeight / 2;
    });
    await sleep(1500);
    const inView = await page.$eval("[data-look-preview]", (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    check(inView, "scrolled to the middle of the Look block, the preview is still fully on screen");
    if (process.env.U2_SHOT) await page.screenshot({ path: process.env.U2_SHOT });
    await page.$eval("main", (m: Element) => (m.scrollTop = 0));
    // A narrow screen: the preview on top of the choices, not sticky.
    await page.setViewportSize({ width: 800, height: 1100 });
    await sleep(300);
    const narrow = await page.evaluate(() => ({
      position: getComputedStyle(document.querySelector("[data-look-preview]")!).position,
      above: document.querySelector("[data-look-preview]")!.getBoundingClientRect().bottom <= document.querySelector("[data-pairings]")!.getBoundingClientRect().top,
    }));
    check(narrow.position !== "sticky" && narrow.above, `narrow screen: the preview on top, not sticky (${JSON.stringify(narrow)})`);
    await page.setViewportSize({ width: 1440, height: 1100 });
    if (process.env.LOOK_SHOT) {
      await page.setViewportSize({ width: 1440, height: 2400 });
      await page.mouse.move(0, 0);
      await page.$eval("[data-style-block=look]", (e: Element) => e.scrollIntoView());
      await sleep(800);
      await (await page.$("[data-style-block=look]")).screenshot({ path: process.env.LOOK_SHOT });
      await page.setViewportSize({ width: 1440, height: 1100 });
    }

    // "Save to brand" asks first, then writes brand.json.
    await page.hover("[data-pairing=dramatic] [data-pairing-choose]");
    await page.click("[data-pairing=dramatic] [data-pairing-brand]");
    check(readFileSync(brandFile, "utf8") === brandBefore, "Save to brand only asks first");
    await page.click("[data-pairing=dramatic] [data-pairing-brand-confirm]");
    await page.waitForFunction(() => document.querySelector("[data-pairings] [role=status]")?.textContent?.includes("saved to the brand"));
    const brand = JSON.parse(readFileSync(brandFile, "utf8")) as { hookFont: { family: string; italic: boolean } };
    check(brand.hookFont.family === "Playfair Display" && brand.hookFont.italic === true, "brand.json now has the Dramatic pair");
    await (await page.$("[data-pairing=elegant]")).screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "pairing-card.png") });

    // Generate: compare pairings.
    await openTab(page, "Generate");
    await page.waitForSelector("[data-compare-pairings]");
    await page.check("[data-pairing-option=elegant]");
    await page.check("[data-pairing-option=dramatic]");
    await page.check("[data-pairing-option=gentle]");
    check(await page.$eval("[data-pairing-option=literary]", (c: HTMLInputElement) => c.disabled), "Generate: at most 3 pairings to compare");
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
