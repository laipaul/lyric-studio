// Browser test of Creation → Story room | Production (C3 Part 1, 22 Nov 2026; needs a studio build, FFmpeg and
// Playwright with Chromium; takes are made locally by LYRIC_GENERATE_STUB, nothing is sent anywhere):
//   npx tsx apps/studio/e2e/creation-production.e2e.ts
// A Mini film song with a shot list opens Creation on Production: the shots in story order with their sections and
// lines. A picture dropped on shot 2 belongs to it; Animate makes its takes there; "Use for shot 2" fills the item:
// in its place in the story line and on its lyric line. Story room holds the Film look, the defaults and the story tools.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, readClipEdits, readRecipe, songPathsById, writeRecipe, type AlignRunner } from "@lyric/video/node";
import { importShotList } from "@lyric/video/shotlist";
import { addLook, createCard } from "@lyric/video/characters";
import { setCast } from "@lyric/video/production";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-creation-production-"));
const wsDir = path.join(root, "workspace");
const port = 3205;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};
const TEXTS = ["Verse one here", "Hold on to me", "Through the night", "Verse two here", "Hold on to me", "Into the light"];
const STARTS = [1000, 2500, 4000, 5500, 7000, 11_000];
const stamp = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, "0")}`;

async function main() {
  process.env.WORKSPACE_DIR = wsDir;
  const songFile = path.join(root, "Something About Us.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)+0.9*sin(2*PI*55*t)*exp(-12*mod(t-0.25,2))*gte(t,0.25)':s=44100:d=14", "-ac", "2", songFile);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, songFile);
  const id = sp.project.id;
  const paths = songPathsById(ws, id);
  writeFileSync(paths.lyricsTxt, `${TEXTS.map((t, i) => (i === 1 || i === 4 ? `* ${t}` : t)).join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(paths.clips!, "01_own.mp4"));
  writeRecipe(paths.recipe!, { platforms: ["reels"], songStyle: "film" });
  const lrc = TEXTS.map((t, i) => `[${stamp(STARTS[i])}]${t.split(" ").map((w, k) => `<${stamp(STARTS[i] + k * 300)}>${w}`).join(" ")} <${stamp(STARTS[i] + 1200)}>`).join("\n");
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, `${lrc}\n[00:13.00]\n`);
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: TEXTS.map((text, i) => ({ number: i + 1, text, is_hook: i === 1 || i === 4, start_ms: STARTS[i], end_ms: STARTS[i] + 1200, confidence: 0.9, low_confidence: false })) }));
  };
  const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
  await ensureAlignment(ws, { ...sp, project: p }, { lyricsTxt: paths.lyricsTxt, durationMs: 14_000, align: aligner });
  // A character in the cast (shot 2): its picture is the shot's Omni Reference for Midjourney.
  const face = path.join(root, "bride.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=0xE8A3B5:s=300x400", "-frames:v", "1", face);
  const bride = createCard(ws, { kind: "character", name: "Bride", picture: readFileSync(face), fileName: "bride.png" });
  setCast(ws, id, [bride.id]);
  addLook(ws, bride.id, { name: "Autumn City", outfit: "A long camel wool coat over a cream turtleneck." });
  await importShotList(
    ws,
    id,
    {
      slots: [
        { id: "s01", order: 1, shows: "The empty chapel in morning light", characters: [], scene: null, shot: "wide" },
        { id: "s02", order: 2, shows: "She walks in on her father's arm", characters: ["Bride"], scene: null, shot: "medium", line: 1 },
        { id: "s03", order: 3, shows: "Close on her smile", characters: ["Bride"], scene: null, shot: "close-up", line: 3 },
      ],
    },
    "shots.json",
  );
  const pic = path.join(root, "s02 walk in.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=pink:s=540x960", "-frames:v", "1", pic);
  // Bulk drop by shot: named after shot 3; and a Midjourney download (its job id in the name).
  const byName = path.join(root, "s03 smile.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=0x445566:s=540x960", "-frames:v", "1", byName);
  const mj = path.join(root, "lifelyrics_bride_5813efa3-57ba-409f-8aa1-09b60e1b9c83_1.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=0x665544:s=540x960", "-frames:v", "1", mj);

  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1", LYRIC_VOICE_MAP: "off", LYRIC_GENERATE_STUB: "1" },
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
    page.on("pageerror", (e: Error) => console.log(`page error: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 6).join("\n")}`));
    await page.goto(`${base}/songs/${id}?tab=production`);
    await page.waitForSelector("[data-creation-folders]", { timeout: 60_000 }).catch(async () => {
      if (process.env.PRODUCTION_SHOT) await page.screenshot({ path: process.env.PRODUCTION_SHOT.replace(".png", "-debug.png"), fullPage: true });
      throw new Error(`no folders: ${((await page.textContent("main").catch(() => "")) ?? "").slice(0, 600)}`);
    });
    check((await page.getAttribute("[data-creation-folder=production]", "aria-selected")) === "true", "a song with a shot list opens Creation on Production");
    await page.waitForSelector("[data-shot]");
    const shots = await page.$$eval("[data-shot]", (e: Element[]) => e.map((x) => `${x.getAttribute("data-shot-number")}:${x.getAttribute("data-shot")}:${x.getAttribute("data-shot-state")}`));
    check(JSON.stringify(shots) === JSON.stringify(["1:s01:empty", "2:s02:empty", "3:s03:empty"]), `the shots in story order, none made yet (${shots.join(", ")})`);
    check(((await page.textContent("[data-shot=s02] [data-shot-line]")) ?? "").includes("line 1: “Verse one here”"), "each shot shows its lyric line");
    // The shot grid (23 Nov 2026): how long each shot's take must last on the song.
    const length = ((await page.textContent("[data-shot=s02] [data-shot-length]")) ?? "").trim();
    check(/needs (a \d+\.\d s take|\d+\.\d s: extend)|only \d+\.\d s/.test(length), `each shot says how long its take must be (${length})`);
    check(((await page.textContent("[data-shots-progress]")) ?? "").includes("0 of 3 shots filled"), "the progress line");
    check(!!(await page.$("[data-production-defaults]")) && !(await page.$("[data-story-tools]")), "Production: the defaults in one line, no story tools");
    // Copy prompt (C3 Part 2a): each shot's Midjourney prompt, written by the app.
    const prompt = ((await page.textContent("[data-shot-prompt=s01]")) ?? "").trim();
    check(prompt === "cinematic wide establishing shot: The empty chapel in morning light --ar 9:16 --style raw", `each shot has its Midjourney prompt (${prompt})`);
    await page.click("[data-shot-copy-prompt=s01]");
    await page.waitForFunction(() => document.querySelector("[data-shot-copy-prompt=s01]")?.textContent?.includes("Copied"), null, { timeout: 5000 }).catch(() => {});
    check(((await page.textContent("[data-shot-copy-prompt=s01]")) ?? "").includes("Copied"), "Copy prompt copies it");
    const p2 = ((await page.textContent("[data-shot-prompt=s02]")) ?? "").trim();
    check(p2.startsWith("cinematic medium shot: She walks in on her father's arm") && !/Bride|young|slender|lips|skin/i.test(p2), `a person's prompt has no name and no face or body words (${p2})`);
    const refOk = await page.$eval("[data-shot-refs=s02] [data-shot-ref=Bride] img", (img: Element) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0).catch(() => false);
    check(refOk, "the shot shows the person's picture to use as Omni Reference");

    await page.click("[data-creation-folder=story]");
    await page.waitForSelector("[data-pictures=settings] [data-creation-defaults]");
    check(!!(await page.$("[data-story-tools]")) && !(await page.$("[data-shot]")), "Story room: Film look, defaults and the story tools, no shots");
    await page.click("[data-creation-folder=production]");
    await page.waitForSelector("[data-shot=s02] [data-shot-input]", { state: "attached" });

    // Shot 2: drop its picture, Animate (the stand-in), Use for shot 2.
    await page.setInputFiles("[data-shot-input=s02]", pic);
    await page.waitForSelector("[data-shot=s02] [data-picture]");
    check((await page.getAttribute("[data-shot=s02]", "data-shot-state")) === "picture", "the dropped picture belongs to shot 2");
    check(!(await page.$("[data-loose-heading] ~ div [data-picture]")), "it is not among the loose pictures");
    check(!(await page.$("[data-shot=s02] [data-picture-send]")) && ((await page.textContent("[data-shot=s02] [data-picture-use-shot]")) ?? "").includes("Use picture for shot 2"), "on a shot there is no Send: only Use picture for shot 2");
    await page.click("[data-shot=s02] [data-picture-animate]");
    await page.waitForSelector("[data-shot=s02] [data-take-use-shot]", { timeout: 90_000 });
    await page.click("[data-shot=s02] [data-take-use-shot] >> nth=0");
    await page.waitForSelector("[data-shot=s02][data-shot-state=filled]", { timeout: 30_000 });
    const notice = (await page.textContent("[data-pictures-notice]")) ?? "";
    check(notice.includes("Shot 2 is filled and shows on line 1"), `Use for shot 2 (${notice.trim()})`);
    check(((await page.textContent("[data-shots-progress]")) ?? "").includes("1 of 3 shots filled"), "the progress line counts it");
    check(!!(await page.$("[data-shot=s02] [data-take-shot-used]")), "the take says it is shot 2");

    // Compare (like Midjourney): clicking one candidate plays all of the shot's candidates together, with the song.
    check(((await page.textContent("[data-shot-compare-open=s02]")) ?? "").includes("Compare 4"), "the shot offers Compare 4 (the picture and its 3 takes)");
    await page.click("[data-shot=s02] [data-take='2'] [data-take-play]");
    await page.waitForSelector("[data-shot-compare=s02]");
    check((await page.$$("[data-shot-compare=s02] [data-compare-tile]")).length === 4, "clicking one take opens all 4 candidates side by side");
    await sleep(1500);
    const playingNow = await page.$$eval("[data-shot-compare=s02] video", (vs: Element[]) => vs.filter((v) => !(v as HTMLVideoElement).paused).length);
    check(playingNow === 3, `the 3 takes play together (${playingNow} playing)`);
    check(!!(await page.$("[data-shot-compare=s02] audio")) && (await page.isChecked("[data-compare-song]")), "with the song from line 1");
    if (process.env.PRODUCTION_SHOT) await page.screenshot({ path: process.env.PRODUCTION_SHOT.replace(".png", "-compare.png") });
    const pick = await page.getAttribute("[data-shot-compare=s02] [data-compare-use] >> nth=0", "data-compare-use");
    await page.click("[data-shot-compare=s02] [data-compare-use] >> nth=0");
    await page.waitForFunction((k: string) => !!document.querySelector(`[data-compare-tile="${k}"] [data-compare-used]`), pick, { timeout: 15_000 });
    check(true, `Use for shot 2 from the comparison (${pick})`);
    await page.keyboard.press("Escape");
    if (process.env.PRODUCTION_SHOT) await page.screenshot({ path: process.env.PRODUCTION_SHOT, fullPage: true });

    // ✕ on a shot's picture: back to the loose pictures; ✕ there: put aside; Restore brings it back.
    page.on("dialog", (d: { accept: () => Promise<void> }) => void d.accept());
    await page.click("[data-shot=s02] [data-picture-remove]");
    await page.waitForFunction(() => !document.querySelector("[data-shot=s02] [data-picture]"), null, { timeout: 15_000 });
    check(!!(await page.$("[data-loose-heading] ~ div [data-picture]")), "✕ on a shot: the picture goes back to the loose pictures");
    await page.click("[data-loose-heading] ~ div [data-picture] [data-picture-remove]");
    await page.waitForSelector("[data-pictures-removed]", { timeout: 15_000 });
    check(!(await page.$("[data-loose-heading] ~ div [data-picture]")), "✕ on a loose picture: put aside");
    await page.click("[data-pictures-removed] summary");
    await page.click("[data-picture-restore]");
    await page.waitForFunction(() => !document.querySelector("[data-pictures-removed]"), null, { timeout: 15_000 });
    check(!!(await page.$("[data-loose-heading] ~ div [data-picture]")), "Restore brings it back");

    // Dropped in the loose area: the file named after shot 3 lands on shot 3, the Midjourney one stays loose with its link.
    await page.setInputFiles("[data-pictures-input]", [byName, mj]);
    await page.waitForSelector("[data-shot=s03] [data-picture='s03 smile.png']", { timeout: 20_000 });
    const placedNotice = (await page.textContent("[data-pictures-notice]")) ?? "";
    check(placedNotice.includes("s03 smile.png → shot 3") && placedNotice.includes("1 loose"), `a file named after its shot lands on it (${placedNotice.trim()})`);
    check((await page.getAttribute(`[data-picture-mj='${path.basename(mj)}']`, "href")) === "https://www.midjourney.com/jobs/5813efa3-57ba-409f-8aa1-09b60e1b9c83?index=1", "a Midjourney download links to its original");

    // The look per shot (23 Nov 2026): shot 3's Bride in Autumn City; the prompt follows.
    await page.selectOption("[data-shot-look='s03-Bride']", "Autumn City");
    await page.waitForFunction(() => document.querySelector("[data-shot-prompt=s03]")?.textContent?.includes("camel wool coat"), null, { timeout: 15_000 });
    check(true, "choosing a look for shot 3: its prompt describes that outfit");
    check(!!(await page.$("[data-shot=s03] [data-shot-look-problem]")), "a look not locked yet is said on the shot");

    // In the song: its place in the story line and its lyric line.
    const order = readClipEdits(paths.root).order;
    const clip = (readRecipe(paths.recipe!).anchors ?? []).find((a) => a.line === 1)?.clip;
    check(!!clip && order.indexOf(clip) === order.indexOf("slot:s01") + 1 && !order.includes("slot:s02"), `the clip takes shot 2's place in the story line (${order.join(", ")})`);
    check(JSON.parse(readFileSync(path.join(paths.root, "shotlist.json"), "utf8")).filled?.s02 === clip, "the shot list remembers it");
    await page.goto(`${base}/songs/${id}?tab=clips`);
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("The empty chapel"), null, { timeout: 60_000 }).catch(() => {});
    await sleep(500);
    const story = (await page.evaluate(() => document.body.innerText)) as string;
    if (process.env.PRODUCTION_SHOT) await page.screenshot({ path: process.env.PRODUCTION_SHOT.replace(".png", "-storyboard.png") });
    check(story.includes("The empty chapel") && story.includes("Close on her smile"), "the other shots are still planned");
    check(!(await page.$("[data-story-slot=s02]")), "shot 2 is no longer a planned card");
    check((await page.getAttribute("[data-story-slot=s03] [data-slot-person=Bride]", "data-slot-look")) === "Autumn City", "the planned card of shot 3 shows the Bride in Autumn City");
    check(((await page.textContent("[data-story-slot=s03] [data-slot-people]")) ?? "").includes("Bride · Autumn City"), "and names the look in its people line");
    const filledCard = ((await page.textContent("[data-clip-shot=s02]").catch(() => "")) ?? "").trim();
    check(filledCard.includes("She walks in on her father's arm") && filledCard.includes("Shot 2") && filledCard.includes("line 1"), `the filled card keeps the shot's story (${filledCard})`);
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
