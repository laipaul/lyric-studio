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
import { openPanel } from "./stage-tabs";

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
    check(JSON.stringify(await tabs()) === JSON.stringify(["Assets", "Lyrics"]), "Prepare shows only Assets and Lyrics");
    // L1a: the Assets tab has the vocal stem slot next to the song (none yet: "Add…").
    await page.click("[data-todo-item=vocals] button");
    await page.waitForSelector("[data-asset=vocals]");
    const slot = (await page.textContent("[data-asset=vocals]")) ?? "";
    check(slot.includes("Vocal stem") && slot.includes("Add…") && slot.includes("the app separates the vocals itself"), `the Assets tab offers the vocal stem (${slot})`);
    const order = await page.$$eval("[data-asset]", (e: Element[]) => e.map((x) => x.getAttribute("data-asset")));
    check(order.indexOf("vocals") === order.indexOf("song") + 1, `the vocal stem sits next to the song (${order.join(", ")})`);
    // Original file names: files put into the song folder by hand are recognised, the rest asked about once.
    const wsF = openWorkspace(wsDir);
    const folder = songPathsById(wsF, id).root;
    wsF.close();
    check(readFileSync(path.join(folder, ".studio", "files.json"), "utf8").includes('"song": "Hold On.wav"'), "the song keeps its own name (Hold On.wav, linked in .studio\\files.json)");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=2", path.join(folder, "Hold On (Backing Vocals).wav"));
    writeFileSync(path.join(folder, "notes.txt"), "call the label\n");
    await page.reload();
    await page.click("[data-todo-item=vocals] button");
    await page.waitForSelector("[data-unassigned-file='notes.txt']");
    check(((await page.textContent("[data-asset=backingVocals]")) ?? "").includes("Hold On (Backing Vocals).wav"), "a backing-vocals file dropped by hand is recognised by its name");
    check(!(await page.$("[data-unassigned-file='Hold On (Backing Vocals).wav']")), "…and not asked about");
    await page.click("[data-unassigned-file='notes.txt'] [data-assign=notUsed]");
    await page.waitForFunction(() => !document.querySelector("[data-unassigned]"));
    check(true, "\"What is this file?\" → Not used: not asked again");
    await page.click("[data-todo-item=labels] button");
    check((await page.getAttribute("[role=tab][data-state=active]", "id"))?.endsWith("lyrics") ?? false, "the label item's button opens the Lyrics tab");

    // Shape and Review show their own tabs; Make has the release pack.
    await page.click("[data-stage=shape]");
    check(JSON.stringify(await tabs()) === JSON.stringify([]), "Shape is one page (no tabs)");
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
    // The Shape page, Canva style: a slim header (cover, title, stats); a rail on the left with the stages
    // and, on Shape, its menus; each menu opens one panel beside the rail; the editor fills the rest.
    writeRecipe(recipe, { ...readRecipe(recipe), tempo: 96, ending: "fade", locked: ["tempo"] });
    await page.click("[data-stage=shape]");
    await page.waitForSelector("[data-shape-menus]");
    check((await page.$$("[role=tab]")).length === 0, "Shape is one page: no Style / Storyboard tabs");
    check(((await page.textContent("[data-song-header] h1")) ?? "").length > 0, "the slim header keeps the song title");
    const railBox = await (await page.$("[data-rail]"))!.boundingBox();
    const stageIds = await page.$$eval("[data-rail] [data-stage]", (e: Element[]) => e.map((x) => x.getAttribute("data-stage")));
    check(JSON.stringify(stageIds) === JSON.stringify(["prepare", "shape", "make", "review"]) && !!railBox && railBox.x < 5 && railBox.width < 100, `the stages sit in the rail on the left (${stageIds.join(", ")})`);
    const menus = await page.$$eval("[data-rail-item]", (e: Element[]) => e.map((x) => x.getAttribute("data-rail-item")));
    check(JSON.stringify(menus) === JSON.stringify(["fonts", "effects", "colour", "clips", "text", "song", "make", "auto"]), `Shape's menus in the rail (${menus.join(", ")})`);
    check(!(await page.isVisible("[data-shape-tools]")), "no panel open: the editor takes the whole width");
    const viewerBox = await (await page.waitForSelector("[data-viewer], [data-look-preview]")).boundingBox();
    check(!!viewerBox && viewerBox.y < 300, `the viewer at the top of the editor (${JSON.stringify(viewerBox)})`);
    check(!!(await page.$("[data-next-make]")), '"Next: Make" under the viewer');
    const inBlock = async (b: string) => page.$$eval(`[data-style-block=${b}] [data-field]`, (e: Element[]) => e.map((x) => x.getAttribute("data-field")));
    await openPanel(page, "colour");
    const toolsBox = await (await page.$("[data-shape-tools]"))!.boundingBox();
    const viewerAfter = await (await page.$("[data-viewer], [data-look-preview]"))!.boundingBox();
    check(!!toolsBox && !!viewerAfter && toolsBox.x + toolsBox.width <= viewerAfter.x + 1, `the panel opens beside the rail, left of the viewer (${JSON.stringify(toolsBox)} / ${JSON.stringify(viewerAfter)})`);
    check(JSON.stringify(await inBlock("colour")) === JSON.stringify(["accentColour"]), `Colour: the accent colour row (${(await inBlock("colour")).join(", ")})`);
    await page.click("[data-rail-item=colour]");
    check(!(await page.isVisible("[data-shape-tools]")), "a second click on the menu closes its panel");
    await openPanel(page, "song");
    const songLine = (await page.textContent("[data-compact-summary=song]")) ?? "";
    check(songLine === "Tagline: none · EP: none · YouTube: cover · Title opening: off", `This song's line (${songLine})`);
    check(JSON.stringify(await inBlock("song")) === JSON.stringify(["tagline", "ep", "youtubeLayout", "titleOpening"]), `This song: tagline, EP, YouTube layout, title opening (${(await inBlock("song")).join(", ")})`);
    await openPanel(page, "make");
    const makeLine = (await page.textContent("[data-compact-summary=make]")) ?? "";
    check(makeLine.startsWith("Reels 3 · YouTube 1") && makeLine.includes("clips: the song's own"), `What to make's line (${makeLine})`);
    check(JSON.stringify(await inBlock("make")) === JSON.stringify(["platforms", "variations", "collections"]), `What to make: platforms, videos per platform, collections (${(await inBlock("make")).join(", ")})`);
    check((await page.$$("[data-style-block]")).length === 1, "one panel at a time");
    await page.click("[data-panel-close]");
    check(!(await page.isVisible("[data-shape-tools]")), "the panel's × closes it");
    if (process.env.STYLE_SHOT) {
      await openPanel(page, "fonts");
      await page.waitForSelector("[data-pairing-select]");
      await sleep(1500);
      await page.screenshot({ path: process.env.STYLE_SHOT });
    }
    await openPanel(page, "auto");
    check((await page.textContent("[data-auto-summary]")) === "2 set by you: Tempo, Ending", `Automatic's summary line (${await page.textContent("[data-auto-summary]")})`);
    check(JSON.stringify(await inBlock("auto")) === JSON.stringify(["shotLength", "tempo", "section", "length", "ending", "transitions", "paceShift", "readability"]), `Automatic with its eight rows (${(await inBlock("auto")).join(", ")})`);
    check(!!(await page.$("[data-field=tempo] [data-tempo-check]")), "the tempo tools are there");
    // Calm rows: only the "This song" badge; other sources in the label's tooltip; lock, reset, per platform in the ⋯ menu.
    const badges = await page.$$eval("[data-field] [data-source]", (e: Element[]) => [...new Set(e.map((x) => x.textContent))]);
    check(JSON.stringify(badges) === JSON.stringify(["This song"]), `only "This song" badges (${badges.join(", ")})`);
    check(((await page.getAttribute("[data-field=transitions] [data-source-hint]", "title")) ?? "").startsWith("From: "), "other sources: a tooltip on the label");
    check(!!(await page.$("[data-locked=tempo]")) && !(await page.$("[data-locked=shotLength]")), "a locked setting shows its padlock, the others none");
    check(!(await page.$("[data-field=shotLength] [data-lock]")) && !(await page.$("[data-field=shotLength] [data-per-platform]")), "no lock or 'per platform' buttons in the row");
    await page.click("[data-row-menu=shotLength]");
    const menuItems = await page.$$eval("[role=menuitem]", (e: Element[]) => e.map((x) => x.textContent));
    check(JSON.stringify(menuItems) === JSON.stringify(["Per platform…", "Lock: keep this song's value"]), `the ⋯ menu: per platform and lock (${menuItems.join(" | ")})`);
    await page.click("[role=menuitem][data-per-platform=shotLength]");
    check(!!(await page.$("[data-platform-value=shotLength-reels]")), "'Per platform…' opens the per-platform editors");
    check(!((await page.textContent("[data-style]")) ?? "").includes("the same on every platform"), "no 'the same on every platform' lines");
    // Fonts: one summary line; Fine-tune shows the six rows.
    await page.click("[data-rail-item=fonts]");
    await page.waitForSelector("[data-shape-panel=fonts]");
    const fontLine = (await page.textContent("[data-font-summary-text]")) ?? "";
    check(/^Fonts: verses .+ \d00(?: italic)? · choruses .+ \d00(?: italic)?$/.test(fontLine), `the font summary line (${fontLine})`);
    check((await page.$("[data-field=verseFont]")) === null, "the six font rows are folded");
    await page.click("[data-fine-tune]");
    const fontRows = await page.$$eval("[data-fine-tune-rows] [data-field]", (e: Element[]) => e.map((x) => x.getAttribute("data-field")));
    check(JSON.stringify(fontRows) === JSON.stringify(["verseFont", "verseWeight", "verseItalic", "hookFont", "hookWeight", "hookItalic"]), `Fine-tune shows the six font rows (${fontRows.join(", ")})`);
    const verseFont = await page.$eval("[data-edit='verseFont-default']", (e: Element) => (e as HTMLSelectElement).value);
    check(fontLine.startsWith(`Fonts: verses ${verseFont} `), "the summary names the verse font of the rows");
    // Set effect: every click is saved at once; the viewer (here the stand-in: the song has no timed lyrics) shows it.
    const saved = async (key: string, value: unknown) => {
      for (let i = 0; i < 40; i++) {
        if (JSON.stringify(JSON.parse(readFileSync(recipe, "utf8"))[key]) === JSON.stringify(value)) return true;
        await sleep(150);
      }
      return false;
    };
    await openPanel(page, "effects");
    await page.waitForSelector("[data-effect-preview]");
    check((await page.$$("[data-use-effect]")).length === 0 && (await page.$$("[data-unsaved]")).length === 0, "no Save to recipe buttons, no 'not saved yet' line");
    check((await page.getAttribute("[data-effect-part]", "data-effect-part")) === "verse", "Set effect starts on Verses");
    await page.click("[data-try-effect=typewriter]");
    check(await saved("verseEffect", "typewriter"), "a click on typewriter saves it as the verse effect (song.json)");
    await page.selectOption("[data-try-breathe]", "beat");
    check(await saved("breathe", "beat"), "Breathe with the beat: saved at once");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-effect") === "typewriter" && document.querySelector("[data-look-preview]")?.getAttribute("data-breathe") === "beat");
    check((await page.$$eval("[data-look-preview] [data-lyric]", (e: Element[]) => e.length)) > 0, "the viewer draws the song's lines with the effect and Breathe");
    check((await page.$$("[data-look-preview]")).length === 1, "one viewer");
    check((await page.$$("[data-effect-preview] .__remotion-player, [data-effect-preview] canvas, [data-effect-preview] [data-lyric]")).length === 0, "the Set effect panel has no player of its own");
    check(!!(await page.$("[data-effect-saved]")), "Set effect says ✓ Saved");
    await page.selectOption("[data-try-intensity]", "subtle");
    check(await saved("verseEffect", "typewriter:subtle"), "the typing pace (calm) is saved with it: typewriter:subtle");
    check(((await page.textContent("[data-set-effect]")) ?? "").includes("Verses: typewriter (calm)"), "the panel names what verses use");
    // Choruses: the switch, then the effect is saved as the hook effect; the verses keep theirs.
    await page.click("[data-part=hook]");
    await page.click("[data-try-effect=spread]");
    check(await saved("hookEffect", "spread"), "Choruses: spread saved as the hook effect (the choruses' own intensity)");
    check(JSON.parse(readFileSync(recipe, "utf8")).verseEffect === "typewriter:subtle", "…the verse effect unchanged");
    check((await page.getAttribute("[data-try-effect=spread]", "aria-pressed")) === "true", `the chorus effect shows as chosen (${await page.$$eval("[data-try-effect][aria-pressed=true]", (e: Element[]) => e.map((x) => x.textContent).join())} ${await page.textContent("[data-set-effect] p.text-muted-foreground")})`);
    await page.click("[data-part=verse]");
    check((await page.getAttribute("[data-try-effect=typewriter]", "aria-pressed")) === "true", "back on Verses: typewriter is chosen");
    // Held-note glow: on for this song, then "Use Breathe and add-ons for all my songs" (brand.json, every platform with lyrics).
    await page.check("[data-try-addon=heldGlow]");
    check(await saved("heldGlow", "on"), "Held-note glow on: saved at once");
    await page.click("[data-row-menu=effects]");
    await page.click("[role=menuitem][data-brand-all=effects]");
    await page.click("[data-brand-all-yes=effects]");
    await page.waitForFunction(() => !document.querySelector("[data-brand-all-ask=effects]"));
    await page.waitForSelector("[data-saving=saved]");
    await sleep(800);
    const brand = JSON.parse(readFileSync(path.join(wsDir, "brand", "brand.json"), "utf8")) as { perPlatform?: Record<string, { heldGlow?: string; breathe?: string }> };
    check(brand.perPlatform?.reels?.heldGlow === "on" && brand.perPlatform?.youtube?.heldGlow === "on" && brand.perPlatform?.reels?.breathe === "beat" && !brand.perPlatform?.canvas, `Use for all my songs: brand.json on every platform with lyrics (${JSON.stringify(brand.perPlatform)})`);
    check(JSON.parse(readFileSync(recipe, "utf8")).heldGlow === undefined, "…and the song follows the brand (its own value removed)");
    check((await page.isChecked("[data-try-addon=heldGlow]")) === true, "…still on, now from the brand");
    // Shape -> Make -> Shape: it is all saved, so it is all still there.
    await page.click("[data-stage=make]");
    await page.waitForFunction(() => !document.querySelector("[data-effect-preview]"));
    await page.click("[data-stage=shape]");
    await page.waitForSelector("[data-effect-preview]");
    check((await page.getAttribute("[data-try-effect=typewriter]", "aria-pressed")) === "true" && (await page.$eval("[data-try-breathe]", (s: Element) => (s as HTMLSelectElement).value)) === "beat", "Shape -> Make -> Shape: the saved effect and Breathe are there");
    for (const w of [1280, 1366]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await sleep(300);
      const right = await page.$eval("[data-look-preview]", (e: Element) => e.getBoundingClientRect().right);
      check(right <= w, `at ${w} px the viewer's right edge is inside the window (${Math.round(right)} px)`);
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    // The accent colour reaches the viewer at once.
    await openPanel(page, "colour");
    await page.$eval("[data-edit='accentColour-default']", (el: Element) => {
      const input = el as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "#33aaff");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-accent") === "#33AAFF");
    check(true, "the accent colour reaches the viewer as soon as it changes");
    await page.waitForFunction(() => document.querySelector("[data-saving]")?.getAttribute("data-saving") === "saved");
    await sleep(500);
    check(JSON.parse(readFileSync(recipe, "utf8")).accentColour === "#33AAFF" && (await page.getAttribute("[data-look-preview]", "data-accent")) === "#33AAFF", "…and stays after the save");
    // Next: Make.
    await page.click("[data-next-make]");
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
