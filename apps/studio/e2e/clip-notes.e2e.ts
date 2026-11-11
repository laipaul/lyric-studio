// Browser test of the story notes on clip cards (Prepare → Clips; needs a studio build, FFmpeg and Playwright):
//   npx tsx apps/studio/e2e/clip-notes.e2e.ts
// "+ Add a note" on an empty card; a click opens a small box that saves as you type; Esc / clicking outside closes it
// to one line ending in "…"; the note survives reordering, Omit / Use, a renamed file and a reload; clearing deletes
// it; a card being written in does not drag; notes never show in Shape.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace } from "@lyric/db";
import { createSong, readRecipe, songPathsById, writeRecipe } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-notes-"));
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
const LONG = "Opening: she waits by the sea at dawn, before he arrives, the whole first verse";

async function main() {
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, "Hold on to me\n* Never let go\n");
  const song = path.join(root, "Hold On.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=4", song);
  const ws = openWorkspace(wsDir);
  const { id } = await createSong(ws, { song, lyrics });
  const paths = songPathsById(ws, id);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, c] of ["blue", "red", "green"].entries()) ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=216x384:r=30:d=3`, "-pix_fmt", "yuv420p", path.join(paths.clips!, `0${i + 1}_${c}.mp4`));
  writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), platforms: ["reels"] });
  ws.close();
  const notesFile = path.join(paths.root, ".studio", "clip-notes.json");
  const stored = () => (existsSync(notesFile) ? (JSON.parse(readFileSync(notesFile, "utf8")) as { notes: Record<string, { text: string; clip: string }> }).notes : {});

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
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.goto(`${base}/songs/${id}?tab=clips`);
    await page.waitForSelector("[data-clip='01_blue.mp4']");
    const order = () => page.$$eval("[data-clip]", (e: Element[]) => e.map((x) => x.getAttribute("data-clip")));

    // An empty card: a faint "+ Add a note"; a click opens the box (the card does not drag while it is open).
    check((await page.$$("[data-clip-note-add]")).length === 3, "every empty card offers + Add a note");
    await page.click("[data-clip-note-add='01_blue.mp4']");
    await page.waitForSelector("[data-clip-note-input='01_blue.mp4']");
    check((await page.getAttribute("[data-clip='01_blue.mp4']", "draggable")) === "false" && (await page.getAttribute("[data-clip='02_red.mp4']", "draggable")) === "true", "the card being written in does not drag (the others do)");
    // Saved as you type: no Save button.
    await page.type("[data-clip-note-input='01_blue.mp4']", LONG, { delay: 5 });
    await sleep(1200);
    check(Object.values(stored()).some((n) => n.text === LONG && n.clip === "01_blue.mp4"), "saved as you type, in .studio\\clip-notes.json");
    check(!(await page.$("[data-clip='01_blue.mp4'] button:has-text('Save')")), "no Save button");
    // Esc closes it to one line with "…".
    await page.press("[data-clip-note-input='01_blue.mp4']", "Escape");
    await page.waitForSelector("[data-clip-note='01_blue.mp4']");
    // 11 Nov 2026: the note is the card's title (larger), at most two lines ending in "…".
    const line = await page.$eval("[data-clip-note='01_blue.mp4']", (e: Element) => {
      const s = getComputedStyle(e);
      return { clamp: s.webkitLineClamp, size: parseFloat(s.fontSize), cut: (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 1, h: e.getBoundingClientRect().height };
    });
    check(line.clamp === "2" && line.size >= 14 && line.cut && line.h < 48, `Esc: the card's title, two lines ending in "…" (${JSON.stringify(line)})`);
    check((await page.getAttribute("[data-clip='01_blue.mp4']", "draggable")) === "true", "…and the card drags again");
    // A click expands it; clicking outside closes it.
    await page.click("[data-clip-note='01_blue.mp4']");
    check((await page.inputValue("[data-clip-note-input='01_blue.mp4']")) === LONG, "a click shows the whole note to edit");
    await page.mouse.click(5, 880);
    await page.waitForSelector("[data-clip-note-input]", { state: "detached" });
    check(true, "clicking outside closes it");

    // Dragging a card by its note line reorders without opening the box.
    await page.dragAndDrop("[data-clip-note='01_blue.mp4']", "[data-clip='03_green.mp4']");
    await sleep(1200);
    check(!(await page.$("[data-clip-note-input]")), "dragging a card (from its note) does not start editing");
    const moved = await order();
    check(moved.indexOf("01_blue.mp4") > 0, `…and it reorders (${moved.join(", ")})`);
    // Omit / Use: the note stays.
    await page.click("[data-omit-button='01_blue.mp4']");
    await sleep(800);
    check(((await page.textContent("[data-clip-note='01_blue.mp4']")) ?? "") === LONG, "Omit: the note stays");
    await page.click("[data-use='01_blue.mp4']");
    await sleep(500);
    // A renamed file and a reload: the note follows the clip's content.
    renameSync(path.join(paths.clips!, "01_blue.mp4"), path.join(paths.clips!, "sea at dawn.mp4"));
    await page.reload();
    await page.waitForSelector("[data-clip='sea at dawn.mp4']");
    check(((await page.textContent("[data-clip-note='sea at dawn.mp4']")) ?? "") === LONG, "a renamed file keeps its note (by its content), also after a reload");

    // Never in Shape: not in the Shots panel, the timeline or anywhere else there.
    await page.click("[data-stage=shape]");
    await page.click("[data-shape-tab=shots]");
    await page.waitForSelector("[data-shape-panel=shots]");
    await sleep(1500);
    check(!((await page.textContent("[data-shape]")) ?? "").includes("she waits by the sea"), "the note is not shown anywhere in Shape");

    // Clearing the text deletes the note.
    await page.click("[data-stage=prepare]");
    await page.click("[data-stage-tab=clips]"); // Prepare → Storyboard
    await page.click("[data-clip-note='sea at dawn.mp4']");
    await page.fill("[data-clip-note-input='sea at dawn.mp4']", "");
    await page.press("[data-clip-note-input='sea at dawn.mp4']", "Escape");
    await page.waitForSelector("[data-clip-note-add='sea at dawn.mp4']");
    await sleep(600);
    check(Object.keys(stored()).length === 0, "clearing the text deletes the note");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    // The card reads as a story (11 Nov 2026): no file name, duration or Remove on it; they are in its ⋯ menu (and the
    // file name in the tooltip); a warning only when something is wrong (these test clips are 216×384: low resolution).
    const card = (await page.textContent("[data-clip='03_green.mp4']")) ?? "";
    check(!card.includes("03_green.mp4") && !/\d+\.\d s/.test(card) && !card.includes("Remove") && (await page.getAttribute("[data-clip='03_green.mp4']", "title")) === "03_green.mp4", `the card shows no file name, duration or Remove; the file name is its tooltip (${card})`);
    check(((await page.textContent("[data-clip-warning='03_green.mp4']")) ?? "").startsWith("low resolution (216×384)"), "a small warning when something is wrong: low resolution");
    await page.click("[data-card-menu='03_green.mp4']");
    const details = await page.$$eval("[data-card-detail]", (e: Element[]) => e.map((x) => x.textContent));
    check(details[0] === "03_green.mp4" && /216×384/.test(details[1] ?? "") && !!(await page.$("[role=menuitem][data-remove='03_green.mp4']")), `its ⋯ menu: file name, duration and size, Remove (${details.join(" | ")})`);
    await page.keyboard.press("Escape");
    // Story idea: one sentence for the whole video, saved per song (with the notes, for you only), kept after a reload.
    await page.fill("[data-story-idea-input]", "Two people find each other again in the rain.");
    await page.press("[data-story-idea-input]", "Enter");
    await page.waitForSelector("[data-story-idea] >> text=✓ Saved");
    await page.reload();
    await page.waitForSelector("[data-story-idea-input]");
    const notesFile = JSON.parse(readFileSync(path.join(paths.root, ".studio", "clip-notes.json"), "utf8")) as { storyIdea?: string };
    if (process.env.STORY_SHOT) await page.screenshot({ path: process.env.STORY_SHOT });
    check((await page.inputValue("[data-story-idea-input]")) === "Two people find each other again in the rain." && notesFile.storyIdea === "Two people find each other again in the rain.", "the story idea is kept for the song (.studio\\clip-notes.json), also after a reload");
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
