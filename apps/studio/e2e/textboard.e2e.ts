// Browser test of the Textboard in the Storyboard tab (needs a studio build, FFmpeg, the audio service's
// Python and Playwright, as the others):  pnpm test:e2e
// A 14 s click track, six lines, four song clips and a "city" collection, an anchor on line 4
// (02_b.mp4). Click a lyric card: change its place and size (the preview moves it before saving), save
// (textboard.json, planned again, the card marked); show the title card on Reels; save the design as a
// template (without the words) and apply it; swap the pictures to "city": the text stays, line 4
// becomes a slot until a city clip is dragged onto it.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, songPathsById, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-textboard-"));
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
const TEXTS = ["Verse one here", "Hold on to me", "Through the night", "Verse two here", "Hold on to me", "Into the light"];
const STARTS = [1000, 2500, 4000, 5500, 7000, 11_000];
const stamp = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, "0")}`;
const clip = (file: string, colour: string) =>
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=4", "-vf", `drawbox=c=${colour}@0.6:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file);

async function main() {
  process.env.WORKSPACE_DIR = wsDir;
  const song = path.join(root, "Text Board.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)+0.9*sin(2*PI*55*t)*exp(-12*mod(t-0.25,2))*gte(t,0.25)':s=44100:d=14", "-ac", "2", song);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  writeFileSync(paths.lyricsTxt, `${TEXTS.map((t, i) => (i === 1 || i === 4 ? `* ${t}` : t)).join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [name, colour] of [["01_a.mp4", "blue"], ["02_b.mp4", "yellow"], ["03_c.mp4", "red"], ["04_d.mp4", "green"]]) clip(path.join(paths.clips!, name), colour);
  const city = path.join(wsDir, "collections", "city");
  mkdirSync(city, { recursive: true });
  for (const [name, colour] of [["01_street.mp4", "white"], ["02_lights.mp4", "purple"], ["03_bridge.mp4", "orange"], ["04_park.mp4", "gray"]]) clip(path.join(city, name), colour);
  writeFileSync(paths.recipe!, JSON.stringify({ platforms: ["reels"], section: "0:02-0:10", anchors: [{ line: 4, clip: "02_b.mp4" }] }));
  const lrc = TEXTS.map((t, i) => `[${stamp(STARTS[i])}]${t.split(" ").map((w, k) => `<${stamp(STARTS[i] + k * 300)}>${w}`).join(" ")} <${stamp(STARTS[i] + 1200)}>`).join("\n");
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, `${lrc}\n[00:13.00]\n`);
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: TEXTS.map((text, i) => ({ number: i + 1, text, is_hook: i === 1 || i === 4, start_ms: STARTS[i], end_ms: STARTS[i] + 1200, confidence: 0.9 })) }));
  };
  const p = ws.db.select().from(project).where(eq(project.id, sp.project.id)).get()!;
  await ensureAlignment(ws, { ...sp, project: p }, { lyricsTxt: paths.lyricsTxt, durationMs: 14_000, align: aligner });
  const songFile = absPath(ws, p.audio_path!);
  ws.close();

  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1", LYRIC_VOICE_MAP: "off" },
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
    const replanned = async () => {
      await page.waitForSelector("[data-replanning]", { timeout: 10_000 }).catch(() => null);
      await page.waitForSelector("[data-replanning]", { state: "detached", timeout: 180_000 });
    };
    await page.goto(`${base}/songs/${sp.project.id}?tab=storyboard`);
    await page.waitForSelector("[data-storyboard-show]");
    await page.click("[data-storyboard-show]");
    await page.waitForSelector("[data-shot='1']", { timeout: 180_000 });
    const cards = await page.$$eval("[data-textboard-row] [data-card]", (els: Element[]) => els.map((e) => e.getAttribute("data-card")));
    check(cards.includes("line-3") && cards.includes("line-4"), `the Textboard row: one card per lyric line (${cards.join(", ")})`);
    check(!(await page.$("[data-textboard-titles]")), "no title card on Reels by default (as before)");

    // A lyric card: place and size, previewed before saving.
    await page.click("[data-card='line-3']");
    await page.waitForSelector("[data-card-editor='line-3']");
    const topOf = () => page.$eval("[data-lyric='Through the night']", (e: HTMLElement) => parseFloat(e.style.top)).catch(() => null);
    await sleep(500);
    const before = await topOf();
    await page.selectOption("[data-card-position]", "upper");
    await page.fill("[data-card-size]", "1.5");
    await sleep(500);
    const after = await topOf();
    check(before !== null && after !== null && after < before - 50, `the preview moves the line up before saving (top ${before} -> ${after})`);
    await page.click("[data-card-save]");
    await replanned();
    const board = () => JSON.parse(readFileSync(path.join(paths.root, "textboard.json"), "utf8"));
    const line3 = board().cards.find((c: { id: string }) => c.id === "line-3");
    check(JSON.stringify(line3?.overrides) === JSON.stringify({ position: "upper", size: 1.5 }), `saved in textboard.json (${JSON.stringify(line3?.overrides)})`);
    check(!!(await page.$("[data-card='line-3'][data-changed]")), "planned again: the card is marked as changed");

    // The title card, shown on Reels too.
    await page.click("[data-open-card='title']");
    await page.waitForSelector("[data-card-editor='title']");
    await page.selectOption("[data-card-show]", "true");
    await page.fill("[data-card-hold]", "3");
    await page.click("[data-card-save]");
    await replanned();
    await page.waitForSelector("[data-textboard-titles] [data-text-card='title']");
    check(((await page.textContent("[data-text-card='title']")) ?? "").includes("Text Board"), "the title card is on the timeline (the song's title)");

    // Save as template (the design, not the words), then apply it.
    await page.fill("[data-template-name]", "Clean");
    await page.click("[data-template-save]");
    await page.waitForSelector("[data-textboard-notice]");
    const tplFile = path.join(wsDir, "templates", "Life Lyrics", "Clean.json");
    const tpl = existsSync(tplFile) ? readFileSync(tplFile, "utf8") : "";
    check(tpl.includes('"show": true') && !tpl.includes("Through the night") && !tpl.includes("Text Board"), "the template keeps the design without the words");
    check(((await page.textContent("[data-textboard-notice]")) ?? "").includes("1 change(s) on single lyric lines"), "and says the line's own change is not part of it");
    await page.click("[data-template-apply-button]");
    await replanned();
    check(board().template === "Clean" && !board().cards.find((c: { id: string }) => c.id === "line-3").overrides, "Apply template: the template's design, this song's words (the line's own change is not part of it)");

    // Picture swap: the city collection instead of the song's clips.
    const linesBefore = await page.$$eval("[data-textboard-row] [data-card]", (els: Element[]) => els.map((e) => e.textContent));
    await page.click("[data-pictures] summary");
    await page.uncheck("[data-picture='song']");
    await page.check("[data-picture='city']");
    await page.click("[data-pictures-plan]");
    await page.waitForSelector("[data-storyboard-picture]", { timeout: 180_000 });
    await page.waitForSelector("[data-needs-clip='02_b.mp4']");
    const linesAfter = await page.$$eval("[data-textboard-row] [data-card]", (els: Element[]) => els.map((e) => e.textContent));
    check(JSON.stringify(linesAfter) === JSON.stringify(linesBefore), "the same textboard over the new pictures");
    check(((await page.textContent("[data-slots]")) ?? "").includes('line 4 "Verse two here" (was 02_b.mp4)'), "line 4 is a slot (its clip is not in city), highlighted and listed");
    const shotClips = await page.$$eval("[data-shot]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
    check(shotClips.every((t) => /street|lights|bridge|park/.test(t)), "the shots use the city clips");
    await page.dragAndDrop("[data-story-clip='03_bridge.mp4']", "[data-story-line='4']");
    await replanned();
    await page.waitForSelector("[data-story-line='4'][data-anchored='03_bridge.mp4']", { timeout: 60_000 }).catch(() => null);
    const line4 = await page.$eval("[data-story-line='4']", (e: Element) => `${e.getAttribute("data-anchored")} ${e.getAttribute("data-needs-clip")}`);
    check(!(await page.$("[data-needs-clip]")) && line4 === "03_bridge.mp4 null", `a city clip dragged onto the slot fills it (${line4})`);
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "textboard.png") });
    check(existsSync(songFile), "the song file is untouched");
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
