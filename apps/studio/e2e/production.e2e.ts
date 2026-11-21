// Browser test of G1 Prepare → Production (needs a studio build, FFmpeg and Playwright):
//   npx tsx apps/studio/e2e/production.e2e.ts
// The Production tab in Prepare; the cast picked from the shared library (searchable picker, chips with pictures,
// remove); the story bible saved (the earlier text in Replaced files); Copy Song brief puts the brief on the clipboard;
// Claude's answer pasted back: a shot list in a ```json block opens the shot list check and imports into the
// Storyboard, other text can become the bible; the shot list's characters not in the cast can be added.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { card as cardTable, openWorkspace } from "@lyric/db";
import { createSong, readRecipe, songPathsById, writeRecipe } from "@lyric/video/node";
import { createCard } from "@lyric/video/characters";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-production-"));
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
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, "Hold on to me\n* Never let go\nThrough the night\n");
  const song = path.join(root, "Hold On.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=4", song);
  const ws = openWorkspace(wsDir);
  const { id } = await createSong(ws, { song, lyrics });
  const paths = songPathsById(ws, id);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, c] of ["blue", "red"].entries()) ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=216x384:r=30:d=2`, "-pix_fmt", "yuv420p", path.join(paths.clips!, `0${i + 1}_${c}.mp4`));
  writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), platforms: ["reels"] });
  const pic = path.join(root, "p.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=pink:s=60x80", "-frames:v", "1", pic);
  for (const [kind, name] of [["character", "Bride No 2"], ["character", "Bridegroom"], ["scene", "Beach path"]] as const) createCard(ws, { kind, name, picture: readFileSync(pic), fileName: "p.png" });
  ws.db.update(cardTable).set({ status: "locked" }).where(eq(cardTable.name, "Bride No 2")).run();
  ws.db.update(cardTable).set({ status: "locked" }).where(eq(cardTable.name, "Beach path")).run();
  ws.close();
  const answer = `Here is the shot list for your song:\n\n\`\`\`json\n${JSON.stringify({ slots: [
    { id: "s01", order: 1, shows: "She walks along the path toward the sea", characters: ["Bride No 2"], scene: "Beach path", shot: "wide", line: 1 },
    { id: "s02", order: 2, shows: "He waits at the end of the path", characters: ["Bridegroom"], scene: "Beach path", shot: "close-up", line: 2 },
  ] }, null, 2)}\n\`\`\`\nTell me if you want changes.`;

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
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await page.goto(`${base}/songs/${id}?tab=production`);
    await page.waitForSelector("[data-production]");
    check(!!(await page.$("[data-production-section=cast]")) && !!(await page.$("[data-production-section=bible]")) && !!(await page.$("[data-production-section=brief]")) && !!(await page.$("[data-production-section=shotlist]")), "Prepare → Production shows Cast, Story bible, Ask Claude and Shot list");
    check(((await page.textContent("[data-production-section=cast]")) ?? "").includes("optional") && ((await page.textContent("[data-production-section=bible]")) ?? "").includes("optional"), "the cast and the bible are optional");

    // The cast from the library: searchable, with pictures; linked, not copied.
    await page.click("[data-picker-open=cast]");
    await page.fill("[data-picker-search]", "bride");
    const brides = await page.$$eval("[data-picker=cast] [data-picker-item]", (e: Element[]) => e.length);
    await page.fill("[data-picker-search]", "no 2");
    const shown = await page.$$eval("[data-picker=cast] [data-picker-item]", (e: Element[]) => e.length);
    check(brides === 2 && shown === 1, `the picker searches the library ("bride": ${brides} cards, "no 2": ${shown})`);
    await page.click("[data-picker=cast] [data-picker-item]");
    await page.waitForSelector("[data-picked=cast]");
    await page.fill("[data-picker-search]", "");
    await page.click("[data-picker-filter=Scenes]");
    await page.click("[data-picker=cast] [data-picker-item]");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll("[data-picked=cast]").length === 2);
    const chips = await page.$$eval("[data-picked=cast]", (e: Element[]) => e.map((x) => x.textContent ?? ""));
    check(chips[0].includes("Bride No 2") && chips[1].includes("Beach path"), `the cast shows the chosen cards (${chips.join(" | ")})`);
    check(!!(await page.$("[data-picked=cast] img")), "each cast chip shows the card's picture");
    const prod = JSON.parse(readFileSync(path.join(paths.root, "production", "production.json"), "utf8")) as { cast: string[] };
    check(prod.cast.length === 2 && !existsSync(path.join(paths.root, "production", "characters")), "production.json links the two cards by id (nothing copied)");

    // The story bible.
    await page.fill("[data-bible-text]", "A coastal town, late summer. Soft warm light.");
    await page.click("[data-bible-save]");
    await page.waitForSelector("[data-production-notice=ok]");
    check(readFileSync(path.join(paths.root, "production", "bible.md"), "utf8").includes("A coastal town"), "the bible is saved in the song folder");

    // Copy Song brief.
    await page.click("[data-copy-brief]");
    await page.waitForFunction(() => document.querySelector("[data-copy-brief]")?.textContent?.includes("Copied"));
    const brief = (await page.evaluate(() => navigator.clipboard.readText())) as string;
    check(brief.startsWith("# Song brief: Hold On") && brief.includes("Hold on to me") && brief.includes("9:16 (Reels)") && brief.includes("**Bride No 2**") && brief.includes("A coastal town") && brief.includes('"slots"'), "Copy Song brief puts the brief (lyrics, size, cast, bible, format) on the clipboard");

    // Paste back: other text is offered as the bible; a shot list goes to the check and import.
    await page.fill("[data-paste-answer]", "Just some notes about the mood.");
    await page.waitForSelector("[data-pasted=bible]");
    check(!!(await page.$("[data-pasted-bible]")), "pasted text that is not a shot list can become the story bible");
    await page.fill("[data-paste-answer]", answer);
    await page.waitForSelector("[data-pasted=shotlist]");
    check(((await page.textContent("[data-pasted=shotlist]")) ?? "").includes("2 slots"), "a shot list inside Claude's answer is found (2 slots)");
    await page.click("[data-pasted-check]");
    await page.waitForSelector("[data-shotlist-check=ok]");
    check(((await page.textContent("[data-shotlist-summary]")) ?? "").includes("2 slots ready"), "Check and import opens the shot list check: 2 slots ready");
    await page.click("[data-shotlist-import]");
    await page.waitForFunction(() => document.querySelector("[data-shotlist-state]")?.textContent?.includes("2 slots"));
    check(existsSync(path.join(paths.root, "shotlist.json")), "the shot list is imported into the Storyboard (shotlist.json)");
    await page.waitForSelector("[data-cast-missing]");
    check(((await page.textContent("[data-cast-missing]")) ?? "").includes("Bridegroom"), "a character the shot list uses but the cast lacks is named");
    await page.click("[data-cast-missing] button");
    await page.waitForFunction(() => document.querySelectorAll("[data-picked=cast]").length === 3);
    check(true, "Add to the cast adds it");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true }); // a picture of the tab for the docs

    // The slots are in the Storyboard.
    await page.goto(`${base}/songs/${id}?tab=clips`);
    await page.waitForSelector("[data-story-slot=s02]");
    check(true, "the slots show in Prepare → Storyboard");
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
