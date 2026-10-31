// Browser test of the Storyboard tab, stages 1 and 2 (needs a studio build, FFmpeg, the audio service's
// Python and Playwright, as the others):  pnpm test:e2e
// A 14 s click track at 120 BPM, six lines, four clips (one only 1 s long), and two anchors in song.json:
// line 4 on 02_b.mp4 (dissolve) inside the section, line 6 outside it. The plan (a dry run: nothing is
// rendered or written) shows bars, the waveform, the lines with ⚓, the shots with badges and warnings,
// the anchor left outside; clicking the timeline plays the preview from there. Stage 2: moving a clip in
// the story strip re-plans and is kept in clips.json, the clip editor's best moment and speed re-plan,
// dragging a clip onto a lyric line anchors it (song.json); the Style tab's tempo (x2/3) re-plans.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, loadTheme, readRecipe, songPathsById, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";
import { openPanel, saveTheme, unfoldStyle } from "./stage-tabs";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-storyboard-"));
const wsDir = path.join(root, "workspace");
const port = 3195;
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

async function main() {
  process.env.WORKSPACE_DIR = wsDir;
  const song = path.join(root, "Story Test.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)+0.9*sin(2*PI*55*t)*exp(-12*mod(t-0.25,2))*gte(t,0.25)':s=44100:d=14", "-ac", "2", song);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  writeFileSync(paths.lyricsTxt, `${TEXTS.map((t, i) => (i === 1 || i === 4 ? `* ${t}` : t)).join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [name, seconds, colour] of [["01_a.mp4", 4, "blue"], ["02_b.mp4", 4, "yellow"], ["03_c.mp4", 4, "red"], ["04_d.mp4", 1, "green"]] as const) {
    ffmpeg("-f", "lavfi", "-i", `testsrc2=s=216x384:r=30:d=${seconds}`, "-vf", `drawbox=c=${colour}@0.6:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(paths.clips!, name));
  }
  writeFileSync(paths.recipe!, JSON.stringify({ platforms: ["reels"], section: "0:02-0:10", anchors: [{ line: 4, clip: "02_b.mp4", transition: "dissolve" }, { line: 6, clip: "03_c.mp4" }] }));
  // The stored alignment (as pnpm align would leave it): a storyboard never aligns.
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e: Error) => pageErrors.push(e.message));
    await page.goto(`${base}/songs/${sp.project.id}?tab=storyboard`); // an old link: opens the Shape page
    await page.waitForSelector("[data-storyboard-show]");
    check((await page.inputValue("[data-storyboard-platform]")) === "reels", "the plan for Reels (the recipe's platform) is offered");
    await page.waitForSelector("[data-shot='1']", { timeout: 180_000 }); // planned on opening, no Show button to press
    check(!!(await page.$("[data-viewer] .__remotion-player, [data-viewer] video, [data-viewer] div")), "the viewer plays the planned video");
    const [vb, tl] = await Promise.all(["[data-viewer]", "[data-storyboard-timeline]"].map(async (sel) => (await page.$(sel))!.boundingBox()));
    check(!!vb && !!tl && vb.y + vb.height <= tl.y && tl.width > 900, `top to bottom: the viewer, then the soundtrack and shots across the editor (${JSON.stringify(tl)})`);
    // One screen: the viewer, the timeline, then one command bar (which video, the transport, zoom, verdict, Next).
    const fits = async () => {
      const [v, t, c] = await Promise.all(["[data-viewer]", "[data-storyboard-timeline]", "[data-command-bar]"].map(async (sel) => (await page.$(sel))!.boundingBox()));
      return { ok: !!v && !!t && !!c && v.y + v.height <= t.y && t.y + t.height <= c.y && c.y + c.height <= 1000, v, t, c };
    };
    const fit9 = await fits();
    check(fit9.ok, `9:16: viewer, timeline and command bar all on one 1440×1000 screen (${JSON.stringify(fit9.c)})`);
    const inBar = await page.$$eval("[data-command-bar] [data-storyboard-source], [data-command-bar] [data-storyboard-platform], [data-command-bar] [data-transport], [data-command-bar] [data-follow-playback], [data-command-bar] [data-next-make]", (e: Element[]) => e.length);
    check(inBar === 5, `the command bar holds Show / Platform, the transport, Follow / Zoom and Next: Make (${inBar} of 5)`);
    check(!(await page.$("[data-viewer-block] [data-transport]")), "nothing between the viewer and the timeline");
    check(!(await page.$("[data-story-strip]")), "the clips are not on the page until the Clips menu opens them");
    await openPanel(page, "clips");
    const strip0 = await (await page.waitForSelector("[data-clips-panel] [data-story-strip]")).boundingBox();
    check(!!strip0 && strip0.x + strip0.width <= vb!.x, "the Clips menu opens the clips used in the panel, left of the viewer");
    check(!(await page.$eval("[data-plan-details]", (d: Element) => (d as HTMLDetailsElement).open)), "the plan's details are folded behind the verdict");
    const waveY = (await (await page.$("[data-waveform]"))!.boundingBox())!.y;
    const linesY = (await (await page.$("[data-textboard-row]"))!.boundingBox())!.y;
    const shotsY = (await (await page.$("[data-shots-row]"))!.boundingBox())!.y;
    check(waveY < linesY && linesY < shotsY, "the waveform, then the lyrics, then the shots");
    const summary = (await page.textContent("[data-storyboard-summary]")) ?? "";
    check(summary.includes("Reels v1") && summary.includes("planned now") && summary.includes("120 BPM"), `the summary (${summary})`);
    check(!existsSync(paths.exports) || readdirSync(paths.exports).length === 0, "nothing was rendered or written (no run folder)");
    check((await page.$$("[data-bar]")).length >= 3, "bars on the ruler");
    check((await page.$$("[data-waveform] rect")).length > 100, "the waveform");
    check((await page.$$("[data-hook-section]")).length >= 1, "hook sections shaded");
    check(!!(await page.$("[data-story-line='4'][data-anchored='02_b.mp4']")), "line 4 carries its anchor (⚓ 02_b.mp4)");
    const anchored = await page.$$eval("[data-shot]", (els: Element[]) => els.filter((e) => e.querySelector("[data-badge=anchor]")).map((e) => e.textContent ?? ""));
    check(anchored.length === 1 && anchored[0].includes("02_b.mp4"), `one shot carries the ⚓ badge, on 02_b.mp4 (${anchored.join(" | ")})`);
    const anchoredDissolve = await page.$$eval("[data-shot]", (els: Element[]) => els.filter((e) => e.querySelector("[data-badge=anchor]") && e.querySelector("[data-badge=dissolve]")).length);
    check(anchoredDissolve === 1, "and its dissolve badge (the anchor's own; automatic dissolves may add others)");
    check(((await page.textContent("[data-anchors-outside]")) ?? "").includes('line 6 "Into the light" → 03_c.mp4'), "the anchor outside the section is listed");
    const last = (await page.$$("[data-shot]")).length;
    check(!!(await page.$(`[data-shot='${last}'] [data-badge=loop]`)), "the last shot is marked as the Reels loop ending (↻), not warned as a repeat");
    const endingText = (await page.textContent("[data-ending]").catch(() => null)) ?? "";
    check(/^Ending: (a tight loop|a soft fade|the last chord rings out|the song's own)/.test(endingText), `the header says how the Reel ends, in plain words (${endingText})`);
    const predicted = (await page.textContent("[data-storyboard-assessment] [data-assessment-headline]")) ?? "";
    check(/(Ready to post|Good — \d+ things? to improve|Not ready — fix \d+ things? first) \(prediction before rendering\)/.test(predicted), `the header predicts the pro assessment (${predicted})`);
    const decisions = await page.$$eval("[data-decision]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
    check(decisions.some((d) => d.startsWith("Pacing: ")), `the header says how the shots are paced (${decisions.join(" | ")})`);
    check(decisions.some((d) => d.startsWith("Transitions: ")), "the header says which transitions the app chose");

    // The 1 s clip: slowed or held: a warning on its shot.
    const warned = await page.$$("[data-shot][data-warnings]");
    if (warned.length) {
      await warned[0].click();
      const details = (await page.textContent("[data-shot-details]")) ?? "";
      check(/slowed to|too short|the same clip/.test(details), `a shot's warning shows in its details (${details.slice(0, 120)})`);
    } else {
      check(true, "no shot needs a warning in this plan");
    }
    await page.click("[data-shot='1']");
    check(((await page.textContent("[data-shot-details]")) ?? "").includes("Shot 1:"), "a shot's details: clip, in / out, speed");
    // The transport bar under the viewer: start, back / forward one bar, play / pause, stop, end; keys too.
    check((await page.$$("[data-transport-button]")).length === 9, "the transport bar: start, back, play, stop, forward, end, loop, mute, full screen");
    check(!!(await page.$("[data-transport-speed]")) && !!(await page.$("[data-transport-volume]")) && /^\d+:\d\d \/ \d+:\d\d$/.test(((await page.textContent("[data-transport-time]")) ?? "").trim()), `…a speed choice, a volume slider and the time (${await page.textContent("[data-transport-time]")})`);
    const tFrame = async () => Number(await page.getAttribute("[data-transport]", "data-frame"));
    const tWait = (f: number) => page.waitForFunction((n: number) => Number(document.querySelector("[data-transport]")?.getAttribute("data-frame")) === n, f, { timeout: 5000 }).catch(() => {});
    const tLast = Number(await page.getAttribute("[data-transport]", "data-last"));
    await page.click("[data-transport-button=end]");
    await tWait(tLast);
    check((await tFrame()) === tLast, `⏭ goes to the end (frame ${await tFrame()} of ${tLast})`);
    await page.click("[data-transport-button=start]");
    await tWait(0);
    check((await tFrame()) === 0, "⏮ goes to the start");
    await page.click("[data-transport-button=forward]");
    await page.waitForFunction(() => Number(document.querySelector("[data-transport]")?.getAttribute("data-frame")) > 0, null, { timeout: 5000 }).catch(() => {});
    const bar1 = await tFrame();
    const barXs = await page.$$eval("[data-bar]", (els: Element[]) => els.map((e) => parseFloat((e as HTMLElement).style.left)));
    check(bar1 > 0 && bar1 < tLast, `⏩ jumps one bar forward (frame ${bar1}; bar lines at ${barXs.slice(0, 3).join(", ")} px)`);
    await page.click("[data-transport-button=forward]", { modifiers: ["Shift"] });
    await tWait(bar1 + 1);
    check((await tFrame()) === bar1 + 1, "Shift + ⏩ steps one frame");
    await page.click("[data-transport-button=back]");
    await tWait(bar1);
    check((await tFrame()) === bar1, "⏪ goes back to the bar line");
    await page.click("[data-transport-button=play]");
    await page.waitForSelector("[data-transport][data-playing='1']", { timeout: 5000 }).catch(() => null);
    check((await page.getAttribute("[data-transport]", "data-playing")) === "1", "▶ plays");
    await sleep(600);
    await page.click("[data-transport-button=stop]");
    await page.waitForSelector("[data-transport][data-playing='0']", { timeout: 5000 }).catch(() => null);
    await tWait(0);
    check((await page.getAttribute("[data-transport]", "data-playing")) === "0" && (await tFrame()) === 0, "⏹ stops and goes back to the start");
    // Speed 0.5x: the playhead moves at half speed (the preview only).
    await page.selectOption("[data-transport-speed]", "0.5");
    await page.click("[data-transport-button=play]");
    await page.waitForSelector("[data-transport][data-playing='1']", { timeout: 5000 }).catch(() => null);
    await sleep(2000);
    await page.click("[data-transport-button=stop]");
    await page.waitForSelector("[data-transport][data-playing='0']", { timeout: 5000 }).catch(() => null);
    await page.click("[data-transport-button=play]");
    await sleep(2000);
    const at05 = await tFrame();
    await page.click("[data-transport-button=play]"); // pause
    check(at05 > 10 && at05 < 45, `0.5x plays at half speed (frame ${at05} after 2 s; 1x would be about 60)`);
    await page.selectOption("[data-transport-speed]", "1");
    // Loop on: playing past the end starts again from the start.
    check((await page.getAttribute("[data-transport-button=loop]", "aria-pressed")) === "false", "Loop is off by default");
    await page.click("[data-transport-button=loop]");
    check((await page.getAttribute("[data-transport-button=loop]", "aria-pressed")) === "true", "Loop on");
    await page.click("[data-transport-button=end]");
    await tWait(tLast);
    await page.click("[data-transport-button=back]", { modifiers: ["Shift"] });
    for (let k = 0; k < 9; k++) await page.click("[data-transport-button=back]", { modifiers: ["Shift"] });
    await page.click("[data-transport-button=play]");
    await sleep(1500);
    const looped = await tFrame();
    check((await page.getAttribute("[data-transport]", "data-playing")) === "1" && looped < tLast - 10, `with Loop on it plays on from the start (frame ${looped})`);
    await page.click("[data-transport-button=stop]");
    await page.click("[data-transport-button=loop]");
    // Volume: the slider; mute sets it to 0.
    await page.click("[data-transport-button=mute]");
    check((await page.inputValue("[data-transport-volume]")) === "0", `mute: the volume slider shows 0 (${await page.inputValue("[data-transport-volume]")}, ${await page.getAttribute("[data-transport-button=mute]", "aria-label")})`);
    await page.click("[data-transport-button=mute]");
    check((await page.inputValue("[data-transport-volume]")) === "1", "sound on: back to full volume");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // nothing focused: the keys go to the player
    await page.keyboard.press("End");
    await tWait(tLast);
    check((await tFrame()) === tLast, "the End key goes to the end");
    await page.keyboard.press("Home");
    await tWait(0);
    await page.keyboard.press("ArrowRight");
    await tWait(bar1);
    check((await tFrame()) === bar1, "Home, then → steps one bar");
    // Play from a point: the playhead moves.
    await page.mouse.click(...(await (async () => {
      const box = await (await page.$("[data-waveform]")).boundingBox();
      return [box.x + box.width / 2, box.y + box.height / 2] as [number, number];
    })()));
    await sleep(1500);
    const left = Number((await page.getAttribute("[data-playhead]", "style"))?.match(/left: ([\d.]+)px/)?.[1] ?? 0);
    check(left > 100, `the preview plays from the clicked point (playhead at ${left} px)`);
    // Follow playback: off by default; on, the timeline scrolls with the playhead (zoom 4x so it overflows).
    const scrollLeft = () => page.$eval("[data-storyboard-timeline]", (el: Element) => (el as HTMLElement).scrollLeft);
    check(!(await page.isChecked("[data-follow-playback]")), "Follow playback is off by default");
    await page.click("button:has-text('4x')");
    await page.$eval("[data-storyboard-timeline]", (el: Element) => ((el as HTMLElement).scrollLeft = 0));
    await page.mouse.click(...(await (async () => {
      const box = await (await page.$("[data-waveform]")).boundingBox();
      return [box.x + 40, box.y + box.height / 2] as [number, number];
    })()));
    await sleep(2500);
    check((await scrollLeft()) === 0, "without Follow playback the timeline stays where it is");
    await page.check("[data-follow-playback]");
    await page.$eval("[data-storyboard-timeline]", (el: Element) => ((el as HTMLElement).scrollLeft = 0));
    await page.mouse.click(...(await (async () => {
      const box = await (await page.$("[data-waveform]")).boundingBox();
      return [box.x + 40, box.y + box.height / 2] as [number, number];
    })()));
    // Wait (up to 8 s) until the preview has played past a third of the view and the timeline followed.
    for (let k = 0; k < 16 && (await scrollLeft()) === 0; k++) await sleep(500);
    const followed = await scrollLeft();
    check(followed > 0, `with Follow playback the timeline scrolls with the playhead (scrolled ${followed} px)`);
    check((await page.evaluate(() => window.localStorage.getItem("lyric-studio:storyboard-follow"))) === "1", "Follow playback is remembered in this browser");
    await page.uncheck("[data-follow-playback]");
    await page.click("button:has-text('2x')"); // back to the zoom the rest of this test expects
    await page.$eval("[data-storyboard-timeline]", (el: Element) => ((el as HTMLElement).scrollLeft = 0));
    // The preview plays the end (the loop blend into the first shot) and the dips without an error.
    await page.$eval("[data-storyboard-timeline]", (el: Element) => ((el as HTMLElement).scrollLeft = (el as HTMLElement).scrollWidth));
    await page.mouse.click(...(await (async () => {
      const box = await (await page.$("[data-storyboard-timeline]")).boundingBox();
      const wave = await (await page.$("[data-waveform]")).boundingBox();
      return [box.x + box.width - 30, wave.y + wave.height / 2] as [number, number];
    })()));
    await sleep(2000);
    check(!pageErrors.length, `the preview plays the ending without errors${pageErrors.length ? ` (${pageErrors.join("; ")})` : ""}`);
    await page.$eval("[data-storyboard-timeline]", (el: Element) => ((el as HTMLElement).scrollLeft = 0));
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "storyboard.png") });

    // Stage 2. The story strip (Clips panel): file-name order; moving 01_a later re-plans and is kept in clips.json.
    await openPanel(page, "clips");
    const strip = async () => page.$$eval("[data-story-clip]", (els: Element[]) => els.map((e) => e.getAttribute("data-story-clip")));
    check(JSON.stringify(await strip()) === JSON.stringify(["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4"]), "the story strip in file-name order");
    const replanned = async () => {
      await page.waitForSelector("[data-replanning]", { timeout: 10_000 }).catch(() => null);
      await page.waitForSelector("[data-replanning]", { state: "detached", timeout: 180_000 });
    };
    await page.click("[data-move-later='01_a.mp4']");
    await replanned();
    const order = await strip();
    check(JSON.stringify(order) === JSON.stringify(["02_b.mp4", "01_a.mp4", "03_c.mp4", "04_d.mp4"]), `moved later, planned again (${order.join(", ")})`);
    const clipsJson = () => JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8"));
    check(JSON.stringify(clipsJson().order) === JSON.stringify(order), "the order is kept in clips.json");
    await page.reload();
    await page.waitForSelector("[data-shot='1']", { timeout: 180_000 });
    await openPanel(page, "clips");
    await page.waitForSelector("[data-story-clip]", { timeout: 180_000 });
    check(JSON.stringify(await strip()) === JSON.stringify(order), "and still there after reloading the page");
    // Drag a clip onto another: it takes that place.
    await page.dragAndDrop("[data-story-clip='04_d.mp4']", "[data-story-clip='02_b.mp4']");
    await replanned();
    check((await strip())[0] === "04_d.mp4", `dragged to the front (${(await strip()).join(", ")})`);
    // The clip editor: a best moment and slow motion for 03_c.
    await page.click("[data-story-clip='03_c.mp4'] button");
    await page.waitForSelector("[data-clip-editor='03_c.mp4']");
    await page.fill("[data-clip-best]", "1.5");
    await page.selectOption("[data-clip-speed]", "0.8");
    await page.click("[data-clip-save]");
    await replanned();
    check(JSON.stringify(clipsJson().clips["03_c.mp4"]) === JSON.stringify({ speed: 0.8, best: 1.5 }), `the clip editor saved its best moment and speed (${JSON.stringify(clipsJson().clips)})`);
    const shots03 = await page.$$eval("[data-shot]", (els: Element[]) => els.filter((e) => (e.textContent ?? "").includes("03_c.mp4")).map((e) => !!e.querySelector("[data-badge=speed]")));
    const card03 = (await page.textContent("[data-story-clip='03_c.mp4']")) ?? "";
    check(card03.includes("0.8x") && card03.includes("★ yours") && shots03.every(Boolean), `and the plan uses it: the card (${card03}), its shots slowed (${shots03.length})`);
    // Drag a clip onto a lyric line: an anchor.
    await page.dragAndDrop("[data-story-clip='04_d.mp4']", "[data-story-line='3']");
    await replanned();
    const recipe = JSON.parse(readFileSync(paths.recipe!, "utf8"));
    check(recipe.anchors.some((a: { line: number; clip: string }) => a.line === 3 && a.clip === "04_d.mp4"), `dragging onto line 3 anchors 04_d there (${JSON.stringify(recipe.anchors)})`);
    check(!!(await page.$("[data-story-line='3'][data-anchored='04_d.mp4']")), "line 3 shows ⚓ 04_d.mp4");

    // Drag a clip onto a shot: anchored on the lyric line that starts in it.
    const shotWithLine = await page.evaluate(() => {
      const lines = [...document.querySelectorAll("[data-story-line]")].filter((l) => l.getAttribute("data-story-line")).map((l) => ({ n: Number(l.getAttribute("data-story-line")), x: l.getBoundingClientRect().left }));
      for (const s of document.querySelectorAll("[data-shot]")) {
        const r = s.getBoundingClientRect();
        const line = lines.find((l) => l.x >= r.left - 1 && l.x < r.right - 2 && l.n !== 3);
        if (line && !s.textContent?.includes("01_a.mp4")) return { shot: s.getAttribute("data-shot"), line: line.n };
      }
      return null;
    });
    check(!!shotWithLine, `a shot with a lyric line starting in it (${JSON.stringify(shotWithLine)})`);
    if (shotWithLine) {
      await page.dragAndDrop("[data-story-clip='01_a.mp4']", `[data-shot='${shotWithLine.shot}']`);
      await replanned();
      const anchors = JSON.parse(readFileSync(paths.recipe!, "utf8")).anchors as { line: number; clip: string }[];
      check(anchors.some((a) => a.line === shotWithLine.line && a.clip === "01_a.mp4"), `dropping 01_a on shot ${shotWithLine.shot} anchors it on line ${shotWithLine.line} (${JSON.stringify(anchors)})`);
    }

    // A look change on the same page: the viewer shows it at once, the song's theme has it, the video is planned again.
    await openPanel(page, "effects");
    await page.click("[data-effect-picker]");
    await page.click("[data-try-effect=spread]");
    await page.waitForFunction(() => document.querySelector("[data-viewer]")?.getAttribute("data-effect") === "spread", null, { timeout: 5000 }).catch(() => {});
    check((await page.getAttribute("[data-viewer]", "data-effect")) === "spread", "Set effect: the viewer plays the new verse effect at once");
    await saveTheme(page);
    await replanned();
    check(loadTheme(wsDir, readRecipe(paths.recipe!).theme!).look.verseEffect === "spread", "…saved in the song's theme");
    await page.waitForFunction(() => document.querySelector("[data-viewer]")?.getAttribute("data-patched") === "0", null, { timeout: 60_000 }).catch(() => {});
    check((await page.getAttribute("[data-viewer]", "data-patched")) === "0" && (await page.getAttribute("[data-viewer]", "data-effect")) === "spread", "…and the new plan has it (nothing patched any more)");
    await page.click("[data-next-make]");
    await page.waitForSelector("[data-release-pack]");
    check(true, '"Next: Make" under the viewer opens Make');

    // The tempo (Automatic, on the left): x2/3 of 120 = 80 BPM in song.json; the video is planned with it.
    await page.goto(`${base}/songs/${sp.project.id}?tab=style`);
    await unfoldStyle(page); // the tempo follows the analysis: in the folded Automatic block
    await page.waitForSelector("[data-tempo-check]");
    if (!(await page.$("[data-tempo-ratio='×2/3']"))) {
      // No video made yet: the detected tempo comes from the tempo check.
      await page.click("[data-tempo-check]");
      await page.waitForSelector("[data-tempo-candidates]", { timeout: 120_000 });
      const candidates = (await page.textContent("[data-tempo-candidates]")) ?? "";
      check(/120(\.\d)? BPM \(detected\)/.test(candidates), `the tempo check lists the likely tempi (${candidates})`);
    }
    await page.waitForSelector("[data-tempo-ratio='×2/3']");
    await page.click("[data-tempo-ratio='×2/3']");
    await page.waitForSelector("[data-saving=saved]");
    check(JSON.parse(readFileSync(paths.recipe!, "utf8")).tempo === 80, "x2/3 sets the tempo to 80 BPM in song.json");
    await page.waitForFunction(() => / 8\d BPM| 7[6-9] BPM/.test(document.querySelector("[data-storyboard-summary]")?.textContent ?? ""), null, { timeout: 180_000 }).catch(() => {});
    const summary80 = (await page.textContent("[data-storyboard-summary]")) ?? "";
    const bpm80 = Number(summary80.match(/(\d+) BPM/)?.[1]);
    // The beats are tracked again around 80 (on this 120 BPM click track they settle near it).
    check(Math.abs(bpm80 - 80) <= 4, `planned again on the same page with the tempo (${summary80})`);
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "storyboard-stage2.png") });
    // 16:9 (YouTube): the same editor, the wide viewer smaller in height so it all still fits on one screen.
    ffmpeg("-f", "lavfi", "-i", "color=c=0x553344:s=600x600:d=1", "-frames:v", "1", path.join(paths.root, "cover.jpg")); // YouTube's cover layout needs a cover
    writeFileSync(paths.recipe!, JSON.stringify({ ...JSON.parse(readFileSync(paths.recipe!, "utf8")), platforms: ["reels", "youtube"] }));
    await page.reload();
    await page.waitForSelector("[data-shot='1']", { timeout: 180_000 });
    await page.selectOption("[data-storyboard-platform]", "youtube");
    await page.waitForFunction(() => /YouTube/.test(document.querySelector("[data-storyboard-summary]")?.textContent ?? ""), null, { timeout: 180_000 }).catch(() => {});
    await page.waitForSelector("[data-replanning]", { state: "detached", timeout: 180_000 }).catch(() => null);
    const vw = await (await page.waitForSelector("[data-viewer]", { timeout: 60_000 })).boundingBox();
    const wideFit = await fits();
    check(!!vw && vw.width > vw.height * 1.7 && wideFit.ok, `16:9: the wide viewer (${Math.round(vw?.width ?? 0)}×${Math.round(vw?.height ?? 0)}), timeline and command bar on one screen`);
    check(((await page.textContent("[data-no-shots]").catch(() => null)) ?? "").includes("cover art"), "YouTube cover layout: the empty shots lane says why (your cover art, not clips)");
    await page.click("[data-open-song]");
    check(!!(await page.waitForSelector("[data-shape-panel=song] [data-field=youtubeLayout]", { timeout: 5000 }).catch(() => null)), "…and its This song link opens the YouTube layout setting");
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "storyboard-youtube.png") });
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
