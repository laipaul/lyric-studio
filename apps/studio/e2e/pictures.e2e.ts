// Browser test of G2 Prepare → Pictures (needs a studio build, FFmpeg and Playwright; the services are stand-ins:
// LYRIC_GENERATE_STUB, nothing is sent anywhere):
//   npx tsx apps/studio/e2e/pictures.e2e.ts
// The Pictures tab; pictures dropped on the board; the cost of 3 takes shown before Animate; a cap below it refuses;
// Animate makes 3 takes that join the END of the song's clips under "<picture> take N.mp4"; the Storyboard shows them
// after the song's own clips.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { card as cardTable, openWorkspace } from "@lyric/db";
import { createSong, readRecipe, songPathsById, writeRecipe } from "@lyric/video/node";
import { createCard } from "@lyric/video/characters";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-pictures-"));
const wsDir = path.join(root, "workspace");
const port = 3196;
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
  const picA = path.join(root, "bride by the sea.png");
  const picB = path.join(root, "rain street.jpg");
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=180x320", "-frames:v", "1", picA);
  ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=180x320", "-frames:v", "1", picB);

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
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.goto(`${base}/songs/${id}?tab=production`);
    await page.waitForSelector("[data-pictures-drop]");
    const tabs = await page.$$eval("[data-stage-header] [role=tab]", (e: Element[]) => e.map((x) => (x.textContent ?? "").trim()));
    check(tabs.includes("Pictures"), `Prepare has a Pictures tab (${tabs.join(", ")})`);

    await page.setInputFiles("[data-pictures-input]", [picA, picB]);
    await page.waitForSelector("[data-picture='rain street.jpg']");
    check(((await page.textContent("[data-pictures-notice]")) ?? "").includes("2 pictures added"), "2 pictures added to the board under their own names");
    check(existsSync(path.join(paths.root, "pictures", "bride by the sea.png")), "the pictures are in the song folder (pictures\\)");
    const tile = "[data-picture='bride by the sea.png']";
    check(((await page.textContent(`${tile} [data-picture-cost]`)) ?? "").includes("3 × 5 s · about $3.24"), "the cost of 3 takes shows before anything is sent");

    // The cap: below the cost, Animate is off.
    await page.fill("[data-animate-cap]", "2");
    await page.waitForFunction((t: string) => document.querySelector(`${t} [data-picture-cost]`)?.textContent?.includes("above your cap"), tile);
    check(await page.isDisabled(`${tile} [data-picture-animate]`), "a cap below the cost turns Animate off");
    await page.fill("[data-animate-cap]", "10");

    await page.fill(`${tile} [data-picture-mood]`, "quiet, longing");
    await page.click(`${tile} [data-picture-animate]`);
    await page.waitForFunction((t: string) => document.querySelectorAll(`${t} [data-take-status=done]`).length === 3, tile, { timeout: 60000 });
    check(true, "Animate makes 3 takes, each shown as in your clips");
    const clips = readFileSync(path.join(paths.root, "clips.json"), "utf8");
    const order = (JSON.parse(clips) as { order: string[] }).order;
    check(JSON.stringify(order) === JSON.stringify(["01_blue.mp4", "02_red.mp4", "bride by the sea take 1.mp4", "bride by the sea take 2.mp4", "bride by the sea take 3.mp4"]), `the takes join the END of the clips (${order.join(", ")})`);
    const json = JSON.parse(readFileSync(path.join(paths.root, "pictures", "pictures.json"), "utf8")) as { pictures: Record<string, { mood?: string }> };
    check(json.pictures["bride by the sea.png"].mood === "quiet, longing", "the mood words are kept with the picture");
    check(((await page.textContent("[data-animate-spent]")) ?? "").includes("$3.24"), "what was sent for the song is shown ($3.24)");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

    await page.goto(`${base}/songs/${id}?tab=clips`);
    await page.waitForSelector("[data-clip='bride by the sea take 3.mp4']");
    const line = await page.$$eval("[data-position]", (e: Element[]) => e.map((x) => x.getAttribute("data-clip")));
    check(JSON.stringify(line) === JSON.stringify(["01_blue.mp4", "02_red.mp4", "bride by the sea take 1.mp4", "bride by the sea take 2.mp4", "bride by the sea take 3.mp4"]), "the Storyboard shows the takes after the song's own clips, ready to be dragged");
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
