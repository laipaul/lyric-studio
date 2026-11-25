// Browser test of G2 Prepare → Creation (needs a studio build, FFmpeg and Playwright; the services are stand-ins:
// LYRIC_GENERATE_STUB, nothing is sent anywhere):
//   npx tsx apps/studio/e2e/pictures.e2e.ts
// The Creation tab; pictures and a Midjourney video dropped together, each with its source label; Paul's defaults (model,
// takes, cap) saved for every song and a per-picture override; the cost shown before Animate; a cap below it refuses;
// takes stay in Creation (the clips are untouched); "Send to Storyboard" on a take and on the video puts each at the END
// of the story line, marked as sent.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const mjVideo = path.join(root, "paul_bride_walks_away_0b1c2d3e-1111-2222-3333-444455556666_0.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=green:s=180x320:r=24:d=2", "-pix_fmt", "yuv420p", mjVideo);

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
    check(tabs.includes("Creation"), `Prepare has a Creation tab (${tabs.join(", ")})`);

    await page.setInputFiles("[data-pictures-input]", [picA, picB, mjVideo]);
    await page.waitForSelector(`[data-picture='${path.basename(mjVideo)}']`);
    check(((await page.textContent("[data-pictures-notice]")) ?? "").includes("3 files added"), "2 pictures and a video added under their own names");
    check(existsSync(path.join(paths.root, "pictures", "bride by the sea.png")), "they are in the song folder (pictures\\)");
    const tile = "[data-picture='bride by the sea.png']";
    const vtile = `[data-picture='${path.basename(mjVideo)}']`;
    check(((await page.textContent(`${tile} [data-source]`)) ?? "").trim() === "Added by you", "a picture added by hand says so");
    check(((await page.textContent(`${vtile} [data-source]`)) ?? "").includes("Midjourney · video"), "a Midjourney video is labelled Midjourney");
    check(!(await page.isVisible(`${vtile} [data-picture-animate]`)), "a video has no Animate (only pictures animate)");
    check(((await page.textContent(`${tile} [data-picture-cost]`)) ?? "").includes("3 × 5 s · about $3.24"), "the cost of 3 takes shows before anything is sent");
    check((await page.inputValue("[data-default-length]")) === "song" && ((await page.textContent("[data-default-length]")) ?? "").includes("5 s until the beats are found"), "take length: Fit the song by default (5 s while the song has no beats)");
    // Rename: a short name instead of the long file name (the file keeps its name).
    await page.click(`${vtile} [data-name-field]`);
    await page.fill(`${vtile} [data-name-input]`, "Bride walks");
    await page.keyboard.press("Enter");
    await page.waitForFunction((t: string) => document.querySelector(`${t} [data-name-field]`)?.textContent?.includes("Bride walks"), vtile);
    const pj = () => JSON.parse(readFileSync(path.join(paths.root, "pictures", "pictures.json"), "utf8")) as { pictures: Record<string, { label?: string; feeling?: string; takes: { n: number; label?: string; feeling?: string }[] }> };
    check(pj().pictures[path.basename(mjVideo)].label === "Bride walks" && existsSync(path.join(paths.root, "pictures", path.basename(mjVideo))), "a video gets a short name; its file keeps its own name");

    // Paul's defaults, for every song: the best model.
    await page.selectOption("[data-animate-service]", "wavespeed:best");
    await page.waitForFunction((t: string) => document.querySelector(`${t} [data-picture-cost]`)?.textContent?.includes("$4.86"), tile);
    const saved = JSON.parse(readFileSync(path.join(wsDir, "creation.json"), "utf8")) as { service: string; quality: string; takes: number };
    check(saved.service === "wavespeed" && saved.quality === "best" && saved.takes === 3, "the default model is saved for every song (workspace\\creation.json)");
    // This picture only: 2 takes.
    await page.selectOption(`${tile} [data-picture-takes]`, "2");
    check(((await page.textContent(`${tile} [data-picture-cost]`)) ?? "").includes("2 × 5 s · about $3.24"), "a picture can override the default takes");
    check(((await page.textContent("[data-picture='rain street.jpg'] [data-picture-cost]")) ?? "").includes("3 × 5 s"), "other pictures keep the defaults");

    // The cap: below the cost, Animate is off.
    await page.fill("[data-animate-cap]", "2");
    await page.click(`${tile} [data-picture-mood]`); // leaves the cap field: saved
    await page.waitForFunction((t: string) => document.querySelector(`${t} [data-picture-cost]`)?.textContent?.includes("above your cap"), tile);
    check(await page.isDisabled(`${tile} [data-picture-animate]`), "a cap below the cost turns Animate off");
    await page.fill("[data-animate-cap]", "10");
    await page.fill(`${tile} [data-picture-mood]`, "quiet, longing");
    await page.waitForFunction((t: string) => !document.querySelector(`${t} [data-picture-cost]`)?.textContent?.includes("above your cap"), tile);

    // Feeling (25 Nov 2026): a loose picture has none until chosen here; the takes are sent with it.
    check((await page.textContent(`${tile} [data-picture-feeling] option[value='']`)) === "Feeling: none", "a loose picture: Feeling none");
    await page.selectOption(`${tile} [data-picture-feeling]`, "tender");
    for (let i = 0; i < 50 && Object.values(pj().pictures).every((r) => r.feeling !== "tender"); i++) await sleep(100);
    check(Object.values(pj().pictures).some((r) => r.feeling === "tender"), "the picture's feeling is saved");

    await page.click(`${tile} [data-picture-animate]`);
    await page.waitForFunction((t: string) => document.querySelectorAll(`${t} [data-take-status=done]`).length === 2, tile, { timeout: 60000 });
    check(true, "Animate makes the 2 takes");
    check(((await page.textContent(`${tile} [data-take='1'] [data-take-facts]`)) ?? "").includes("tender"), "each take shows the feeling it was sent with");
    check(((await page.getAttribute(`${tile} [data-take='1'] [data-take-source]`, "title")) ?? "").includes("WaveSpeed · Seedance 2.5") && /720p|480p/.test((await page.textContent(`${tile} [data-take='1'] [data-take-source]`)) ?? ""), "each take shows what made it (the full source on hover)");
    check(/^\d+ s · (tender · )?about \$\d+\.\d\d · .*\d\d?:\d\d/.test(((await page.textContent(`${tile} [data-take='1'] [data-take-facts]`)) ?? "").trim()), `each take shows its length, cost and when it was made (${await page.textContent(`${tile} [data-take='1'] [data-take-facts]`)})`);
    await page.click(`${tile} [data-take='1'] [data-take-play]`);
    await page.waitForSelector("[data-take-player] video");
    const playable = await page.waitForFunction(() => { const v = document.querySelector("[data-take-player] video") as HTMLVideoElement | null; return !!v && v.readyState >= 2 && v.videoWidth > 0; }, null, { timeout: 15_000 }).then(() => true).catch(() => false);
    check(playable, "a click on a take opens it big and it plays");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-take-player]", { state: "detached" });
    // The story line: clips.json's order once there is one; before that, the clips by file name.
    const order = () => (existsSync(path.join(paths.root, "clips.json")) ? (JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { order: string[] }).order : readdirSync(paths.clips!).sort());
    check(JSON.stringify(order()) === JSON.stringify(["01_blue.mp4", "02_red.mp4"]), `the takes stay in Creation: the clips are untouched (${order().join(", ")})`);
    const json = JSON.parse(readFileSync(path.join(paths.root, "pictures", "pictures.json"), "utf8")) as { pictures: Record<string, { mood?: string }> };
    check(json.pictures["bride by the sea.png"].mood === "quiet, longing", "the mood words are kept with the picture");
    check(((await page.textContent("[data-animate-spent]")) ?? "").includes("$3.24"), "what was sent for the song is shown ($3.24)");

    await page.click(`${tile} [data-take='2'] [data-name-field]`);
    await page.fill(`${tile} [data-take='2'] [data-name-input]`, "Sea smile");
    await page.keyboard.press("Enter");
    await page.waitForFunction((t: string) => document.querySelector(`${t} [data-take='2'] [data-name-field]`)?.textContent?.includes("Sea smile"), tile);
    check(pj().pictures["bride by the sea.png"].takes.find((x) => x.n === 2)?.label === "Sea smile", "a take gets a short name");
    await page.click(`${tile} [data-take='2'] [data-take-send]`);
    await page.waitForSelector(`${tile} [data-take='2'] [data-take-sent]`);
    await page.click(`${vtile} [data-picture-send]`);
    await page.waitForSelector(`${vtile} [data-picture-sent]`);
    const want = ["01_blue.mp4", "02_red.mp4", "bride by the sea take 2.mp4", path.basename(mjVideo)];
    check(JSON.stringify(order()) === JSON.stringify(want), `Send to Storyboard puts each at the END of the story line (${order().join(", ")})`);
    check(!(await page.isVisible(`${tile} [data-take='1'] [data-take-sent]`)), "a take not sent stays only in Creation");
    const clipLabels = (JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { clips: Record<string, { label?: string }> }).clips;
    check(clipLabels["bride by the sea take 2.mp4"]?.label === "Sea smile" && clipLabels[path.basename(mjVideo)]?.label === "Bride walks", "the short names go with them to the Storyboard");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

    await page.goto(`${base}/songs/${id}?tab=clips`);
    await page.waitForSelector(`[data-clip='${path.basename(mjVideo)}']`);
    const line = await page.$$eval("[data-position]", (e: Element[]) => e.map((x) => x.getAttribute("data-clip")));
    check(JSON.stringify(line) === JSON.stringify(want), "the Storyboard shows what was sent after the song's own clips, ready to be dragged");
    check(((await page.textContent(`[data-clip='bride by the sea take 2.mp4'] [data-name-field]`)) ?? "").includes("Sea smile"), "the Storyboard card shows the short name");
    await page.click(`[data-clip='01_blue.mp4'] [data-name-field]`);
    await page.fill(`[data-clip='01_blue.mp4'] [data-name-input]`, "Blue sky");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(`[data-clip='01_blue.mp4'] [data-name-field]`)?.textContent?.includes("Blue sky"));
    const after = (JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { clips: Record<string, { label?: string }> }).clips;
    check(after["01_blue.mp4"]?.label === "Blue sky" && existsSync(path.join(paths.clips!, "01_blue.mp4")), "any Storyboard clip can be renamed there too (the file keeps its name)");
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
