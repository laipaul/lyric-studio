// Browser test of the four-stage song page (needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/song-stages.e2e.ts
// The stage bar (Prepare -> Shape -> Make -> Review & Post) with each stage's tabs only, the Prepare
// to-do list (buttons open the right tab), "Make release pack" (one video per platform of the song's own
// platforms, queued for the worker) and the page opening on the stage that needs attention.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRun, openWorkspace } from "@lyric/db";
import { createSong, createTheme, loadFontCatalog, loadTheme, readRecipe, songPathsById, writeRecipe } from "@lyric/video/node";
import { collapsePanel, openPanel, saveTheme } from "./stage-tabs";

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
    check(((await page.textContent("[data-stage=prepare] [data-stage-status]")) ?? "").includes("4 to do"), "Prepare: 4 to do");
    const items = await page.$$eval("[data-todo-item]", (e: Element[]) => e.map((x) => x.getAttribute("data-todo-item")));
    check(JSON.stringify(items) === JSON.stringify(["clips", "vocals", "cover", "labels"]), `to-do: clips, vocal stem (a suggestion), cover, labels (${items.join(", ")})`);
    const tabs = async () => page.$$eval("[role=tab]", (e: Element[]) => e.map((x) => x.textContent?.trim()));
    check(JSON.stringify(await tabs()) === JSON.stringify(["Audio", "Lyrics & timing", "Details", "Storyboard"]), `Prepare's tabs: Audio, Lyrics & timing, Details, Storyboard (${(await tabs()).join(", ")})`);
    // Prepare reorganised (10 Nov 2026): one kind of input per tab.
    await page.click("[data-todo-item=clips] button");
    await page.waitForSelector("[data-assets=clips] [data-story-line]");
    check((await page.getAttribute("[role=tab][data-state=active]", "data-stage-tab")) === "clips" && ((await page.textContent("[data-story-line]")) ?? "") === "Your story line: drag to set the order.", "the clips to-do opens Storyboard, with its story line");
    check(((await page.textContent("[data-assets=clips] button:has(svg.lucide-upload)")) ?? "").trim() === "Add clips & photos" && ((await page.getAttribute("[data-clip-input]", "accept")) ?? "").includes(".jpg"), "Storyboard: Add clips & photos (photos accepted)");
    await page.click("[data-todo-item=cover] button");
    await page.waitForSelector("[data-assets=cover] [data-asset=cover]");
    check((await page.getAttribute("[role=tab][data-state=active]", "data-stage-tab")) === "details", "the cover to-do opens Details, where the cover is");
    await page.click("[data-stage-tab=lyrics]");
    await page.waitForSelector("[data-assets=lyrics] [data-asset=lyrics]");
    const lyricsRows = await page.$$eval("[data-assets=lyrics] [data-asset]", (e: Element[]) => e.map((x) => x.getAttribute("data-asset")));
    check(JSON.stringify(lyricsRows) === JSON.stringify(["lyrics", "hints"]), `Lyrics & timing: the lyrics file and hints (${lyricsRows.join(", ")})`);
    // L1a: the Assets tab has the vocal stem slot next to the song (none yet: "Add…").
    await page.click("[data-todo-item=vocals] button");
    await page.waitForSelector("[data-asset=vocals]");
    const slot = (await page.textContent("[data-asset=vocals]")) ?? "";
    check(slot.includes("Vocal stem") && slot.includes("Add…") && slot.includes("the app separates the vocals itself"), `the Assets tab offers the vocal stem (${slot})`);
    const order = await page.$$eval("[data-assets=audio] [data-asset]", (e: Element[]) => e.map((x) => x.getAttribute("data-asset")));
    check(JSON.stringify(order) === JSON.stringify(["song", "vocals", "backingVocals"]) && (await page.getAttribute("[role=tab][data-state=active]", "data-stage-tab")) === "assets", `Audio: the song, the vocal stem next to it, backing vocals; nothing else (${order.join(", ")})`);
    check(!(await page.$("[data-asset=themeCover]")), "Assets are the song's own files: no Theme cover here (it lives in Themes)");
    // Original file names: files put into the song folder by hand are recognised, the rest asked about once.
    const wsF = openWorkspace(wsDir);
    const folder = songPathsById(wsF, id).root;
    wsF.close();
    check(readFileSync(path.join(folder, ".studio", "files.json"), "utf8").includes('"song": "Hold On.wav"'), "the song keeps its own name (Hold On.wav, linked in .studio\\files.json)");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=2", path.join(folder, "Hold On (Backing Vocals).wav"));
    writeFileSync(path.join(folder, "notes.txt"), "call the label\n");
    await page.reload();
    await page.click("[data-todo-item=vocals] button");
    await page.waitForSelector("[data-asset=backingVocals]");
    check(((await page.textContent("[data-asset=backingVocals]")) ?? "").includes("Hold On (Backing Vocals).wav"), "a backing-vocals file dropped by hand is recognised by its name");
    check(!(await page.$("[data-unassigned-file='notes.txt']")), "a text file to place is not asked about in Audio…");
    await page.click("[data-stage-tab=lyrics]");
    await page.waitForSelector("[data-assets=lyrics] [data-unassigned-file='notes.txt']");
    check(true, "…but in Lyrics & timing, with the lyrics file");
    check(!(await page.$("[data-unassigned-file='Hold On (Backing Vocals).wav']")), "…and not asked about");
    await page.click("[data-unassigned-file='notes.txt'] [data-assign=notUsed]");
    await page.waitForFunction(() => !document.querySelector("[data-unassigned]"));
    check(true, "\"What is this file?\" → Not used: not asked again");
    await page.click("[data-todo-item=labels] button");
    check((await page.getAttribute("[role=tab][data-state=active]", "id"))?.endsWith("lyrics") ?? false, "the label item's button opens the Lyrics tab");
    // Old links still lead to the right place (10 Nov 2026): the tab ids stay; ?tab=storyboard is still the Shape page.
    for (const [q, want] of [["tab=assets", "assets"], ["tab=files", "assets"], ["tab=audio", "assets"], ["tab=clips", "clips"], ["panel=song", "details"]] as const) {
      await page.goto(`${base}/songs/${id}?${q}`);
      await page.waitForSelector("[data-stages]");
      check((await page.getAttribute("[role=tab][data-state=active]", "data-stage-tab")) === want, `?${q} opens Prepare → ${want}`);
    }
    await page.goto(`${base}/songs/${id}?tab=storyboard`);
    await page.waitForSelector("[data-shape-tabs]");
    check((await page.getAttribute("[data-stage=shape]", "aria-current")) === "step", "?tab=storyboard (an old link) still opens Shape");
    const shapeText = await page.$eval("[data-work-area]", (e: Element) => (e as HTMLElement).innerText);
    check(!/storyboard/i.test(shapeText), "Shape never says 'storyboard' on screen (the planned video is the shot plan)");

    // Shape and Review show their own tabs; Make has the release pack.
    await page.click("[data-stage=shape]");
    check(JSON.stringify(await tabs()) === JSON.stringify(["Look", "Part & ending", "Pace", "Shots"]), `Shape's tabs: Look, Part & ending, Pace, Shots (${(await tabs()).join(", ")})`);
    await page.click("[data-stage=review]");
    check(JSON.stringify(await tabs()) === JSON.stringify(["Videos", "Post"]), "Review shows Videos and Post");
    await page.click("[data-stage=make]");
    await page.waitForSelector("[data-release-pack]");
    check(JSON.stringify(await tabs()) === JSON.stringify(["Videos", "Try other looks", "Options"]), `Make's tabs: Videos, Try other looks, Options (${(await tabs()).join(", ")})`);
    check(((await page.textContent("[data-release-platforms]")) ?? "").includes("Reels · TikTok · Shorts · YouTube · Canvas"), "release pack: every platform when the song has none of its own");
    check(await page.isDisabled("[data-make-release]"), "release pack waits for the clips (blocking to-do)");

    // Clips (a collection) + the song's own platforms: the release pack makes one video for each.
    const ws2 = openWorkspace(wsDir);
    mkdirSync(path.join(wsDir, "collections", "wedding"), { recursive: true });
    const recipe = songPathsById(ws2, id).recipe!;
    writeRecipe(recipe, { ...readRecipe(recipe), collections: ["wedding"], platforms: ["reels", "youtube"] });
    await page.goto(`${base}/songs/${id}`);
    await page.waitForSelector("[data-stages]");
    // Still 3 things to check (vocal stem, cover, label line), none blocking: Prepare says "to check", Make is open.
    check(((await page.textContent("[data-stage=prepare] [data-stage-status]")) ?? "").includes("3 to check"), "nothing blocking: Prepare says 3 to check");
    await page.click("[data-stage=make]");
    check(((await page.textContent("[data-release-platforms]")) ?? "").includes("Reels · YouTube (this song's platforms)"), "release pack: the song's own platforms");
    await page.click("[data-make-release]");
    await page.waitForSelector("[data-release-pack] >> text=Queued");
    const run = ws2.db.select().from(makeRun).all().at(-1);
    const options = (run?.options_json ?? {}) as { platforms?: string; variations?: number };
    check(run?.status === "queued" && options.platforms === "reels,youtube" && options.variations === 1, `queued: Reels + YouTube, one video each (${JSON.stringify(options)})`);

    // What was chosen in Make survives a trip to Prepare and back (the Generate tab stays mounted, hidden meanwhile).
    await page.click("button[aria-expanded]:has-text('Generate videos')");
    await page.click("[data-platform-choice=tiktok]");
    const chosen = () => page.$$eval("[data-platform-choice]", (e: Element[]) => e.filter((x) => x.className.includes("bg-brand")).map((x) => x.getAttribute("data-platform-choice")));
    check(JSON.stringify(await chosen()) === JSON.stringify(["reels", "tiktok", "youtube"]), "Make: TikTok ticked next to the recipe's platforms");
    await page.click("[data-stage=prepare]");
    check(!(await page.isVisible("[data-generate]")), "the hidden Generate panel is not visible on Prepare");
    await page.click("[data-stage=make]");
    await page.waitForSelector("[data-generate]", { state: "visible" });
    check(JSON.stringify(await chosen()) === JSON.stringify(["reels", "tiktok", "youtube"]), "Make -> Prepare -> Make keeps the ticked platforms");

    // The hidden Generate panel follows the song's collections: untick "wedding" in Prepare → Clips and the
    // clips line in Make no longer names it (it used to keep the first value and send it with the run).
    check(((await page.textContent("[data-clips-line]")) ?? "").includes("wedding"), "Make: the clips line names the song's collection");
    await openPanel(page, "collections");
    await page.uncheck("input[data-edit$='-wedding']");
    await page.waitForFunction(() => !document.querySelector("input[data-edit$='-wedding']:checked"));
    await sleep(800);
    await page.click("[data-stage=make]");
    await page.waitForSelector("[data-generate]", { state: "visible" });
    check(!((await page.textContent("[data-clips-line]")) ?? "").includes("wedding"), `Make after unticking it in Prepare → Clips: the clips line no longer names it (${await page.textContent("[data-clips-line]")})`);
    await openPanel(page, "collections");
    await page.check("input[data-edit$='-wedding']");
    await sleep(800);

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
    check((await page.getAttribute("[data-stage=review]", "aria-current")) === "step", "with videos: opens on Review");
    await page.click("[role=tab]:has-text('Post')");
    await page.waitForSelector("[data-ready-to-approve]");
    const offered = await page.$$eval("[data-offered]", (e: Element[]) => e.map((x) => x.getAttribute("data-offered")));
    check(offered.length === 1 && (offered[0] ?? "").includes("2026-10-28_1000/reels/v1"), `Post offers only the ready video, not the one with a point (${offered.join(", ")})`);
    await page.click("[data-approve]");
    await page.waitForSelector("[data-post-video]");
    check((await page.$("[data-ready-to-approve]")) === null, "Approve: it moves into the posting list");
    // Review's tabs (11 Nov 2026): one per platform with videos, with its count, then Post; no platform summary boxes.
    const reviewTabs = await page.$$eval("[data-review-tabs] [role=tab]", (e: Element[]) => e.map((x) => `${x.getAttribute("data-review-tab")}:${x.textContent?.trim()}`));
    // (YouTube too: the release pack queued above is being made for it, with no video yet.)
    check(reviewTabs.length === 3 && /^reels:.*Reels2$/.test(reviewTabs[0]) && /^youtube:.*YouTube$/.test(reviewTabs[1]) && /^post:Post/.test(reviewTabs[2]), `Review's tabs: Reels (2), YouTube (being made), Post (${reviewTabs.join(" | ")})`);
    check(!(await page.$("[data-platform-overview]")) && !(await page.$("[data-show-all]")), "no platform summary boxes, no 'show all'");
    await page.click("[data-review-tab=reels]");
    await page.waitForSelector("[data-review-platform=reels] [data-review-header] [data-another-take]");
    // Approved first (v1, just approved in Post), then the others newest first; the run's date is a line on the card.
    const cardOrder = await page.$$eval("[data-review-platform=reels] [data-card]", (e: Element[]) => e.map((x) => x.getAttribute("data-run")));
    check(JSON.stringify(cardOrder) === JSON.stringify(["2026-10-28_1000", "2026-10-29_1000"]), `the approved video first, then the newest (${cardOrder.join(", ")})`);
    check(!!(await page.$("[data-card] [data-card-run]")) && !(await page.$("[data-review-platform] h2 + [data-run]")), "the run's date and time is a small line on each card");
    await page.click("[data-take=reels]");
    await page.waitForSelector("[data-another-take] >> text=Queued");
    // The queued take shows as a placeholder card in its platform's tab.
    await page.waitForSelector("[data-review-platform=reels] [data-making]", { timeout: 20_000 });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-review-platform=reels] [data-making]")].some((e) => e.textContent?.includes("take 3")), null, { timeout: 20_000 }).catch(() => {});
    const placeholders = await page.$$eval("[data-review-platform=reels] [data-making]", (e: Element[]) => e.map((x) => x.textContent?.trim()));
    check(placeholders.some((t) => t === "Waiting… take 3, see Tasks") && placeholders.some((t) => t === "Waiting… 1 new video, see Tasks"), `placeholder cards for what is queued: "Waiting… take 3, see Tasks" and the release pack (${placeholders.join(" | ")})`);
    const takeRun = ws2.db.select().from(makeRun).all().at(-1);
    const takeOptions = (takeRun?.options_json ?? {}) as { platforms?: string; take?: number };
    check(takeOptions.platforms === "reels" && takeOptions.take === 3 && (takeRun?.label ?? "").includes("take 3"), `Try another take: Reels take 3 (${JSON.stringify(takeOptions)}, ${takeRun?.label})`);
    // The Shape page, Canva style: a slim header (cover, title, stats); a rail on the left with the stages
    // and, on Shape, its menus; each menu opens one panel beside the rail; the editor fills the rest.
    writeRecipe(recipe, { ...readRecipe(recipe), tempo: 96, ending: "fade", locked: ["tempo"] });
    await page.click("[data-stage=shape]");
    await page.waitForSelector("[data-shape-tabs]");
    check(((await page.textContent("[data-song-header] h1")) ?? "").length > 0, "the slim header keeps the song title");
    const railBox = await (await page.$("[data-rail]"))!.boundingBox();
    const stageIds = await page.$$eval("[data-rail] [data-stage]", (e: Element[]) => e.map((x) => x.getAttribute("data-stage")));
    check(JSON.stringify(stageIds) === JSON.stringify(["prepare", "shape", "make", "review"]) && !!railBox && railBox.x < 5 && railBox.width < 100, `the stages sit in the rail on the left (${stageIds.join(", ")})`);
    const numbers = await page.$$eval("[data-rail] [data-stage-number]", (e: Element[]) => e.map((x) => x.textContent));
    check(JSON.stringify(numbers) === JSON.stringify(["1", "2", "3", "4"]) && (await page.$$("[data-rail-item]")).length === 0 && !(await page.$("[data-rail-group]")), `N1: the rail holds the four stages only, numbered 1-4 (${numbers.join(", ")})`);
    check((await page.isVisible("[data-shape-tools]")) && (await page.getAttribute("[data-shape-tab=look]", "aria-selected")) === "true", "N1 polish: one tab always selected (Look, the first) and its panel shows");
    check(!(await page.$("[data-shape-panel=look] h2")), "no title repeating the tab's name in the panel");
    const viewerBox = await (await page.waitForSelector("[data-viewer], [data-look-preview]")).boundingBox();
    check(!!viewerBox && viewerBox.y < 300, `the viewer at the top of the editor (${JSON.stringify(viewerBox)})`);
    check(!!(await page.$("[data-next-make]")), '"Next: Make" under the viewer');
    const inBlock = async (b: string) => page.$$eval(`[data-style-block=${b}] [data-field]`, (e: Element[]) => e.map((x) => x.getAttribute("data-field")));
    const visibleBlocks = () => page.$$eval("[data-style-block]", (e: Element[]) => e.filter((x) => (x as HTMLElement).offsetParent !== null).map((x) => x.getAttribute("data-style-block")));
    // Look: the Look bar (the song's theme, Change) and this song's look settings; no theme library in Shape (N1).
    await openPanel(page, "look");
    const themeName = (await page.getAttribute("[data-look-bar]", "data-look-bar")) ?? "";
    check(themeName.length > 0, `Look: the Look bar names the song's theme (${themeName})`);
    const lookMain = await page.$$eval("[data-style-block=look] [data-field]", (e: Element[]) => e.filter((x) => !x.closest("[data-other-videos]")).map((x) => x.getAttribute("data-field")));
    check(JSON.stringify(lookMain) === JSON.stringify(["titleOpening", "readability"]) && !!(await page.$("[data-style-block=look] [data-other-videos] [data-field=youtubeLayout]")), `Look for the Reel chosen: title opening and readability; the YouTube layout folded under Only for other videos (${lookMain.join(", ")})`);
    check(!(await page.$("[data-theme-tile]")) && !(await page.$("[data-theme-new]")) && !(await page.$("[data-removed-themes]")), "no theme library in Shape: it is on the Themes page");
    check(!(await page.$("[data-theme-banner]")) && !(await page.$("[data-work-area][data-theme-mode]")), "not editing: no pink frame, no banner");
    const lookLine = (await page.textContent("[data-look-content]")) ?? "";
    check(lookLine.includes(`Look:theme ${themeName}`) && lookLine.includes("This song only") && lookLine.includes("Content: this song"), `the Look · Content line (Analysis) (${lookLine})`);
    await page.click("[data-look-edit-theme]");
    await page.waitForSelector("[data-theme-banner]");
    const banner = (await page.textContent("[data-theme-banner]")) ?? "";
    check(banner.includes(`Editing theme ${themeName}`) && banner.includes("Changes here reach: this song only") && (await page.getAttribute("[data-work-area]", "data-theme-mode")) === themeName, `Look → Edit theme: the pink frame and the banner (${banner})`);
    await page.click("[data-theme-done]");
    await page.waitForSelector("[data-theme-banner]", { state: "detached" });
    check((await page.$("[data-theme-editors]")) === null && (await page.getAttribute("[data-theme-current]", "data-theme-current")) === themeName, "Done (no changes): the editor closes on the song's theme");
    check(((await page.textContent("[data-theme-users]")) ?? "") === "Used by this song only" && ((await page.textContent("[data-theme-current] [data-theme-reach]")) ?? "") === "This song only", "used by this song only, with its badge");
    check(!!(await page.$("[data-theme-current] [data-themes-link]")), "new, rename, delete: a link to the Themes page");
    await openPanel(page, "colour");
    const toolsBox = await (await page.$("[data-shape-tools]"))!.boundingBox();
    const viewerAfter = await (await page.$("[data-viewer], [data-look-preview]"))!.boundingBox();
    check(!!toolsBox && !!viewerAfter && toolsBox.x + toolsBox.width <= viewerAfter.x + 1, `the panel opens left of the viewer (${JSON.stringify(toolsBox)} / ${JSON.stringify(viewerAfter)})`);
    check((await inBlock("theme")).includes("accentColour"), `Edit theme: the accent colour row (${(await inBlock("theme")).join(", ")})`);
    await page.click("[data-theme-cancel]");
    await page.click("[data-shape-tab=look]");
    await page.waitForSelector("[data-shape-panel=look]");
    await page.click("[data-shape-tab=look]");
    check(await page.isVisible("[data-shape-tools]"), "a second click on the tab keeps its panel (never no tab)");
    const lookBarText = (await page.textContent("[data-look-bar]")) ?? "";
    check(!/^Look/.test(lookBarText.trim()), `the Look bar has no "Look" label above the theme name (${lookBarText})`);
    // The song's own settings left Shape (N1): Details, Clips and Lyrics & timing in Prepare, What to make in Make.
    await openPanel(page, "details");
    check(JSON.stringify(await inBlock("details")) === JSON.stringify(["tagline", "hookText", "endText", "ep"]) && !!(await page.$("[data-style-block=details] [data-card-title]")), `Prepare → Details: title, tagline, hook and end card texts, EP (${(await inBlock("details")).join(", ")})`);
    check(!(await page.$("[data-field=lineShape]")) && !(await page.$("[data-field=lineBuild]")) && !(await page.$("[data-field=finalHook]")), "the theme's line shape rows are not repeated outside the theme editor");
    await openPanel(page, "make");
    const makeLine = (await page.textContent("[data-compact-summary=make]")) ?? "";
    check(makeLine.startsWith("Reels 3 · YouTube 1") && makeLine.includes("clips: the song's own"), `What to make's line (${makeLine})`);
    check(JSON.stringify(await inBlock("make")) === JSON.stringify(["platforms", "variations"]), `Make → Videos: platforms, videos per platform (${(await inBlock("make")).join(", ")})`);
    await openPanel(page, "collections");
    check(JSON.stringify(await inBlock("collections")) === JSON.stringify(["collections"]), "Prepare → Clips: the collections");
    check(((await page.textContent("[data-field=collections] [data-source]")) ?? "") === "Mixed into this song", `the song's collections: "Mixed into this song" (${await page.textContent("[data-field=collections] [data-source]")})`);
    // N1 polish: the same stage line on every stage, one distinct icon per tab, and each stage opens on its last tab.
    const icons = await page.$$eval("[role=tab] svg", (e: Element[]) => e.map((x) => x.getAttribute("class")?.match(/lucide-[a-z0-9-]+/)?.[0] ?? ""));
    check(new Set(icons).size === icons.length && icons.length === 4, `Prepare's tabs: four distinct icons (${icons.join(", ")})`);
    check(((await page.textContent("[data-work-status=prepare]")) ?? "").startsWith("Prepare · "), `Prepare's stage line (${await page.textContent("[data-work-status=prepare]")})`);
    // The selected stage and tab in the app's pink (as the play button), the same in all four stages (10 Nov 2026).
    const PINK = "rgb(232, 163, 181)";
    // (A string, not a function: the test runner's compiler adds helpers the page does not have.)
    const selection = async (sid: string) =>
      page.evaluate(`(() => {
        const css = (el) => (el ? getComputedStyle(el) : null);
        const rail = document.querySelector("[data-stage=${sid}]");
        const other = document.querySelector("[data-rail] [data-stage]:not([data-stage=${sid}])");
        const bar = rail ? getComputedStyle(rail, "::before") : null;
        const tabs = [...document.querySelectorAll("[data-stage-header] [role=tab]")];
        const on = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
        const off = tabs.filter((t) => t.getAttribute("aria-selected") !== "true");
        return {
          railColour: css(rail)?.color, railWeight: css(rail)?.fontWeight, icon: css(rail?.querySelector("svg") ?? null)?.color, bar: bar?.backgroundColor, barWidth: bar?.width,
          otherColour: css(other)?.color,
          on: on.length, onLine: css(on[0] ?? null)?.borderBottomColor, onWeight: css(on[0] ?? null)?.fontWeight,
          offLines: off.map((t) => getComputedStyle(t).borderBottomColor), offColours: off.map((t) => getComputedStyle(t).color),
          title: css(document.querySelector("[data-work-status] .text-base"))?.fontSize,
        };
      })()`);
    for (const sid of ["prepare", "shape", "make", "review"]) {
      await page.click(`[data-stage=${sid}]`);
      await sleep(300);
      const x = await selection(sid);
      check(
        x.railColour === PINK && Number(x.railWeight) >= 600 && x.icon === PINK && x.bar === PINK && x.barWidth === "4px" && x.otherColour !== PINK,
        `${sid}: the rail's selected stage is pink, bold, with a pink bar; the others not (${JSON.stringify({ ...x, offLines: undefined, offColours: undefined })})`,
      );
      check(
        x.on === 1 && x.onLine === PINK && Number(x.onWeight) >= 600 && x.offLines.every((c: string) => c !== PINK) && x.offColours.every((c: string) => c !== PINK),
        `${sid}: one tab with a pink underline and bold text, the others grey (${x.onLine}, ${x.onWeight}; others ${x.offColours.join(" ")})`,
      );
      check(x.title === "16px", `${sid}: the stage line a size up, as the page title (${x.title})`);
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `stage-${sid}.png`) });
    }
    await page.click("[data-stage=prepare]");
    await page.click("[data-stage=make]");
    check(((await page.textContent("[data-work-status=make]")) ?? "").startsWith("Make · "), `Make's stage line (${await page.textContent("[data-work-status=make]")})`);
    const makeIcons = await page.$$eval("[data-make-tab] svg", (e: Element[]) => e.map((x) => x.getAttribute("class")?.match(/lucide-[a-z0-9-]+/)?.[0] ?? ""));
    check(new Set(makeIcons).size === 3, `Make's tabs: three distinct icons (${makeIcons.join(", ")})`);
    await page.click("[data-stage=review]");
    check(((await page.textContent("[data-work-status=review]")) ?? "").startsWith("Review · ") && !(await page.$("[data-saved-at-once]")), `Review's stage line (${await page.textContent("[data-work-status=review]")})`);
    await page.click("[data-stage=shape]");
    const shapeIcons = await page.$$eval("[data-shape-tab] svg", (e: Element[]) => e.map((x) => x.getAttribute("class")?.match(/lucide-[a-z0-9-]+/)?.[0] ?? ""));
    check(new Set(shapeIcons).size === 4, `Shape's tabs: four distinct icons (${shapeIcons.join(", ")})`);
    check((await page.getAttribute("[data-shape-tab=pace]", "aria-selected")) === "true" || (await page.getAttribute("[data-shape-tab=part]", "aria-selected")) === "true" || (await page.getAttribute("[data-shape-tab=look]", "aria-selected")) === "true", "Shape opens on its last tab");
    await page.click("[data-stage=prepare]");
    check((await page.getAttribute("[role=tab][data-state=active]", "data-stage-tab")) === "clips", "back to Prepare: its last tab (Clips) is selected");
    await openPanel(page, "tempo");
    check(!!(await page.$("[data-field=tempo] [data-tempo-check]")) && !!(await page.$("[data-retime-button]")), "Prepare → Lyrics & timing: the tempo tools and Time the lyrics again");
    check(!!(await page.$("[data-locked=tempo]")) && ((await page.textContent("[data-field=tempo] [data-source]")) ?? "") === "Set by me" && !(await page.$("[data-back-auto=tempo]")), "a locked value keeps its value and shows Set by me (no ↺ while locked)");
    // Part & ending and Pace: "auto" or "Set by me" in place, ↺ back to auto; no Automatic section any more.
    await openPanel(page, "part");
    check(JSON.stringify(await visibleBlocks()) === JSON.stringify(["part"]), `one panel at a time (${(await visibleBlocks()).join(", ")})`);
    check(JSON.stringify(await inBlock("part")) === JSON.stringify(["section", "length", "ending"]), `Part & ending: section, target length, ending (${(await inBlock("part")).join(", ")})`);
    check((await page.textContent("[data-auto-summary]")) === "1 set by me: Ending; the rest automatic", `its summary line (${await page.textContent("[data-auto-summary]")})`);
    check(((await page.textContent("[data-field=ending] [data-source]")) ?? "") === "Set by me" && ((await page.textContent("[data-field=section] [data-source]")) ?? "") === "auto", "Set by me / auto in place");
    await page.click("[data-back-auto=ending]");
    await page.waitForFunction(() => document.querySelector("[data-field=ending] [data-source]")?.textContent === "auto");
    await sleep(500);
    check(readRecipe(recipe).ending === undefined, "↺ auto: the app chooses the ending again (song.json has none)");
    check(!(await page.$("[data-panel-close]")), "a tab's panel has no × (it can only be collapsed)");
    await collapsePanel(page);
    check(!(await page.isVisible("[data-shape-tools]")) && (await page.getAttribute("[data-shape-tab=part]", "aria-selected")) === "true", "collapsed from its edge: the tab stays selected");
    await page.click("[data-panel-expand]");
    await page.waitForSelector("[data-shape-panel=part]");
    check(await page.isVisible("[data-shape-tools]"), "the edge button shows the panel again");
    check((await page.$$("[data-saved-at-once]")).length === 1 && !((await page.textContent("[data-shape-tools]")) ?? "").includes("Every change is saved"), "'Every change is saved for this song at once' once, in the stage line, not in the panel");
    await openPanel(page, "pace");
    check(JSON.stringify(await inBlock("pace")) === JSON.stringify(["shotLength", "transitions", "paceShift"]), `Pace: shot length, transitions, pace (${(await inBlock("pace")).join(", ")})`);
    check((await page.textContent("[data-auto-summary]")) === "All automatic: the app handles these", "Pace: all automatic");
    check(((await page.getAttribute("[data-field=transitions] [data-source-hint]", "title")) ?? "").startsWith("From: "), "other sources: a tooltip on the label");
    check(!(await page.$("[data-locked=shotLength]")), "an unlocked setting shows no padlock");
    check(!(await page.$("[data-field=shotLength] [data-lock]")) && !(await page.$("[data-field=shotLength] [data-per-platform]")), "no lock or 'per platform' buttons in the row");
    await page.click("[data-row-menu=shotLength]");
    const menuItems = await page.$$eval("[role=menuitem]", (e: Element[]) => e.map((x) => x.textContent));
    check(JSON.stringify(menuItems) === JSON.stringify(["Per platform…", "Lock: keep this song's value"]), `the ⋯ menu: per platform and lock (${menuItems.join(" | ")})`);
    await page.click("[role=menuitem][data-per-platform=shotLength]");
    check(!!(await page.$("[data-platform-value=shotLength-reels]")), "'Per platform…' opens the per-platform editors");
    check(!((await page.textContent("[data-style]")) ?? "").includes("the same on every platform"), "no 'the same on every platform' lines");
    // Fonts: one summary line; Fine-tune shows the six rows.
    await openPanel(page, "effects"); // the Theme panel with its editors, Fine-tune folded
    const fontLine = (await page.textContent("[data-font-summary-text]")) ?? "";
    check(/^Fonts: verses .+ \d00(?: italic)? · choruses .+ \d00(?: italic)?$/.test(fontLine), `the font summary line (${fontLine})`);
    check((await page.$("[data-field=verseFont]")) === null, "the six font rows are folded");
    await page.click("[data-fine-tune]");
    const fontRows = await page.$$eval("[data-fine-tune-rows] [data-field]", (e: Element[]) => e.map((x) => x.getAttribute("data-field")));
    check(JSON.stringify(fontRows) === JSON.stringify(["verseFont", "verseWeight", "verseItalic", "hookFont", "hookWeight", "hookItalic"]), `Fine-tune shows the six font rows (${fontRows.join(", ")})`);
    const verseFont = await page.$eval("[data-edit='verseFont-default']", (e: Element) => (e as HTMLSelectElement).value);
    check(fontLine.startsWith(`Fonts: verses ${verseFont} `), "the summary names the verse font of the rows");
    // Set effect: every click is saved at once; the viewer (here the stand-in: the song has no timed lyrics) shows it.
    // The look is saved in the song's theme (themes\<name>\theme.json), not in song.json.
    const look = (key: string): unknown => (loadTheme(wsDir, readRecipe(recipe).theme!).look as Record<string, unknown>)[key];
    const saved = async (key: string, value: unknown) => {
      for (let i = 0; i < 40; i++) {
        if (JSON.stringify(look(key)) === JSON.stringify(value) && JSON.parse(readFileSync(recipe, "utf8"))[key] === undefined) return true;
        await sleep(150);
      }
      return false;
    };
    await openPanel(page, "effects");
    await page.waitForSelector("[data-effect-preview]");
    const sections = await page.$$eval("[data-editor-section]", (e: Element[]) => e.map((x) => x.getAttribute("data-editor-section")));
    check(JSON.stringify(sections) === JSON.stringify(["cards", "text", "motion", "colours", "picture"]), `the theme editor: Cards first, then Text, Motion, Colours, Picture (${sections.join(", ")})`);
    check((await page.getAttribute("[data-effect-part]", "data-effect-part")) === "verse", "Set effect starts on Verses");
    const before = look("verseEffect");
    await page.click("[data-effect-picker]"); // the effect picker opens the gallery
    check(!!(await page.$("[data-effect-gallery] [data-effect-kind=Glitch]")), "the gallery has its filter chips");
    // A to Z by name (the current one first), and a search box.
    const titles = await page.$$eval("[data-effect-gallery] [data-try-effect]", (els: Element[]) => els.map((e) => (e.getAttribute("title") ?? "").split(" · ")[0]));
    const rest = titles.slice(1);
    check(JSON.stringify(rest) === JSON.stringify([...rest].sort((a, b) => a.localeCompare(b))), `the gallery is A to Z after the current effect (${titles.slice(0, 4).join(", ")}…)`);
    await page.fill("[data-effect-search]", "slide");
    const found = await page.$$eval("[data-effect-gallery] [data-try-effect]", (els: Element[]) => els.map((e) => e.getAttribute("data-try-effect")));
    check(found.length >= 3 && found.every((n) => /slide/.test(n ?? "")), `search "slide" finds the slides (${found.join(", ")})`);
    await page.fill("[data-effect-search]", "");
    // Pointing at an effect plays its name in the big viewer, without an error (Dissolve drawn letter by letter).
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const name of ["neon", "word-rise", "slide-left", "slide-right", "slide-down", "dissolve", "spread", "soft-blur"]) {
      await page.hover(`[data-try-effect=${name}]`);
      await page.waitForFunction((n: string) => document.querySelector("[data-look-preview]")?.getAttribute("data-effect") === n, name, { timeout: 5000 }).catch(() => {});
      check((await page.getAttribute("[data-look-preview]", "data-effect")) === name && !!(await page.$("[data-look-preview] [data-lyric]")), `pointing at ${name} plays it in the big viewer`);
    }
    await page.hover(`[data-try-effect=dissolve]`);
    await sleep(3000); // into the line's exit: letters drift away
    check(errors.length === 0, `no page errors while the effects play (${errors.join("; ")})`);
    check((await page.$$("[data-effect-gallery] .__remotion-player")).length === 0, "the gallery's tiles are compact names (no players of their own)");
    await page.mouse.move(5, 5);
    await page.click("[data-try-effect=typewriter]");
    await page.selectOption("[data-try-breathe]", "beat");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-effect") === "typewriter" && document.querySelector("[data-look-preview]")?.getAttribute("data-breathe") === "beat");
    check((await page.$$eval("[data-look-preview] [data-lyric]", (e: Element[]) => e.length)) > 0, "the viewer shows the effect and Breathe at once");
    check(look("verseEffect") === before && !!(await page.$("[data-theme-unsaved]")), "…but nothing is saved yet ('not saved yet')");
    check((await page.$$("[data-look-preview]")).length === 1, "one viewer");
    check((await page.$$eval("[data-effect-preview] .__remotion-player, [data-effect-preview] canvas, [data-effect-preview] [data-lyric]", (e: Element[]) => e.length)) === 0, "the Set effect panel has no player of its own (the big viewer shows the effect)");
    // The Strength slider (the typing speed for a typewriter), right under the effect picker.
    await page.$eval("[data-effect-strength]", (el: Element) => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "30");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    check(((await page.textContent("[data-effect-strength-value]")) ?? "") === "30%", "the Strength slider shows 30%");
    check(((await page.textContent("[data-set-effect]")) ?? "").includes("Verses: Typewriter (30%)"), "the panel names what verses use");
    // Choruses: the switch, then the effect goes to the hook effect; the verses keep theirs.
    await page.click("[data-part=hook]");
    await page.click("[data-try-effect=spread]");
    check((await page.getAttribute("[data-try-effect=spread]", "aria-pressed")) === "true", "the chorus effect shows as chosen");
    await page.click("[data-part=verse]");
    check((await page.getAttribute("[data-try-effect=typewriter]", "aria-pressed")) === "true", "back on Verses: typewriter is chosen");
    check(((await page.textContent("[data-theme-save]")) ?? "") === "Save", "a theme only this song uses: plain Save");
    await saveTheme(page);
    check(await saved("verseEffect", "typewriter:30") && look("hookEffect") === "spread" && look("breathe") === "beat", "Save: the effects go into the song's theme (theme.json, not song.json)");
    // Cancel throws the draft away.
    await openPanel(page, "colour");
    const setAccent = async (hex: string) =>
      page.$eval(
        "[data-edit='accentColour-default']",
        (el: Element, v: string) => {
          const input = el as HTMLInputElement;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        },
        hex,
      );
    const accentBefore = look("accentColour");
    await setAccent("#33aaff");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-accent") === "#33AAFF");
    check(true, "the accent colour reaches the viewer as soon as it changes");
    // Leaving without Save keeps the change: the page reloaded, Edit theme brings it back with a note.
    await page.goto(`${base}/songs/${id}?tab=shape`);
    await page.waitForSelector("[data-shape]");
    await openPanel(page, "colour");
    await page.waitForSelector("[data-theme-restored]", { timeout: 10_000 }).catch(() => {});
    check(!!(await page.$("[data-theme-restored]")) && !!(await page.$("[data-theme-unsaved]")), "unsaved changes come back after leaving the editor (with a note)");
    check(look("accentColour") === accentBefore, "…still not saved in the theme");
    await page.click("[data-theme-cancel]");
    await page.waitForFunction((a: string) => document.querySelector("[data-look-preview]")?.getAttribute("data-accent") === a, accentBefore);
    check(look("accentColour") === accentBefore && !(await page.$("[data-theme-editors]")), "Cancel: the theme as it was, in the viewer too");
    await openPanel(page, "colour");
    check(!(await page.$("[data-theme-restored]")), "…and after Cancel nothing comes back");
    await page.click("[data-theme-cancel]");
    await openPanel(page, "colour");
    await setAccent("#33aaff");
    await saveTheme(page);
    check(await saved("accentColour", "#33AAFF"), "…and Save keeps it");
    // Picture: the grade, vignette, behind the words and the background without a clip; the viewer shows each click.
    await openPanel(page, "colour");
    await page.selectOption("[data-picture-select='grade']", "warm");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-grade") === "warm");
    check(true, "Picture: the colour grade reaches the viewer at once");
    await page.selectOption("[data-picture-select='vignette']", "soft");
    await page.selectOption("[data-picture-select='textBacking']", "box");
    const boxed = await page
      .waitForFunction(() => [...document.querySelectorAll("[data-lyric] div")].some((d) => getComputedStyle(d).backgroundColor === "rgba(0, 0, 0, 0.72)"), null, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    await page.screenshot({ path: path.join(os.tmpdir(), "box-viewer.png") });
    check(boxed, "Behind the words: Box draws a dark box behind the lines in the viewer");
    const barAt = await page.evaluate(() =>
      Object.fromEntries((["editing", "[data-theme-editing]", "bar", "[data-theme-save-as]", "text", "[data-editor-section='cards']"] as string[]).flatMap((v, i, a) => (i % 2 ? [] : [[v, document.querySelector(a[i + 1])?.getBoundingClientRect().top ?? NaN]]))),
    );
    check(barAt.editing < barAt.bar && barAt.bar < barAt.text, "Save and Save as new theme sit right below Editing:, above the sections");
    // Cards → "This song → Card text": all the cards' words for this song in one place.
    await page.click("[data-card-text-link]");
    await page.waitForSelector("[data-card-text]", { timeout: 5000 }).catch(() => {});
    const cardText = await page.$$eval("[data-card-text] [data-field]", (els) => els.map((e) => e.getAttribute("data-field")));
    check(!!(await page.$("[data-card-text] [data-card-title]")) && ["tagline", "hookText", "endText"].every((f) => cardText.includes(f)), `This song → Card text: Title, Tagline, Hook and End card text together (${cardText.join(", ")})`);
    await openPanel(page, "colour");
    await page.fill("[data-edit-code^='textColour']", "255, 45, 149");
    await page.press("[data-edit-code^='textColour']", "Enter");
    await page.waitForFunction(() => (document.querySelector("[data-edit-code^='textColour']") as HTMLInputElement | null)?.value === "#FF2D95", null, { timeout: 5_000 }).catch(() => {});
    check((await page.inputValue("[data-edit-code^='textColour']")) === "#FF2D95", "Text colour: a typed RGB code becomes #FF2D95");
    await page.fill("[data-edit-code^='textColour']", "pinkish");
    await page.press("[data-edit-code^='textColour']", "Enter");
    check(!!(await page.$("[data-colour-bad]")), "…and something that is not a colour says what to type");
    await page.press("[data-edit-code^='textColour']", "Escape");
    await page.selectOption("[data-picture-select='fallback']", "colour");
    await page.waitForSelector("[data-field='fallbackColour']");
    check(true, "Background without a clip: Plain colour shows its colour row");
    await page.click("[data-picture-option='gradeCanvas']");
    await page.selectOption("[data-picture-select='titleStyle']", "extrude");
    await page.selectOption("[data-picture-select='titleWarp']", "arc");
    await page.click("[data-text-layout=lower]");
    check((await page.getAttribute("[data-text-layout=lower]", "aria-pressed")) === "true", "Text → Text layout: Lower third picked (Centred, Lower third, Big hook)");
    check(!!(await page.$("[data-title-sample] span span")), "Cards: the title sample is drawn in the chosen style and shape");
    await saveTheme(page);
    check((await saved("grade", "warm")) && look("vignette") === "soft" && look("textBacking") === "box" && look("fallback") === "colour" && look("gradeCanvas") === "off" && look("titleStyle") === "extrude" && look("titleWarp") === "arc" && look("textLayout") === "lower", "Save: the picture, the title style and the text layout go into the theme");
    // A second song on the same theme: Save says so; "Save as new theme" keeps it as it is for the other song.
    const shared = readRecipe(recipe).theme!;
    const other = path.join(root, "Let Go.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=4", other);
    const otherId = (await createSong(ws2, { song: other, lyrics })).id;
    writeRecipe(songPathsById(ws2, otherId).recipe!, { theme: shared });
    await page.reload();
    await page.click("[data-stage=shape]");
    await page.waitForSelector("[data-shape-tabs]");
    await openPanel(page, "effects");
    check(((await page.textContent("[data-theme-banner]")) ?? "").includes("2 songs"), `a shared theme says so (${await page.textContent("[data-theme-banner]")})`);
    check(((await page.textContent("[data-theme-save]")) ?? "") === "Save (changes 2 songs)", "Save names the songs it changes");
    await page.check("[data-try-addon=heldGlow]");
    await page.click("[data-theme-save-as]");
    await page.fill("[data-theme-save-as-name]", "Hold On Glow");
    await page.click("[data-theme-save-as-confirm]");
    await page.waitForSelector("[data-theme-current='Hold On Glow']");
    check(readRecipe(recipe).theme === "Hold On Glow" && loadTheme(wsDir, "Hold On Glow").look.heldGlow === "on", "Save as new theme: this song uses the new theme, with Held-note glow");
    check(loadTheme(wsDir, shared).look.heldGlow !== "on" && readRecipe(songPathsById(ws2, otherId).recipe!).theme === shared, "…the other song keeps its theme as it was");
    // New theme, rename, delete and restore: the Themes page only (N1; themes.e2e.ts). Here the song moves to a new
    // theme "Night Drive" made from the shared one, as the Themes page's New theme does.
    check(!(await page.$("[data-theme-new]")) && !(await page.$("[data-theme-tile]")) && !(await page.$("[data-theme-use]")), "Shape has no theme library: no New theme, tiles or Use for this song");
    createTheme(ws2, { projectId: id, name: "Night Drive", from: shared, catalog: loadFontCatalog(wsDir) });
    await page.reload();
    await page.click("[data-stage=shape]");
    await page.waitForSelector("[data-shape-tabs]");
    // Shape's Look bar (any other panel): the song's theme, Change opens the picker; a click only previews.
    await openPanel(page, "part");
    await page.waitForSelector("[data-look-bar='Night Drive']");
    const bar = await page.$eval("[data-look-bar]", (e: Element) => ({ y: e.getBoundingClientRect().top, tools: document.querySelector("[data-shape-tools]")!.getBoundingClientRect().top, mark: !!e.querySelector("[data-look-customized]") }));
    check(bar.y - bar.tools < 80 && !bar.mark, `the Look bar at the top of the panel, Night Drive not marked customized (${JSON.stringify(bar)})`);
    check(!(await page.$("[data-look-bar] [data-theme-edit], [data-look-bar] [data-theme-new], [data-look-bar] [data-theme-reach]")), "the Look bar: no Edit / New theme, no second badge");
    await page.click("[data-look-change]");
    await page.waitForSelector("[data-theme-picker]");
    const picks = await page.$$eval("[data-theme-pick]", (e: Element[]) => e.map((x) => x.getAttribute("data-theme-pick")));
    check(picks.includes("Night Drive") && picks.includes(shared) && picks.includes("Hold On Glow"), `the picker lists every theme (${picks.join(", ")})`);
    check((await page.getAttribute("[data-theme-pick='Night Drive'] [data-theme-pick-state]", "data-theme-pick-state")) === "selected" && (await page.isDisabled("[data-theme-apply]")), "the current theme is Selected; Apply waits for a choice");
    await page.fill("[data-theme-picker-search]", "glow");
    check(JSON.stringify(await page.$$eval("[data-theme-pick]", (e: Element[]) => e.map((x) => x.getAttribute("data-theme-pick")))) === JSON.stringify(["Hold On Glow"]), "search filters the themes");
    await page.click("[data-theme-pick='Hold On Glow']");
    await page.waitForSelector("[data-theme-pick='Hold On Glow'] [data-theme-pick-state=previewing]");
    check(((await page.textContent("[data-look-preview-caption]")) ?? "").includes("Previewing the theme Hold On Glow") && readRecipe(recipe).theme === "Night Drive", "a click previews the theme in the viewer; nothing is saved");
    check(((await page.textContent("[data-theme-apply-note]")) ?? "").includes("lyric timing stay exactly as they are"), "the note says what Apply keeps");
    if (process.env.PICKER_SHOT) await page.screenshot({ path: process.env.PICKER_SHOT });
    await page.click("[data-theme-picker-cancel]");
    await page.waitForSelector("[data-theme-picker]", { state: "detached" });
    await page.waitForFunction(() => !(document.querySelector("[data-look-preview-caption]")?.textContent ?? "").includes("Previewing"), null, { timeout: 3000 }).catch(() => {}); // the viewer follows a render later
    check(!((await page.textContent("[data-look-preview-caption]")) ?? "").includes("Previewing") && readRecipe(recipe).theme === "Night Drive", `Cancel: the current look is back, nothing saved (${await page.textContent("[data-look-preview-caption]")}; ${readRecipe(recipe).theme})`);
    await page.click("[data-look-change]");
    await page.click(`[data-theme-pick="${shared}"]`);
    await page.click("[data-theme-apply]");
    await page.waitForSelector(`[data-look-bar="${shared}"]`);
    check(readRecipe(recipe).theme === shared && !(await page.$("[data-theme-picker]")), "Apply: the song uses the theme, the picker closes");
    // Shape -> Make -> Shape: it is all saved, so it is all still there.
    await page.click("[data-stage=make]");
    await page.waitForFunction(() => !document.querySelector("[data-effect-preview]"));
    await page.click("[data-stage=shape]");
    await openPanel(page, "effects");
    await page.waitForSelector("[data-effect-preview]");
    check((await page.getAttribute("[data-effect-picker]", "data-current")) === "typewriter" && (await page.$eval("[data-try-breathe]", (s: Element) => (s as HTMLSelectElement).value)) === "beat", "Shape -> Make -> Shape: the saved effect and Breathe are there");
    for (const w of [1280, 1366]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await sleep(300);
      const right = await page.$eval("[data-look-preview]", (e: Element) => e.getBoundingClientRect().right);
      check(right <= w, `at ${w} px the viewer's right edge is inside the window (${Math.round(right)} px)`);
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    if (process.env.EDITOR_SHOT) await page.screenshot({ path: process.env.EDITOR_SHOT });
    await page.click("[data-theme-cancel]");
    // Make (the rail; with a plan the page has no Next: Make since 2 Nov 2026).
    await page.click("[data-stage=make]");
    await page.waitForSelector("[data-release-pack]");
    check((await page.getAttribute("[data-stage=make]", "aria-current")) === "step", '"Next: Make" opens Make');
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
