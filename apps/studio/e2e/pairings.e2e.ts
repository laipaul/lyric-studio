// Browser test of font pairings (needs a studio build, FFmpeg and Playwright, as the others):
//   pnpm test:e2e
// The Style tab's Pairings row: each pair previewed together on this song's lines over a frame of its
// clips, with the exact font files loaded (Cormorant Garamond 600 italic for Elegant's hook); "This song"
// writes song.json and leaves brand.json alone; "Save to brand" asks first; the weight / italic controls
// offer only the family's own weights; the user-fonts folder is shown; Generate offers the comparison.
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
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", path.join(paths.clips!, "01_rings.mp4"));
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
    // Each card shows the pair together: this song's verse and hook lines.
    await page.waitForFunction(() => document.querySelector("[data-pairing=elegant]")?.textContent?.includes("You had a heart for two"));
    const elegant = (await page.textContent("[data-pairing=elegant]")) ?? "";
    check(elegant.includes("Where the river meets the light") && elegant.includes("You had a heart for two"), "the Elegant card shows the song's verse and hook lines together");
    check(elegant.includes("verse Cormorant Garamond 400 · hook Cormorant Garamond 600 italic"), "with its exact faces");
    await page.waitForFunction(() => document.fonts.check('italic 600 40px "Cormorant Garamond"'), null, { timeout: 30_000 });
    check(true, "the exact italic 600 file is loaded for the preview (no synthetic italic)");
    check(!!(await page.$("[data-pairing=elegant] img[src*='/api/files/thumbs/']")), "over a frame of the song's clips");
    check(((await page.textContent("[data-pairing=romantic-script]")) ?? "").includes("short hooks only"), "Romantic script warns: short hooks only");
    check(!!(await page.$("[data-pairing=brand][data-current]")), "the brand pair is this song's now");
    check((await page.$("[data-font-summary] [data-source]")) === null, "the font summary has no 'This song' badge yet (the brand's fonts)");
    await page.click("[data-fine-tune]"); // the six font rows and the own-fonts folder sit under Look → Fine-tune
    check(((await page.textContent("[data-user-fonts]")) ?? "").includes(path.join(wsDir, "fonts")), "the Style tab shows the folder for my own fonts");

    // "This song": song.json gets the pair; brand.json is untouched.
    await page.click("[data-pairing=elegant] [data-pairing-apply]");
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

    // "Save to brand" asks first, then writes brand.json.
    await page.click("[data-pairing=dramatic] [data-pairing-brand]");
    check(readFileSync(brandFile, "utf8") === brandBefore, "Save to brand only asks first");
    await page.click("[data-pairing=dramatic] [data-pairing-brand-confirm]");
    await page.waitForFunction(() => document.querySelector("[data-pairings] [role=status]")?.textContent?.includes("saved to the brand"));
    const brand = JSON.parse(readFileSync(brandFile, "utf8")) as { hookFont: { family: string; italic: boolean } };
    check(brand.hookFont.family === "Playfair Display" && brand.hookFont.italic === true, "brand.json now has the Dramatic pair");
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "pairings.png"), fullPage: false });
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
