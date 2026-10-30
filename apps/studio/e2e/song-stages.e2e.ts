// Browser test of the four-stage song page (needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/song-stages.e2e.ts
// The stage bar (Prepare -> Shape -> Make -> Review & Post) with each stage's tabs only, the Prepare
// to-do list (buttons open the right tab), "Make release pack" (one video per platform of the song's own
// platforms, queued for the worker) and the page opening on the stage that needs attention.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRun, openWorkspace } from "@lyric/db";
import { createSong, readRecipe, songPathsById, writeRecipe } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-stages-"));
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
  mkdirSync(root, { recursive: true });
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, "Chorus:\nHold on to me\nNever let go\n");
  const song = path.join(root, "Hold On.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=3", song);
  const ws = openWorkspace(wsDir);
  const { id } = await createSong(ws, { song, lyrics });
  ws.close();

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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(`${base}/songs/${id}`);
    await page.waitForSelector("[data-stages]");

    // Opens on Prepare (no clips: blocking), with the to-do list.
    check((await page.getAttribute("[data-stage=prepare]", "aria-current")) === "step", "opens on Prepare when something blocks");
    check(((await page.textContent("[data-stage=prepare] [data-stage-status]")) ?? "").includes("3 to do"), "Prepare: 3 to do");
    const items = await page.$$eval("[data-todo-item]", (e: Element[]) => e.map((x) => x.getAttribute("data-todo-item")));
    check(JSON.stringify(items) === JSON.stringify(["clips", "cover", "labels"]), `to-do: clips, cover, labels (${items.join(", ")})`);
    const tabs = async () => page.$$eval("[role=tab]", (e: Element[]) => e.map((x) => x.textContent?.trim()));
    check(JSON.stringify(await tabs()) === JSON.stringify(["Assets", "Lyrics"]), "Prepare shows only Assets and Lyrics");
    await page.click("[data-todo-item=labels] button");
    check((await page.getAttribute("[role=tab][data-state=active]", "id"))?.endsWith("lyrics") ?? false, "the label item's button opens the Lyrics tab");

    // Shape and Review show their own tabs; Make has the release pack.
    await page.click("[data-stage=shape]");
    check(JSON.stringify(await tabs()) === JSON.stringify(["Style", "Storyboard"]), "Shape shows Style and Storyboard");
    await page.click("[data-stage=review]");
    check(JSON.stringify(await tabs()) === JSON.stringify(["Videos", "Post"]), "Review & Post shows Videos and Post");
    await page.click("[data-stage=make]");
    await page.waitForSelector("[data-release-pack]");
    check(((await page.textContent("[data-release-platforms]")) ?? "").includes("Reels · TikTok · Shorts · YouTube · Canvas"), "release pack: every platform when the song has none of its own");
    check(await page.isDisabled("[data-make-release]"), "release pack waits for the clips (blocking to-do)");

    // Clips (a collection) + the song's own platforms: the release pack makes one video for each.
    const ws2 = openWorkspace(wsDir);
    mkdirSync(path.join(wsDir, "collections", "wedding"), { recursive: true });
    const recipe = songPathsById(ws2, id).recipe!;
    writeRecipe(recipe, { ...readRecipe(recipe), collections: ["wedding"], platforms: ["reels", "youtube"] });
    await page.goto(`${base}/songs/${id}`);
    await page.waitForSelector("[data-stages]");
    // Still 2 things to check (cover, label line), none blocking: Prepare says "to check", Make is open.
    check(((await page.textContent("[data-stage=prepare] [data-stage-status]")) ?? "").includes("2 to check"), "nothing blocking: Prepare says 2 to check");
    await page.click("[data-stage=make]");
    check(((await page.textContent("[data-release-platforms]")) ?? "").includes("Reels · YouTube (this song's platforms)"), "release pack: the song's own platforms");
    await page.click("[data-make-release]");
    await page.waitForSelector("[data-release-pack] >> text=Queued");
    const run = ws2.db.select().from(makeRun).all().at(-1);
    const options = (run?.options_json ?? {}) as { platforms?: string; variations?: number };
    check(run?.status === "queued" && options.platforms === "reels,youtube" && options.variations === 1, `queued: Reels + YouTube, one video each (${JSON.stringify(options)})`);

    // Part 2. Two runs of Reels (v1 ready, v2 with a point) and one discarded video: Make counts every kept
    // video; Post offers the ready one; "Try another take" queues take 3; Style shows only what differs.
    const exportsDir = songPathsById(ws2, id).exports;
    const video = (dir: string, name: string, qa: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${name}.mp4`), "x");
      writeFileSync(path.join(dir, `${name}.manifest.json`), JSON.stringify({ manifest_version: 1, created_at: "2026-10-29T09:00:00Z", command: "pnpm make song.wav lyrics.txt", variation: { order: "story", seed: 1, style: "Simple", cinematic_bars: false }, props: {} }));
      writeFileSync(path.join(dir, `${name}.qa.txt`), qa);
    };
    video(path.join(exportsDir, "2026-10-28_1000", "reels"), "v1", "x\nSummary: PASS\n");
    video(path.join(exportsDir, "2026-10-29_1000", "reels"), "v2", "x\n[WARN] Clips repeated within 3 shots\nSummary: WARN - Clips repeated within 3 shots\n");
    await page.goto(`${base}/songs/${id}`);
    await page.waitForSelector("[data-stages]");
    check(((await page.textContent("[data-stage=make] [data-stage-status]")) ?? "").includes("2 videos made"), "Make counts every kept video of the song, all runs (2)");
    check((await page.getAttribute("[data-stage=review]", "aria-current")) === "step", "with videos: opens on Review & Post");
    await page.click("[role=tab]:has-text('Post')");
    await page.waitForSelector("[data-ready-to-approve]");
    const offered = await page.$$eval("[data-offered]", (e: Element[]) => e.map((x) => x.getAttribute("data-offered")));
    check(offered.length === 1 && (offered[0] ?? "").includes("2026-10-28_1000/reels/v1"), `Post offers only the ready video, not the one with a point (${offered.join(", ")})`);
    await page.click("[data-approve]");
    await page.waitForSelector("[data-post-video]");
    check((await page.$("[data-ready-to-approve]")) === null, "Approve: it moves into the posting list");
    await page.click("[role=tab]:has-text('Videos')");
    await page.waitForSelector("[data-another-take]");
    await page.click("[data-take=reels]");
    await page.waitForSelector("[data-another-take] >> text=Queued");
    const takeRun = ws2.db.select().from(makeRun).all().at(-1);
    const takeOptions = (takeRun?.options_json ?? {}) as { platforms?: string; take?: number };
    check(takeOptions.platforms === "reels" && takeOptions.take === 3 && (takeRun?.label ?? "").includes("take 3"), `Try another take: Reels take 3 (${JSON.stringify(takeOptions)}, ${takeRun?.label})`);
    await page.click("[data-stage=shape]");
    await page.click("[role=tab]:has-text('Style')");
    await page.waitForSelector("[data-show-all]");
    const fields = await page.$$eval("[data-field]", (e: Element[]) => e.map((x) => x.getAttribute("data-field")));
    check(JSON.stringify(fields.sort()) === JSON.stringify(["collections", "platforms"]), `Style shows only what the song changes (+ platforms) (${fields.join(", ")})`);
    await page.click("[data-show-all]");
    check((await page.$$("[data-field]")).length > 10, "Show all settings lists every setting");
    check(!!(await page.$("[data-field=breathe]")), "Breathe is a setting (off / gentle / with the beat)");
    // The effects preview: the song's own lines, drawn as in the video; trying an effect saves nothing.
    await page.waitForSelector("[data-effect-preview]");
    await page.click("[data-try-effect=typewriter]");
    await page.selectOption("[data-try-breathe]", "beat");
    await sleep(1500);
    check((await page.$$eval("[data-effect-preview] [data-lyric]", (e: Element[]) => e.length)) > 0, "the preview draws the song's lines");
    if (process.env.SHOT_FX) await page.screenshot({ path: process.env.SHOT_FX, clip: await page.$eval("[data-effect-preview]", (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }; }) });
    check(!JSON.parse(readFileSync(recipe, "utf8")).breathe, "trying in the preview saves nothing to song.json");
    // Held-note glow: on for this song, then "Use for all my songs" (brand.json, every platform with lyrics).
    await page.selectOption("[data-field=heldGlow] select[data-edit]", "on");
    await page.waitForSelector("[data-saving=saved]");
    check(JSON.parse(readFileSync(recipe, "utf8")).heldGlow === "on", "Held-note glow on: saved to song.json");
    await page.click("[data-brand-all=heldGlow]");
    await page.click("[data-brand-all-yes=heldGlow]");
    await page.waitForFunction(() => !document.querySelector("[data-brand-all-ask=heldGlow]"));
    await sleep(800);
    const brand = JSON.parse(readFileSync(path.join(wsDir, "brand", "brand.json"), "utf8")) as { perPlatform?: Record<string, { heldGlow?: string }> };
    check(brand.perPlatform?.reels?.heldGlow === "on" && brand.perPlatform?.youtube?.heldGlow === "on" && !brand.perPlatform?.canvas, `Use for all my songs: brand.json on every platform with lyrics (${JSON.stringify(brand.perPlatform)})`);
    check(JSON.parse(readFileSync(recipe, "utf8")).heldGlow === undefined, "…and the song follows the brand (its own value removed)");
    check(!!(await page.$("[data-try-addon=shine]")), "the preview offers the add-ons");
    ws2.close();
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    await browser.close();
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
  if (failures) {
    console.log(`${failures} browser check(s) failed`);
    process.exit(1);
  }
  console.log("All browser checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
