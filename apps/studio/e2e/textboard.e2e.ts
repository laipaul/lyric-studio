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

import { openPanel } from "./stage-tabs";

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
    await page.waitForSelector("[data-shot='1']", { timeout: 180_000 }); // planned on opening the Shape page
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
    // Fixing the line's words on its card: lyrics.txt gets them, the timing and the card's look stay.
    await page.fill("[data-line-text]", "Through the long night");
    await page.click("[data-line-fix]");
    await page.waitForSelector("[data-textboard-notice]", { timeout: 60_000 });
    await replanned();
    check(readFileSync(paths.lyricsTxt, "utf8").split("\n")[2] === "Through the long night", "Text → Fix: the line's words are fixed in lyrics.txt");
    check(((await page.textContent("[data-textboard-notice]")) ?? "").includes("The lyric timing is still valid") && !(await page.$("[data-stale-timing]")), "…its timing is kept (no new alignment), and the note says the timing is still valid");
    const fixed = board().cards.find((c: { id: string }) => c.id === "line-3");
    check(fixed?.text === "Through the long night" && JSON.stringify(fixed?.overrides) === JSON.stringify({ position: "upper", size: 1.5 }), `…the card keeps its look (${JSON.stringify(fixed)})`);
    await page.waitForSelector("[data-lyric='Through the long night']", { timeout: 30_000 }).catch(() => {});
    check(!!(await page.$("[data-lyric='Through the long night']")), "…and the video shows the new words");

    // The title card, shown on Reels too.
    await page.click("[data-open-card='title']");
    await page.waitForSelector("[data-card-editor='title']");
    await page.selectOption("[data-card-show]", "true");
    await page.fill("[data-card-hold]", "3");
    // 11 Nov 2026: title cards are saved as they are changed (no Save button) and the video is planned again.
    check(!(await page.$("[data-card-editor='title'] [data-card-save]")), "a title card has no Save button: saved as changed");
    await replanned();
    await page.waitForSelector("[data-textboard-titles] [data-text-card='title']");
    check(((await page.textContent("[data-text-card='title']")) ?? "").includes("Text Board"), "the title card is on the timeline (the song's title)");
    // The card editor's font: pick one, then make it the brand's title font (asks first).
    await page.click("[data-open-card='title']");
    await page.waitForSelector("[data-card-editor='title'] [data-card-font]");
    await page.selectOption("[data-card-font]", "Playfair Display");
    page.once("dialog", (d) => void d.accept());
    await page.click("[data-brand-title-font]");
    await page.waitForSelector("[data-brand-title-font-note]");
    const brandFile = path.join(wsDir, "brand", "brand.json");
    const brandJson = existsSync(brandFile) ? (JSON.parse(readFileSync(brandFile, "utf8")) as { titleFont?: { family?: string } }) : {};
    check(brandJson.titleFont?.family === "Playfair Display", "brand.json titleFont is now Playfair Display (after the confirmation)");
    await page.click("[aria-label='close the card editor']");

    // Save as template (the design, not the words), then apply it: in the Text panel.
    await page.click("[data-open-card='title']"); // the Text panel opens from a text card (no rail menu since themes)
    await page.waitForSelector("[data-text-panel]");
    await page.fill("[data-template-name]", "Clean");
    await page.click("[data-template-save]");
    await page.waitForSelector("[data-textboard-notice]");
    const tplFile = path.join(wsDir, "templates", "Life Lyrics", "Clean.json");
    const tpl = existsSync(tplFile) ? readFileSync(tplFile, "utf8") : "";
    check(tpl.includes('"show": true') && !tpl.includes("Through the long night") && !tpl.includes("Text Board"), "the template keeps the design without the words");
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
    await page.waitForSelector("[data-storyboard-picture]", { state: "attached", timeout: 180_000 }); // in the Analysis panel (2 Nov 2026)
    await page.waitForSelector("[data-needs-clip='02_b.mp4']");
    const linesAfter = await page.$$eval("[data-textboard-row] [data-card]", (els: Element[]) => els.map((e) => e.textContent));
    check(JSON.stringify(linesAfter) === JSON.stringify(linesBefore), "the same textboard over the new pictures");
    check(((await page.textContent("[data-slots]")) ?? "").includes('line 4 "Verse two here" (was 02_b.mp4)'), "line 4 is a slot (its clip is not in city), highlighted and listed");
    const shotClips = await page.$$eval("[data-shot]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
    check(shotClips.every((t) => /street|lights|bridge|park/.test(t)), "the shots use the city clips");
    await openPanel(page, "clips");
    await page.dragAndDrop("[data-story-clip='03_bridge.mp4']", "[data-story-line='4']");
    await replanned();
    await page.waitForSelector("[data-story-line='4'][data-anchored='03_bridge.mp4']", { timeout: 60_000 }).catch(() => null);
    const line4 = await page.$eval("[data-story-line='4']", (e: Element) => `${e.getAttribute("data-anchored")} ${e.getAttribute("data-needs-clip")}`);
    check(!(await page.$("[data-needs-clip]")) && line4 === "03_bridge.mp4 null", `a city clip dragged onto the slot fills it (${line4})`);
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "textboard.png") });
    check(existsSync(songFile), "the song file is untouched");
    // Song Details -> "Tagline look..." (11 Nov 2026): Shape opens on Settings -> Look with the tagline's editor; colour,
    // transparency and capitals; saved as changed (textboard.json).
    const recipeNow = JSON.parse(readFileSync(paths.recipe!, "utf8"));
    writeFileSync(paths.recipe!, JSON.stringify({ ...recipeNow, tagline: "Art: @noriko_imazeki", titleOpening: "on", section: "0:00-0:10" })); // a 2 s lead-in: the cards have time on screen
    await page.goto(`${base}/songs/${sp.project.id}?tab=details`);
    await page.waitForSelector("[data-tagline-look]");
    await page.click("[data-tagline-look]");
    await page.waitForSelector("[data-title-cards] [data-card-editor='tagline']", { timeout: 180_000 }).catch(async () => { await page.screenshot({ path: process.env.TB_SHOT ?? path.join(root, "textboard-look.png") }); throw new Error("no tagline editor in Look"); });
    check((await page.getAttribute("[data-shape-tab=settings]", "aria-selected")) === "true" && (await page.getAttribute("[data-settings-toggle=look]", "aria-expanded")) === "true", "Credits look... opens Shape -> Settings -> Look with the tagline's editor");
    check((await page.$eval("[data-look-advanced]", (e: Element) => (e as HTMLDetailsElement).open)) === true, "…under Advanced, unfolded");
    await page.fill("[data-title-cards] [data-card-colour]", "#336699");
    await page.fill("[data-title-cards] [data-card-opacity]", "0.6");
    await page.selectOption("[data-title-cards] [data-card-upper]", "true");
    const tagOverrides = () => (board().cards as { id: string; overrides: Record<string, unknown> }[]).find((c) => c.id === "tagline")?.overrides ?? {};
    for (let i = 0; i < 60 && tagOverrides().upper !== true; i++) await sleep(250);
    const own = tagOverrides();
    check(own.colour === "#336699" && own.opacity === 0.6 && own.upper === true, `the tagline's colour, transparency and capitals are saved as changed (${JSON.stringify(own)})`);
    // Look -> Title cards made obvious (11 Nov 2026): one row per card (text + its look in one line + Edit), the editor
    // under the row; the text read-only here; the viewer shows the card fully; hover / click in the viewer and on the
    // timeline open it.
    const rows = await page.$$eval("[data-title-card-row]", (e: Element[]) => e.map((x) => x.getAttribute("data-title-card-row")));
    check(rows.includes("title") && rows.includes("tagline"), `one row per title card (${rows.join(", ")})`);
    const summary = (await page.textContent("[data-title-card-row='tagline'] [data-title-card-summary]")) ?? "";
    check(/ · .*% · .* · (CAPITALS|as written)/.test(summary), `each row says its look: font · colour/transparency · place · capitals (${summary})`);
    check(!!(await page.$("[data-title-card-row='tagline'][data-open='1'] [data-card-editor='tagline']")) && !(await page.$("[data-card-editor='tagline'] input[data-card-text]")) && !!(await page.$("[data-card-editor='tagline'] [data-card-text-link]")), "the open card's editor sits under its highlighted row; its text is read-only with a link to Song Details");
    // The viewer checks on the title: this song's part starts on its first sung line, so with the title opening the cards
    // have no time on screen; without it the title shows its own 3 s (set above).
    writeFileSync(paths.recipe!, JSON.stringify({ ...JSON.parse(readFileSync(paths.recipe!, "utf8")), titleOpening: "off" }));
    await page.reload();
    await openPanel(page, "look");
    await page.click("[data-look-advanced] summary"); // the cards' own look sits under Advanced
    await page.waitForSelector("[data-title-card-edit='title']", { timeout: 180_000 });
    await page.click("[data-title-card-edit='title']");
    await page.waitForSelector("[data-title-card-row='title'][data-open='1'] [data-card-editor='title']");
    await page.waitForSelector("[data-viewer] [data-text-card='title']", { timeout: 30_000 });
    await sleep(400);
    const shown = await page.$eval("[data-viewer] [data-text-card='title']", (e: Element) => {
      let o = 1;
      for (let el: Element | null = e; el && !el.matches("[data-viewer]"); el = el.parentElement) o *= Number(getComputedStyle(el).opacity || 1);
      return o;
    });
    check(shown > 0.95, `Edit: the viewer goes to a moment where the card is fully visible (opacity ${shown.toFixed(2)})`);
    await page.hover("[data-viewer] [data-text-card='title']");
    await sleep(200);
    check(!!(await page.$("[data-viewer] [data-card-hover='1']")), "hovering a title card in the viewer outlines it");
    await page.click("[data-title-card-edit='title']"); // close it
    await page.click("[data-viewer] [data-text-card='title']");
    await page.waitForSelector("[data-title-card-row='title'][data-open='1']");
    check(true, "a click on the card in the viewer opens its settings in Look");
    await page.click("[data-title-card-edit='title']"); // close it again
    await page.waitForSelector("[data-title-card-row='title'][data-open='0']");
    await page.click("[data-textboard-titles] [data-text-card='title']");
    await page.waitForSelector("[data-title-card-row='title'][data-open='1'] [data-card-editor='title']");
    check((await page.getAttribute("[data-shape-tab=settings]", "aria-selected")) === "true", "the title's T bar on the timeline opens it in Look too");
    // Look -> On-screen text (11 Nov 2026): Title, Artist, Credits each on / off, the words shared with Song Details.
    check((await page.getAttribute("[data-on-screen='tagline']", "data-on")) === "0", "with the title opening off the credits are off");
    await page.click("[data-on-screen-toggle='tagline']");
    for (let i = 0; i < 60 && tagOverrides().show !== true; i++) await sleep(250);
    const recipeOpen = () => JSON.parse(readFileSync(paths.recipe!, "utf8")) as Record<string, unknown>;
    for (let i = 0; i < 60 && recipeOpen().titleOpening !== "on"; i++) await sleep(250);
    check(tagOverrides().show === true && recipeOpen().titleOpening === "on" && tagOverrides().colour === "#336699", `Credits on: the card is shown (its own look kept) and the Reel gets its title opening (${JSON.stringify(tagOverrides())}, ${recipeOpen().titleOpening})`);
    await page.waitForSelector("[data-on-screen='tagline'][data-on='1']");
    await page.fill("[data-on-screen-text-input='tagline']", "Art: Noriko Imazeki");
    await page.press("[data-on-screen-text-input='tagline']", "Enter");
    for (let i = 0; i < 60 && recipeOpen().tagline !== "Art: Noriko Imazeki"; i++) await sleep(250);
    check(recipeOpen().tagline === "Art: Noriko Imazeki", `Credits edited in Look: the same words as Song Details (song.json tagline: ${recipeOpen().tagline})`);
    check(!(await page.$("[data-on-screen-text-input='byline']")) && ((await page.textContent("[data-on-screen='byline']")) ?? "").length > 6, "the artist is shown, read-only (changed in the Library)");
    await page.click("[data-on-screen-toggle='tagline']");
    for (let i = 0; i < 60 && tagOverrides().show !== false; i++) await sleep(250);
    check(tagOverrides().show === false, "Credits off: hidden in the video");
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
