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
  // A finished Animate take of that picture, not sent to the Storyboard yet (Take 1).
  mkdirSync(path.join(pictures, "takes"), { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=5", "-pix_fmt", "yuv420p", path.join(pictures, "takes", "singer close take 1.mp4"));
  writeFileSync(path.join(pictures, "pictures.json"), JSON.stringify({ pictures: { "singer close.png": { takes: [{ n: 1, service: "wavespeed", quality: "standard", model: "Seedance 2.5 Flash", status: "done", started_at: new Date().toISOString(), ended_at: new Date().toISOString(), cost_usd: 1.08, seconds: 5, file: "takes/singer close take 1.mp4", playable: true }] } } }));
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
    // "N lines to check by ear" follows at once when a line is marked Checked by ear (the bug of 21 Nov 2026: it stayed).
    check(((await page.textContent("[data-todo-item='listen']").catch(() => "")) ?? "").includes("line 2"), "Prepare lists line 2 to check by ear");
    await page.click("tr[data-line='2'] [data-ear='off']");
    const banner = await page.waitForFunction(() => !document.querySelector("[data-todo-item='listen']"), null, { timeout: 15_000 }).then(() => true).catch(() => false);
    check(banner, "marked Checked by ear: the banner no longer lists it, without reloading the page");
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
    check(/1 line where the singer shows · to make: 1 take \(\d+ s of voice at 720p, about \$\d+\.\d\d\)/.test(summary), `the cost shows before anything is sent (${summary})`);
    check(((await page.textContent("[data-singer]")) ?? "").includes("the song itself"), "without a vocal stem, the song itself is the voice (said plainly)");

    check(((await page.textContent("[data-singer-line='2'] [data-singer-mood-hint]")) ?? "").includes("Describe the face and mouth, not the voice"), "the mood box says what to write (the face and mouth, not the voice)");
    check((await page.inputValue("[data-singer-resolution]")) === "720p" && summary.includes("at 720p"), "singing clips are made at 720p unless chosen otherwise; the cost says so");
    // The block's little script (what the singer does): saved, sent with the voice.
    await page.fill("[data-singer-script='2']", "turns to the sea, soft smile");
    await page.press("[data-singer-script='2']", "Enter");
    for (let i = 0; i < 20 && !(JSON.parse(readFileSync(path.join(pictures, "singer.json"), "utf8")) as { scripts?: Record<string, string> }).scripts?.["2"]; i++) await page.waitForTimeout(200);
    check((JSON.parse(readFileSync(path.join(pictures, "singer.json"), "utf8")) as { scripts?: Record<string, string> }).scripts?.["2"] === "turns to the sea, soft smile", "the singer's little script is saved for the block (pictures\\singer.json)");
    await page.click("[data-singer-make]");
    // The takes panel opens on the line being made (Paul, 21 Nov 2026: no need to go to Creation to watch it).
    await page.waitForSelector("[data-singer-panel='2']", { timeout: 15_000 });
    check(((await page.textContent("[data-singer-panel='2']")) ?? "").includes("Line 2"), "Make opens the takes panel on line 2");
    await page.waitForSelector("[data-singer-line='2'] [data-singer-status=done]", { timeout: 90_000 });
    check(true, "the singing clip is made");
    await page.waitForSelector("[data-singer-panel='2'] [data-singer-take] [data-singer-take-play]", { timeout: 15_000 });
    check(((await page.textContent("[data-singer-panel='2']")) ?? "").includes("Jump to Creation"), "the panel lists the take, ready to play, with Jump to Creation");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-singer-panel]", { state: "detached", timeout: 5_000 });
    await page.click("[data-singer-show-takes='2']");
    await page.waitForSelector("[data-singer-panel='2']", { timeout: 5_000 });
    await page.click("[data-singer-panel-close]");
    check(!(await page.$("[data-singer-panel]")), "Esc and ✕ close the panel; Takes opens it again");
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
    check(((await page.textContent("[data-singer-line='2'] [data-singer-take-state='in-use']")) ?? "").includes("In use"), "its take is listed under the line, marked In use");

    // Retake (Paul, 21 Nov 2026): the same lines again at 480p with a new mood, sent straight from the mood box.
    await page.selectOption("[data-singer-resolution]", "480p");
    await page.waitForFunction(() => (document.querySelector("[data-singer-retake='2']") as HTMLElement | null)?.title.includes("480p"), null, { timeout: 15_000 });
    check((JSON.parse(readFileSync(path.join(pictures, "singer.json"), "utf8")) as { resolution?: string }).resolution === "480p", "the resolution is saved for this video (pictures\\singer.json)");
    await page.fill("[data-singer-script='2']", "singing clearly, precise lip shapes");
    await page.click("[data-singer-retake='2']"); // the mood box loses focus as Retake is pressed: it is saved first
    await page.waitForSelector("[data-singer-line='2'] [data-singer-take-state='new']", { timeout: 90_000 });
    check(!!(await page.$("[data-singer-panel='2'] [data-singer-take-state='new']")), "Retake opens the takes panel, where the new take waits as New — compare");
    await page.keyboard.press("Escape");
    const takes = (JSON.parse(readFileSync(path.join(pictures, "pictures.json"), "utf8")) as { pictures: Record<string, { takes: { n: number; kind?: string; prompt?: string; resolution?: string; fresh?: boolean; file?: string }[] }> }).pictures["singer close.png"].takes.filter((t) => t.kind === "lipsync");
    const retake = takes.at(-1)!;
    check(takes.length === 2 && retake.resolution === "480p" && retake.prompt === "singing clearly, precise lip shapes" && retake.fresh === true, `the retake is a new take with the mood and resolution of now; the first take stays (${JSON.stringify(takes.map((t) => [t.n, t.resolution, t.prompt]))})`);
    const kept = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number; clip: string }[] }).anchors?.find((x) => x.line === 2);
    check(kept?.clip === "singer close sings line 2.mp4", `the retake does not replace the take in use (${kept?.clip})`);
    check(((await page.textContent("[data-singer-line='2'] [data-singer-take-state='new']")) ?? "").includes("New — compare") && ((await page.textContent("[data-singer-summary]")) ?? "").includes("all made"), "it is marked New — compare; nothing is left to make (the count follows the take sent)");
    const facts = (await page.textContent(`[data-singer-line='2'] [data-singer-take='${retake.n}'] [data-singer-take-facts]`)) ?? "";
    check(/\d\d:\d\d.* · about \$\d+\.\d\d · 480p$/.test(facts), `each take shows its date, cost and resolution (${facts})`);
    // ▶ plays the take with the song from the group's start.
    await page.click(`[data-singer-line='2'] [data-singer-take='${retake.n}'] [data-singer-take-play]`);
    await page.waitForSelector("[data-singer-player] video");
    const player = await page.$eval("[data-singer-player]", (e: Element) => ({ video: (e.querySelector("video") as HTMLVideoElement).src, song: (e.querySelector("audio") as HTMLAudioElement).src, text: e.textContent ?? "" }));
    check(player.video.includes("sings%20line%202") && player.song.includes("A%20Heart%20For%20Two") && /With the song from 1:0\d\.\d/.test(player.text), `the take plays with the song from the group's start (${JSON.stringify(player)})`);
    await page.click("[data-singer-player-close]");
    // Use this take: the line switches at once (nothing is made again); the first take goes to Omit.
    await page.click(`[data-singer-line='2'] [data-singer-take='${retake.n}'] [data-singer-take-use]`);
    await page.waitForSelector(`[data-singer-line='2'] [data-singer-take='${retake.n}'][data-singer-take-state='in-use']`, { timeout: 15_000 });
    const switched = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number }[] }).anchors?.find((x) => x.line === 2);
    const clipsNow = (JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { clips: Record<string, { omit?: boolean }> }).clips;
    const lipsyncCount = (JSON.parse(readFileSync(path.join(pictures, "pictures.json"), "utf8")) as { pictures: Record<string, { takes: { kind?: string }[] }> }).pictures["singer close.png"].takes.filter((t) => t.kind === "lipsync").length;
    check(switched?.clip !== "singer close sings line 2.mp4" && switched?.sync === a?.sync && clipsNow["singer close sings line 2.mp4"]?.omit === true && lipsyncCount === 2, `Use this take puts it on the line at once, in time with the song; the other goes to Omit; nothing new is made (${JSON.stringify(switched)})`);
    // The clip picker opens in a dialog that is fully in view, and a plain clip on a singing line asks first (dismissed: the singer stays).
    await page.click("tr[data-line='2'] [data-anchor-pick]");
    await page.waitForSelector("[data-anchor-picker] [data-anchor-clip]");
    const pickBox = await page.$eval("[data-anchor-picker]", (e: Element) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: window.innerHeight }; });
    check(pickBox.top >= 0 && pickBox.bottom <= pickBox.h, `the clip picker is fully inside the window (${JSON.stringify(pickBox)})`);
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
    await page.locator("[data-anchor-picker] [data-anchor-clip]").first().dblclick();
    await page.waitForTimeout(500);
    const stillSinging = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number; sync?: number }[] }).anchors?.find((x) => x.line === 2);
    check(asked.includes("removes the singer") && stillSinging?.sync !== undefined && (await page.locator("[data-anchor-picker]").count()) === 1, `a plain clip on a singing line asks first; dismissing keeps the singer (${asked.slice(0, 60)})`);
    await page.click("[data-anchor-picker] button:has-text('Cancel')");
    await page.waitForFunction(() => !document.querySelector("[data-anchor-picker]"));
    const unsent = (JSON.parse(readFileSync(path.join(pictures, "pictures.json"), "utf8")) as { pictures: Record<string, { takes: { n: number; sent?: string }[] }> }).pictures["singer close.png"].takes.find((t) => t.n === 1);
    check(!unsent?.sent, "dismissing the question sent nothing to the Storyboard");

    // Accepting the question: the singing clip leaves line 2, and Who sings follows at once (no page reload): the take is
    // no longer In use and offers Use this take; pressing it brings the singer back.
    const inUseTake = await page.getAttribute("[data-singer-line='2'] [data-singer-take-state='in-use']", "data-singer-take");
    await page.click("tr[data-line='2'] [data-anchor-pick]");
    await page.waitForSelector("[data-anchor-picker] [data-anchor-clip]");
    page.once("dialog", (d) => { void d.accept(); });
    await page.locator("[data-anchor-picker] [data-anchor-clip]:not([data-anchor-clip^='creation:'])").first().dblclick();
    await page.waitForFunction(() => !document.querySelector("[data-anchor-picker]"), null, { timeout: 15_000 });
    await page.waitForSelector(`[data-singer-line='2'] [data-singer-take='${inUseTake}'] [data-singer-take-use]`, { timeout: 15_000 });
    const inUseAfter = await page.locator("[data-singer-line='2'] [data-singer-take-state='in-use']").count();
    const offAnchor = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number; sync?: number }[] }).anchors?.find((x) => x.line === 2);
    check(inUseAfter === 0 && offAnchor?.sync === undefined, `after a plain clip replaces the singer on line 2, Who sings shows no take In use and offers Use this take for take ${inUseTake} (in use ${inUseAfter})`);
    await page.click(`[data-singer-line='2'] [data-singer-take='${inUseTake}'] [data-singer-take-use]`);
    await page.waitForSelector(`[data-singer-line='2'] [data-singer-take='${inUseTake}'][data-singer-take-state='in-use']`, { timeout: 15_000 });
    const backAnchor = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number; sync?: number }[] }).anchors?.find((x) => x.line === 2);
    check(backAnchor?.sync !== undefined, "Use this take puts the singing clip back on line 2 (song.json)");

    // Show a take, not a clip (Paul, 21 Nov 2026): the picker lists Creation's takes as takes; singing takes are not offered;
    // a take not in the Storyboard yet is sent there and placed in one step.
    await page.click("tr[data-line='1'] [data-anchor-pick]");
    await page.waitForSelector("[data-anchor-picker] [data-anchor-group='creation']");
    const tile = (await page.textContent("[data-anchor-picker] [data-anchor-clip='creation:singer close.png#1']")) ?? "";
    const groupsShown = await page.$$eval("[data-anchor-picker] [data-anchor-group]", (es: Element[]) => es.map((e) => e.getAttribute("data-anchor-group")));
    const singingOffered = await page.$$eval("[data-anchor-picker] [data-anchor-clip]", (es: Element[]) => es.map((e) => e.getAttribute("data-anchor-clip") ?? "").filter((n) => / sings /.test(n)));
    check(tile.includes("Take 1") && tile.includes("Close up") && groupsShown[0] === "creation" && !singingOffered.length, `the picker shows Creation's takes first, as takes (${tile}; groups ${groupsShown.join(", ")}); no singing take is offered (${singingOffered.join(", ")})`);
    await page.dblclick("[data-anchor-picker] [data-anchor-clip='creation:singer close.png#1']");
    await page.waitForFunction(() => document.querySelector("tr[data-line='1'] [data-anchor-cell]")?.textContent?.includes("Take 1"), null, { timeout: 15_000 });
    const placed = (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { anchors?: { line: number; clip: string; sync?: number }[] }).anchors?.find((x) => x.line === 1);
    const sentNow = (JSON.parse(readFileSync(path.join(pictures, "pictures.json"), "utf8")) as { pictures: Record<string, { takes: { n: number; sent?: string }[] }> }).pictures["singer close.png"].takes.find((t) => t.n === 1)?.sent;
    check(placed?.clip === "singer close take 1.mp4" && placed.sync === undefined && sentNow === "singer close take 1.mp4" && existsSync(path.join(paths.clips!, "singer close take 1.mp4")), `choosing the take sends it to the Storyboard and puts it on line 1 (${JSON.stringify(placed)})`);
    check(((await page.textContent("tr[data-line='1'] [data-anchor-cell]")) ?? "").includes("Close up · Take 1"), "the line names it as a take: Close up · Take 1");
    await page.selectOption("[data-singer-resolution]", "720p");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    // A block: the same picture on line 3 too -> one take over lines 2-3; it replaces the line-2 take by itself.
    await page.click("[data-singer-line='3'] [data-singer-source]");
    await page.click("[data-singer-picker='3'] [data-singer-option='singer close.png']");
    await page.waitForFunction(() => document.querySelector("[data-singer-line='3']")?.textContent?.includes("sung with line 2 take"), null, { timeout: 15_000 });
    check(((await page.textContent("[data-singer-summary]")) ?? "").includes("to make: 1 take"), "lines in a row with the same picture: one take to make");
    await page.click("[data-singer-make]");
    await page.waitForFunction(() => document.querySelector("tr[data-line='3'] [data-anchor-continues='2']"), null, { timeout: 60_000 });
    await page.keyboard.press("Escape"); // the takes panel
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

    // A line with takes says they are in Creation too; the link opens Creation on the picture they were made from.
    check(((await page.textContent("[data-singer-line='2'] [data-singer-creation-note]")) ?? "").includes("to see and pick your takes"), "the line says its takes can be seen and picked in Creation");
    await page.click("[data-singer-line='2'] [data-singer-to-creation]");
    await page.waitForSelector("[data-picture='singer close.png'] [data-take]", { state: "visible", timeout: 15_000 });
    check(true, "Jump to Creation opens Creation on the picture card with its takes");
    await page.goto(`${base}/songs/${sp.project.id}?tab=lyrics`);
    await page.waitForSelector("[data-singer-line='2'] [data-singer-source]");

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
    // The picture card shows every take (line 2 now has no singer, so none is in use: each can be chosen again).
    const card = await page.$$eval("[data-picture='singer close.png'] [data-take]", (rows: Element[]) => rows.map((r) => `${r.getAttribute("data-take")}:${r.querySelector("[data-take-badge]")?.getAttribute("data-take-badge") ?? "-"}:${r.querySelector("[data-take-use]") ? "use" : "-"}`));
    check(card.length === 4 && card.filter((c) => c.endsWith(":-:use")).length === 3, `the Creation card lists all takes with In use / Use this take (${card.join(", ")})`);
    check(((await page.textContent("[data-picture='singer close.png'] [data-take='1'] [data-take-on]")) ?? "").includes("On line 1"), "the Creation card says where a take shows: On line 1");
    // ▶ in Creation plays a take with the song (Paul, 21 Nov 2026: "else I need to juggle back to Shape"): a singing take
    // from its own first frame, an Animate take on a line from where the line cuts to it.
    const sungTake = (JSON.parse(readFileSync(path.join(pictures, "pictures.json"), "utf8")) as { pictures: Record<string, { takes: { n: number; kind?: string; line?: number; through?: number; sync_ms?: number; status: string }[] }> }).pictures["singer close.png"].takes.find((t) => t.kind === "lipsync" && t.line === 2 && !t.through && t.status === "done")!;
    await page.click(`[data-picture='singer close.png'] [data-take='${sungTake.n}'] [data-take-play]`);
    await page.waitForSelector("[data-take-player] [data-with-song='on'] [data-with-song-audio]", { state: "attached" });
    await page.waitForTimeout(1500);
    const heard = await page.$eval("[data-take-player]", (e: Element) => ({ song: (e.querySelector("audio") as HTMLAudioElement).src, at: (e.querySelector("audio") as HTMLAudioElement).currentTime, why: e.querySelector("[data-with-song-why]")?.textContent ?? "" }));
    check(heard.song.includes("A%20Heart%20For%20Two") && heard.at >= sungTake.sync_ms! / 1000 - 0.2 && heard.at < sungTake.sync_ms! / 1000 + 5 && /with the song from 1:05\.8/.test(heard.why), `a singing take plays with the song from its first frame (${JSON.stringify(heard)})`);
    await page.keyboard.press("Escape");
    await page.click("[data-picture='singer close.png'] [data-take='1'] [data-take-play]");
    await page.waitForSelector("[data-take-player] [data-with-song-why]");
    const onLine = (await page.textContent("[data-take-player] [data-with-song-why]")) ?? "";
    check(/with the song from 1:0\d\.\d, where line 1 cuts to it/.test(onLine), `an Animate take on a line plays with the song from that line's cut (${onLine})`);
    await page.keyboard.press("Escape");
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
