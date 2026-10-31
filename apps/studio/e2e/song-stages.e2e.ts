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
import { createSong, loadTheme, readRecipe, songPathsById, writeRecipe } from "@lyric/video/node";
import { openPanel, saveTheme } from "./stage-tabs";

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
    check(JSON.stringify(menus) === JSON.stringify(["theme", "clips", "song", "make", "auto"]), `Shape's menus in the rail (${menus.join(", ")})`);
    check(!(await page.isVisible("[data-shape-tools]")), "no panel open: the editor takes the whole width");
    const viewerBox = await (await page.waitForSelector("[data-viewer], [data-look-preview]")).boundingBox();
    check(!!viewerBox && viewerBox.y < 300, `the viewer at the top of the editor (${JSON.stringify(viewerBox)})`);
    check(!!(await page.$("[data-next-make]")), '"Next: Make" under the viewer');
    const inBlock = async (b: string) => page.$$eval(`[data-style-block=${b}] [data-field]`, (e: Element[]) => e.map((x) => x.getAttribute("data-field")));
    await openPanel(page, "theme");
    // The Theme panel: the song's theme (a new song: the artist's default theme) and a tile per theme.
    const themeName = (await page.getAttribute("[data-theme-current]", "data-theme-current")) ?? "";
    check(themeName.length > 0 && (await page.getAttribute(`[data-theme-tile="${themeName}"]`, "aria-pressed")) === "true", `the song's theme, its tile chosen (${themeName})`);
    check(((await page.textContent("[data-theme-users]")) ?? "") === "Used by this song only", "used by this song only");
    check((await page.$("[data-theme-editors]")) === null, "the editors open with Edit theme");
    await openPanel(page, "colour");
    const toolsBox = await (await page.$("[data-shape-tools]"))!.boundingBox();
    const viewerAfter = await (await page.$("[data-viewer], [data-look-preview]"))!.boundingBox();
    check(!!toolsBox && !!viewerAfter && toolsBox.x + toolsBox.width <= viewerAfter.x + 1, `the panel opens beside the rail, left of the viewer (${JSON.stringify(toolsBox)} / ${JSON.stringify(viewerAfter)})`);
    check((await inBlock("theme")).includes("accentColour"), `Edit theme: the accent colour row (${(await inBlock("theme")).join(", ")})`);
    await page.click("[data-rail-item=theme]");
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
      await openPanel(page, "theme");
      if (await page.$("[data-theme-cancel]")) await page.click("[data-theme-cancel]");
      await page.waitForSelector("[data-theme-tiles]");
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
    check(JSON.stringify(sections) === JSON.stringify(["text", "motion", "colours", "picture", "cards"]), `the theme editor: Text, Motion, Colours, Picture, Cards (${sections.join(", ")})`);
    check((await page.getAttribute("[data-effect-part]", "data-effect-part")) === "verse", "Set effect starts on Verses");
    const before = look("verseEffect");
    await page.click("[data-try-effect=typewriter]");
    await page.selectOption("[data-try-breathe]", "beat");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-effect") === "typewriter" && document.querySelector("[data-look-preview]")?.getAttribute("data-breathe") === "beat");
    check((await page.$$eval("[data-look-preview] [data-lyric]", (e: Element[]) => e.length)) > 0, "the viewer shows the effect and Breathe at once");
    check(look("verseEffect") === before && !!(await page.$("[data-theme-unsaved]")), "…but nothing is saved yet ('not saved yet')");
    check((await page.$$("[data-look-preview]")).length === 1, "one viewer");
    check((await page.$$("[data-effect-preview] .__remotion-player, [data-effect-preview] canvas, [data-effect-preview] [data-lyric]")).length === 0, "the Set effect panel has no player of its own");
    await page.selectOption("[data-try-intensity]", "subtle");
    check(((await page.textContent("[data-set-effect]")) ?? "").includes("Verses: Typewriter (calm)"), "the panel names what verses use");
    // Choruses: the switch, then the effect goes to the hook effect; the verses keep theirs.
    await page.click("[data-part=hook]");
    await page.click("[data-try-effect=spread]");
    check((await page.getAttribute("[data-try-effect=spread]", "aria-pressed")) === "true", "the chorus effect shows as chosen");
    await page.click("[data-part=verse]");
    check((await page.getAttribute("[data-try-effect=typewriter]", "aria-pressed")) === "true", "back on Verses: typewriter is chosen");
    check(((await page.textContent("[data-theme-save]")) ?? "") === "Save", "a theme only this song uses: plain Save");
    await saveTheme(page);
    check(await saved("verseEffect", "typewriter:subtle") && look("hookEffect") === "spread" && look("breathe") === "beat", "Save: the effects go into the song's theme (theme.json, not song.json)");
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
    await page.click("[data-theme-cancel]");
    await page.waitForFunction((a: string) => document.querySelector("[data-look-preview]")?.getAttribute("data-accent") === a, accentBefore);
    check(look("accentColour") === accentBefore && !(await page.$("[data-theme-editors]")), "Cancel: the theme as it was, in the viewer too");
    await openPanel(page, "colour");
    await setAccent("#33aaff");
    await saveTheme(page);
    check(await saved("accentColour", "#33AAFF"), "…and Save keeps it");
    // Picture: the grade, vignette, behind the words and the background without a clip; the viewer shows each click.
    await openPanel(page, "colour");
    await page.click("[data-picture-option='grade-warm']");
    await page.waitForFunction(() => document.querySelector("[data-look-preview]")?.getAttribute("data-grade") === "warm");
    check(true, "Picture: the colour grade reaches the viewer at once");
    await page.click("[data-picture-option='vignette-soft']");
    await page.click("[data-picture-option='textBacking-box']");
    await page.click("[data-picture-option='fallback-colour']");
    await page.waitForSelector("[data-field='fallbackColour']");
    check(true, "Background without a clip: Plain colour shows its colour row");
    await page.click("[data-picture-option='gradeCanvas']");
    await saveTheme(page);
    check((await saved("grade", "warm")) && look("vignette") === "soft" && look("textBacking") === "box" && look("fallback") === "colour" && look("gradeCanvas") === "off", "Save: the picture goes into the theme");
    // A second song on the same theme: Save says so; "Save as new theme" keeps it as it is for the other song.
    const shared = readRecipe(recipe).theme!;
    const other = path.join(root, "Let Go.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=4", other);
    const otherId = (await createSong(ws2, { song: other, lyrics })).id;
    writeRecipe(songPathsById(ws2, otherId).recipe!, { theme: shared });
    await page.reload();
    await page.click("[data-stage=shape]");
    await page.waitForSelector("[data-shape-menus]");
    await openPanel(page, "theme");
    check(((await page.textContent("[data-theme-users]")) ?? "").startsWith("Used by 2 songs"), `a shared theme says so (${await page.textContent("[data-theme-users]")})`);
    await openPanel(page, "effects");
    check(((await page.textContent("[data-theme-save]")) ?? "") === "Save (changes 2 songs)", "Save names the songs it changes");
    await page.check("[data-try-addon=heldGlow]");
    await page.click("[data-theme-save-as]");
    await page.fill("[data-theme-save-as-name]", "Hold On Glow");
    await page.click("[data-theme-save-as-confirm]");
    await page.waitForSelector("[data-theme-current='Hold On Glow']");
    check(readRecipe(recipe).theme === "Hold On Glow" && loadTheme(wsDir, "Hold On Glow").look.heldGlow === "on", "Save as new theme: this song uses the new theme, with Held-note glow");
    check(loadTheme(wsDir, shared).look.heldGlow !== "on" && readRecipe(songPathsById(ws2, otherId).recipe!).theme === shared, "…the other song keeps its theme as it was");
    // + New theme: named first, started from another theme, opens in the editor.
    await page.click("[data-theme-new]");
    await page.fill("[data-new-theme-name]", "Night Drive");
    await page.selectOption("[data-new-theme-from]", shared);
    await page.click("[data-new-theme-create]");
    await page.waitForSelector("[data-theme-editing='Night Drive']");
    check(readRecipe(recipe).theme === "Night Drive" && loadTheme(wsDir, "Night Drive").look.verseEffect === "typewriter:subtle", "+ New theme: named first, from the chosen theme, the song uses it, the editor opens");
    await page.click("[data-theme-cancel]");
    // A tile: Use for this song; its ⋯: Delete (an unused theme) and Restore.
    check(!!(await page.$(`[data-theme-use="${shared}"]`)) && !(await page.$("[data-theme-use='Night Drive']")), "the other tiles offer 'Use for this song'");
    await page.click("[data-row-menu='theme-Hold On Glow']");
    await page.click("[role=menuitem][data-theme-delete='Hold On Glow']");
    await page.waitForSelector("[data-removed-themes]");
    check(!(await page.$("[data-theme-tile='Hold On Glow']")) && existsSync(path.join(wsDir, "themes", "_removed")), "Delete: the theme moves to themes\\_removed\\");
    await page.click("[data-removed-themes] button[aria-expanded]");
    await page.click("[data-theme-restore='Hold On Glow']");
    await page.waitForSelector("[data-theme-tile='Hold On Glow']");
    check(true, "Restore: it is back");
    // Shape -> Make -> Shape: it is all saved, so it is all still there.
    await page.click("[data-stage=make]");
    await page.waitForFunction(() => !document.querySelector("[data-effect-preview]"));
    await page.click("[data-stage=shape]");
    await openPanel(page, "effects");
    await page.waitForSelector("[data-effect-preview]");
    check((await page.getAttribute("[data-try-effect=typewriter]", "aria-pressed")) === "true" && (await page.$eval("[data-try-breathe]", (s: Element) => (s as HTMLSelectElement).value)) === "beat", "Shape -> Make -> Shape: the saved effect and Breathe are there");
    for (const w of [1280, 1366]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await sleep(300);
      const right = await page.$eval("[data-look-preview]", (e: Element) => e.getBoundingClientRect().right);
      check(right <= w, `at ${w} px the viewer's right edge is inside the window (${Math.round(right)} px)`);
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    if (process.env.EDITOR_SHOT) await page.screenshot({ path: process.env.EDITOR_SHOT });
    await page.click("[data-theme-cancel]");
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
