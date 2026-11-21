// Browser test of Lyrics Sync → Singer (21 Nov 2026; needs a studio build, FFmpeg and Playwright; WaveSpeed is a
// stand-in: LYRIC_GENERATE_STUB, nothing is sent anywhere):
//   npx tsx apps/studio/e2e/singer.e2e.ts
// A picture in Creation; line 2 gets the singer (the Singer column's dropdown, saved in pictures\singer.json); the
// cost shows before sending; "Make singing clips" makes the clip, which comes back into Creation (no sound), the end
// of the Storyboard, and onto line 2 as an anchor locked to the song (song.json "sync"); nothing is made twice.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, probeMedia, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, songPathsById, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-singer-"));
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

const LRC = [
  "[01:05.00]<01:05.00>The verse <01:06.00>line <01:08.40>",
  "[01:08.50]<01:08.50>You <01:10.40>had <01:10.70>a <01:10.90>heart <01:11.20>for <01:11.50>two <01:12.50>",
  "[01:13.00]<01:13.00>Next <01:13.60>verse <01:14.40>",
  "[01:20.00]",
].join("\n");

async function main() {
  const song = path.join(root, "A Heart For Two.wav");
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=90", song]);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  writeFileSync(paths.lyricsTxt, "The verse line\n* You had a heart for two\nNext verse\n");
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, `${LRC}\n`);
    const lines = ["The verse line", "You had a heart for two", "Next verse"].map((text, i) => ({ number: i + 1, text, is_hook: i === 1, start_ms: [65_000, 68_500, 73_000][i], end_ms: [68_400, 72_500, 74_400][i], confidence: 0.9 }));
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines }));
  };
  const p = ws.db.select().from(project).where(eq(project.id, sp.project.id)).get()!;
  const stored = await ensureAlignment(ws, { ...sp, project: p }, { lyricsTxt: paths.lyricsTxt, durationMs: 90_000, align: aligner });
  writeFileSync(
    path.join(path.dirname(stored.lrcFile), `guard-${stored.lrcHash.slice(0, 12)}.json`),
    JSON.stringify({ moves: [], check: { level_db: -14, threshold_db: -29, words_check: "ran", lines: [{ number: 2, text: "You had a heart for two", stamp_ms: 68_500, voice_ms: null, words_ms: 70_050, words_text: "You had a", duration_ms: 68_500, first_word_ms: 1_900, loudest_before_db: null, stamp_level_db: -40, target_ms: 68_500, agree: [], why: "only words 1:10.1 (+1.6 s); no second signal agrees", result: "flagged for review" }] } }),
  );
  mkdirSync(paths.clips!, { recursive: true });
  for (const name of ["01_hands.mp4", "02_rings.mp4"]) ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=4", "-pix_fmt", "yuv420p", path.join(paths.clips!, name));
  const pictures = path.join(paths.root, "pictures");
  mkdirSync(pictures, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=pink:s=216x384", "-frames:v", "1", path.join(pictures, "singer close.png"));
  ws.close();

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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/songs/${sp.project.id}?tab=lyrics`);
    await page.waitForSelector("[data-singer]");
    // A short name for the picture (Creation → Rename): the pickers show it; the file keeps its name.
    await fetch(`${base}/api/songs/${sp.project.id}/pictures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "label", file: "singer close.png", label: "Close up" }) });
    await page.reload();
    await page.waitForSelector("[data-singer-line='2'] [data-singer-source]");
    check(((await page.textContent("[data-singer-summary]")) ?? "").includes("Choose a picture or video"), "the Singer bar says what to do");
    await page.click("[data-singer-line='2'] [data-singer-source]");
    await page.waitForSelector("[data-singer-picker='2'] [data-singer-option='singer close.png'] img");
    check(((await page.textContent("[data-singer-picker='2'] [data-singer-option='singer close.png']")) ?? "").includes("Close up"), "the Singer picker shows each picture with its thumbnail and short name");
    await page.click("[data-singer-picker='2'] [data-singer-option='singer close.png']");
    await page.waitForSelector("[data-singer-line='2'] [data-singer-status=todo]");
    const settings = JSON.parse(readFileSync(path.join(pictures, "singer.json"), "utf8")) as { lines: Record<string, string> };
    check(settings.lines["2"] === "singer close.png", "line 2 is a singing line, sung from its picture (pictures\\singer.json)");
    const summary = (await page.textContent("[data-singer-summary]")) ?? "";
    check(/1 line where the singer shows · to make: 1 take \(\d+ s of voice, about \$\d+\.\d\d\)/.test(summary), `the cost shows before anything is sent (${summary})`);
    check(((await page.textContent("[data-singer]")) ?? "").includes("the song itself"), "without a vocal stem, the song itself is the voice (said plainly)");

    // The block's little script (what the singer does): saved, sent with the voice.
    await page.fill("[data-singer-script='2']", "turns to the sea, soft smile");
    await page.press("[data-singer-script='2']", "Enter");
    for (let i = 0; i < 20 && !(JSON.parse(readFileSync(path.join(pictures, "singer.json"), "utf8")) as { scripts?: Record<string, string> }).scripts?.["2"]; i++) await page.waitForTimeout(200);
    check((JSON.parse(readFileSync(path.join(pictures, "singer.json"), "utf8")) as { scripts?: Record<string, string> }).scripts?.["2"] === "turns to the sea, soft smile", "the singer's little script is saved for the block (pictures\\singer.json)");
    await page.click("[data-singer-make]");
    await page.waitForSelector("[data-singer-line='2'] [data-singer-status=done]", { timeout: 90_000 });
    check(true, "the singing clip is made");
    const recipe = JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number }[] };
    const a = recipe.anchors?.find((x) => x.line === 2);
    check(a?.clip === "singer close sings line 2.mp4" && typeof a.sync === "number" && a.sync > 60 && a.sync < 68.5, `it lands on line 2, locked to the song (${JSON.stringify(a)})`);
    const order = (JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { order: string[] }).order;
    check(order.at(-1) === "singer close sings line 2.mp4", `it joins the end of the Storyboard (${order.join(", ")})`);
    const labels = (JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { clips: Record<string, { label?: string }> }).clips;
    check(labels["singer close sings line 2.mp4"]?.label === "Close up sings line 2", "the clip carries a short name into the Storyboard (Close up sings line 2)");
    const take = path.join(pictures, "takes", "singer close sings line 2.mp4");
    const sung = (JSON.parse(readFileSync(path.join(pictures, "pictures.json"), "utf8")) as { pictures: Record<string, { takes: { kind?: string; prompt?: string }[] }> }).pictures["singer close.png"].takes.find((t) => t.kind === "lipsync");
    check(sung?.prompt === "turns to the sea, soft smile" && (sung as { style?: number }).style === 1, "the script went with the voice, after the singing cue (the take records it)");
    check(existsSync(take) && !(await probeMedia(take)).hasAudio, "it is in Creation, without sound (the voice is never kept)");
    const landed = await page.waitForFunction(() => document.querySelector("tr[data-line='2'] [data-anchor-cell]")?.textContent?.includes("Close up sings line 2"), null, { timeout: 15_000 }).then(() => true).catch(() => false);
    check(landed, `the line's Lands on shows the singing clip by its short name (${await page.textContent("tr[data-line='2'] [data-anchor-cell]")})`);
    check(((await page.textContent("[data-singer-summary]")) ?? "").includes("all made"), "nothing left to make: a line is never paid for twice");
    // A long file name never pushes the Singer column out of view (Paul, 21 Nov 2026).
    const box = await page.$eval("[data-singer-line='2'] [data-singer-source]", (e: Element) => { const r = e.getBoundingClientRect(); const c = document.querySelector("[data-lines-scroll]")!.getBoundingClientRect(); return { right: r.right, edge: c.right }; });
    check(box.right <= box.edge, `the Singer column is in view without scrolling sideways (${Math.round(box.right)} ≤ ${Math.round(box.edge)})`);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    // A block: the same picture on line 3 too -> one take over lines 2-3; it replaces the line-2 take by itself.
    await page.click("[data-singer-line='3'] [data-singer-source]");
    await page.click("[data-singer-picker='3'] [data-singer-option='singer close.png']");
    await page.waitForFunction(() => document.querySelector("[data-singer-line='3']")?.textContent?.includes("sung with line 2 take"), null, { timeout: 15_000 });
    check(((await page.textContent("[data-singer-summary]")) ?? "").includes("to make: 1 take"), "lines in a row with the same picture: one take to make");
    await page.click("[data-singer-make]");
    await page.waitForFunction(() => document.querySelector("tr[data-line='3'] [data-anchor-continues='2']"), null, { timeout: 60_000 });
    const block = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number; through?: number }[] }).anchors ?? [];
    const singing = block.filter((x) => x.sync !== undefined);
    const firstOmitted = (JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { clips: Record<string, { omit?: boolean }> }).clips["singer close sings line 2.mp4"]?.omit;
    check(singing.length === 1 && singing[0].line === 2 && singing[0].through === 3 && singing[0].clip === "singer close sings lines 2-3.mp4" && firstOmitted === true, `the block take replaces the line-2 take by itself, placed once (${JSON.stringify(singing)}; old one set to Omit: ${firstOmitted})`);

    // The Tasks menu lists the singing takes: song, lines, model, length, cost, when; a link back to Lyrics Sync.
    if (!(await page.$("[data-tasks]"))) await page.click("[data-tasks-button]");
    await page.waitForSelector("[data-take-task='singing']", { timeout: 15_000 });
    const task = (await page.textContent("[data-take-task='singing']")) ?? "";
    check(/Singing · lines 2-3/.test(task) && /InfiniteTalk/.test(task) && /\d+ s · about \$\d+\.\d\d/.test(task) && /done/.test(task), `the Tasks menu shows the singing take with its model, length and cost (${task})`);
    await page.keyboard.press("Escape");

    // Wrong picture: "no singer on this line" takes the singing clip off the line and sets it to Omit (kept).
    await page.click("[data-singer-line='2'] [data-singer-source]");
    await page.click("[data-singer-picker='2'] [data-singer-option='']");
    await page.waitForFunction(() => !document.querySelector("tr[data-line='2'] [data-anchor-cell]")?.textContent?.includes("Close up"), null, { timeout: 15_000 });
    const after = JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number }[] };
    const omitted = (JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { clips: Record<string, { omit?: boolean }> }).clips["singer close sings line 2.mp4"]?.omit;
    check(!after.anchors?.some((x) => x.line === 2 || x.line === 3) && omitted === true && existsSync(path.join(paths.clips!, "singer close sings line 2.mp4")), "No singer on a line: its singing clip leaves the line and is set to Omit (kept, out of its line its lips would be out of time)");

    await page.goto(`${base}/songs/${sp.project.id}?tab=production`);
    await page.waitForSelector("[data-take-source]");
    check(((await page.textContent("[data-picture='singer close.png'] [data-take-source]")) ?? "").includes("lip sync, line"), "Creation labels it: lip sync, line …");
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
