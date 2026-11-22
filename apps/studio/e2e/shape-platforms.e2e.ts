// Browser test: Shape lists every platform with a saved shot plan (22 Nov 2026; needs a studio build, FFmpeg and
// Playwright with Chromium):   npx tsx apps/studio/e2e/shape-platforms.e2e.ts
// Make set to YouTube only used to hide the Reel in Shape. Now Shape still lists Reels while its shot plan is saved,
// marked "not selected in Make", and opens it.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, readRecipe, songPathsById, writeRecipe, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";
import { openTab } from "./stage-tabs";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-shape-platforms-"));
const wsDir = path.join(root, "workspace");
const port = 3204;
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
  // The same song as storyboard.e2e.ts: clips of its own and a stored lyric timing (a shot plan never aligns).
  const songFile = path.join(root, "Wedding Day.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)+0.9*sin(2*PI*55*t)*exp(-12*mod(t-0.25,2))*gte(t,0.25)':s=44100:d=14", "-ac", "2", songFile);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, songFile);
  const id = sp.project.id;
  const paths = songPathsById(ws, id);
  writeFileSync(paths.lyricsTxt, `${TEXTS.map((t, i) => (i === 1 || i === 4 ? `* ${t}` : t)).join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [name, colour] of [["01_a.mp4", "blue"], ["02_b.mp4", "yellow"], ["03_c.mp4", "red"]] as const) {
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=4", "-vf", `drawbox=c=${colour}@0.6:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(paths.clips!, name));
  }
  const recipe = paths.recipe!;
  writeFileSync(recipe, JSON.stringify({ platforms: ["reels", "youtube"] }));
  const lrc = TEXTS.map((t, i) => `[${stamp(STARTS[i])}]${t.split(" ").map((w, k) => `<${stamp(STARTS[i] + k * 300)}>${w}`).join(" ")} <${stamp(STARTS[i] + 1200)}>`).join("\n");
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, `${lrc}\n[00:13.00]\n`);
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: TEXTS.map((text, i) => ({ number: i + 1, text, is_hook: i === 1 || i === 4, start_ms: STARTS[i], end_ms: STARTS[i] + 1200, confidence: 0.9, low_confidence: false })) }));
  };
  const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
  await ensureAlignment(ws, { ...sp, project: p }, { lyricsTxt: paths.lyricsTxt, durationMs: 14_000, align: aligner });

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
    // The Reel's shot plan is saved the first time Shape plans it.
    const plan = await fetch(`${base}/api/songs/${id}/storyboard?platform=reels&video=v1`).then((r) => r.json());
    const reelPlan = path.join(paths.root, "storyboards", "reels-1.json");
    check(!plan.error && existsSync(reelPlan), `Shape planned the Reel and saved its shot plan${plan.error ? ` (${plan.error})` : ""}`);

    // Make: YouTube only.
    writeRecipe(recipe, { ...readRecipe(recipe), platforms: ["youtube"] });
    const choices = await fetch(`${base}/api/songs/${id}/storyboard`).then((r) => r.json());
    const listed = (choices.platforms ?? []).map((p: { name: string; notInMake?: boolean }) => `${p.name}${p.notInMake ? "*" : ""}`);
    check(JSON.stringify(listed) === JSON.stringify(["youtube", "reels*"]), `Shape's list: YouTube, then Reels marked (${listed.join(", ")})`);

    const browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${base}/songs/${id}`);
    await openTab(page, "Shape");
    await page.click("[data-shape-tab=shots]").catch(() => {});
    await page.waitForSelector("[data-storyboard-platform]", { timeout: 60_000 });
    const options = await page.$$eval("[data-storyboard-platform] option", (e: Element[]) => e.map((x) => (x.textContent ?? "").trim()));
    check(JSON.stringify(options) === JSON.stringify(["YouTube", "Reels · not selected in Make"]), `the dropdown: ${options.join(" | ")}`);
    await page.selectOption("[data-storyboard-platform]", "reels");
    let status = "";
    for (let i = 0; i < 180 && !/Reels v1 planned/.test(status); i++) {
      status = (await page.textContent("[data-work-status=shape]").catch(() => "")) ?? "";
      await sleep(500);
    }
    check(/Reels v1 planned/.test(status), `choosing it opens the Reel's plan (${status.trim()})`);
    if (process.env.SHAPE_SHOT) await page.screenshot({ path: process.env.SHAPE_SHOT });
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
