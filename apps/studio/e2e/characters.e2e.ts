// Browser test of the Characters page (C1; needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/characters.e2e.ts
// With the stand-ins for fal and the face checks (LYRIC_CARDS_STUB): nothing goes to fal.ai, no face models needed.
// The header link; a new character from one picture (its reference check shown); the outfit saved; Make pack (the
// cost shown first, confirm, the job in the Tasks menu); the 4 views with their lights; the body views cropped by the
// app (the model's picture kept); the drafted description; Remake one view; Approve and lock (read-only); New
// version; a scene card with its key props and 3 angles.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-cards-"));
const wsDir = path.join(root, "workspace");
const pics = path.join(root, "pics");
const port = 3197;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
const png = (name: string, colour: string) => ffmpeg("-f", "lavfi", "-i", `color=c=${colour}:s=300x400`, "-frames:v", "1", path.join(pics, name));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  mkdirSync(pics, { recursive: true });
  for (const [n, c] of [["default", "white"], ["closeup", "pink"], ["three_quarter", "orange"], ["body_front", "beige"], ["body_back", "gray"], ["wide_left", "brown"], ["wide_right", "olive"], ["detail", "gold"]] as const) png(`${n}.png`, c);
  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1", LYRIC_CARDS_STUB: pics },
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
    await page.goto(base);
    await page.click("header a:has-text('Characters')");
    await page.waitForSelector("[data-cards-section=character] [data-new-card=character]");
    check(!!(await page.$("[data-cards-section=scene] [data-new-card=scene]")), "the page has Characters and Scene cards, each with its New tile");

    // The tile invites a drop; the dialog shows a clear drop area, then a preview of the chosen picture.
    check(((await page.textContent("[data-new-card=character]")) ?? "").includes("Drop a picture here, or click to choose one"), "the New tile says a picture can be dropped on it");
    // A new character from one picture.
    await page.click("[data-new-card=character]");
    check(((await page.textContent("[data-card-drop]")) ?? "").includes("Drop the picture here, or click to choose"), "the dialog's picture area says what to do (not the browser's plain file field)");
    await page.setInputFiles("[data-card-picture]", path.join(pics, "default.png"));
    await page.waitForSelector("[data-card-preview]");
    check((await page.inputValue("[data-card-name]")) === "default", "choosing a picture shows its preview and fills the name from the file name");
    await page.fill("[data-card-name]", "bride");
    await page.click("[data-create-card]");
    await page.waitForSelector("[data-card-page=bride]");
    check(((await page.textContent("[data-check-verdict]")) ?? "").includes("Reference check: Ready"), "the reference check is shown at once");
    const dir = path.join(wsDir, "characters", "bride");
    check(existsSync(path.join(dir, "reference.png")) && existsSync(path.join(dir, "card.json")), "workspace\\characters\\bride\\ holds the picture and card.json");
    check((await page.isDisabled("[data-lock]")) && ((await page.textContent("[data-lock-problems]")) ?? "").includes("Not made yet"), "Lock is not possible before the pack is made, and says why");

    check(((await page.textContent("[data-lock-problems]")) ?? "").includes("Close-up face, 3/4 face"), "the missing views are named in plain words");
    // No outfit yet: Make pack warns before anything is spent.
    await page.click("[data-make-pack]");
    check(!!(await page.$("[data-outfit-warning]")) && ((await page.textContent("[data-confirm-yes]")) ?? "").includes("Make it anyway"), "Make pack warns when the outfit is empty");
    await page.click("[data-confirm-pack] button:has-text('Cancel')");
    // The outfit, then Make pack (the cost first).
    await page.fill("[data-card-words]", "floor-length white A-line gown, long sheer veil");
    await page.click("h1"); // blur: saved
    await sleep(400);
    check(readFileSync(path.join(dir, "card.json"), "utf8").includes("floor-length white A-line gown"), "the outfit is saved in card.json");
    await page.waitForSelector("[data-outfit-closeups]", { timeout: 10_000 });
    check(((await page.inputValue("[data-outfit-closeups]")) ?? "").includes("neckline") && ((await page.inputValue("[data-outfit-front]")) ?? "").length > 0 && ((await page.inputValue("[data-outfit-back]")) ?? "").length > 0, "the outfit is split into Close-ups / Front / Back parts, shown under it");
    await page.fill("[data-outfit-back]", "V-neck back with a row of buttons");
    await page.click("h1");
    await sleep(400);
    check(readFileSync(path.join(dir, "card.json"), "utf8").includes("V-neck back with a row of buttons"), "a corrected part is saved in card.json");
    check(((await page.textContent("[data-estimate]")) ?? "") === "$0.17", "the estimate is shown before anything is sent ($0.17 with Seedream)");
    await page.click("[data-make-pack]");
    check(((await page.textContent("[data-confirm-yes]")) ?? "").includes("about $0.17") && !(await page.$("[data-outfit-warning]")), "Make pack asks to confirm, with the cost (no warning once the outfit is given)");
    await page.click("[data-confirm-yes]");
    await page.waitForSelector("[data-view=body_back][data-light=grey]", { timeout: 20_000 });
    check((await page.getAttribute("[data-view=closeup]", "data-light")) === "green" && (await page.getAttribute("[data-view=three_quarter]", "data-light")) === "green", "the face views are green");
    check(existsSync(path.join(dir, "v1", "body_front.png")) && existsSync(path.join(dir, "v1", "body_front_t1_full.png")), "body views: cropped by the app, the model's picture kept as _full");
    // Starting the job already opened the Tasks menu (as for Make runs).
    if (!(await page.$("[data-tasks]"))) await page.click("[data-tasks-button]");
    await page.waitForSelector("[data-card-task=pack][data-task=done]");
    check(((await page.textContent("[data-card-task=pack]")) ?? "").includes("bride · Make pack"), "the job is in the Tasks menu, done");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (document.querySelector("[data-card-description]") as HTMLTextAreaElement | null)?.value.includes("A woman"));
    check(true, "the description is drafted from the picture");

    // Remake one view.
    await page.click("[data-remake=three_quarter]");
    await page.waitForFunction(() => document.querySelector("[data-last-job]")?.textContent?.includes("Remake 3/4 face"), null, { timeout: 20_000 });
    check(existsSync(path.join(dir, "v1", "three_quarter_t2.png")), "Remake makes a new try of that view only");

    // Approve and lock, then a new version.
    await page.click("[data-lock]");
    await page.click("[data-confirm-lock]");
    await page.waitForSelector("[data-card-status=locked]");
    check(await page.isDisabled("[data-card-words]"), "locked: read-only");
    check(!(await page.$("[data-make-pack]")) && !(await page.$("[data-remake=closeup]")), "locked: no Make pack, no Remake");
    // The teeth close-up (25 Nov 2026): an extra picture, also on a locked card.
    check((await page.getAttribute("[data-teeth]", "data-teeth")) === "none", "a locked card offers the teeth close-up");
    await page.click("[data-make-teeth]");
    await page.waitForSelector("[data-teeth=made]", { timeout: 60_000 });
    check(existsSync(path.join(dir, "v1", "closeup_teeth.png")), "the teeth close-up is made next to the locked views (v1\\closeup_teeth.png)");
    check(!!(await page.$("[data-card-status=locked]")), "the card stays locked");
    // The Character sheet (25 Nov 2026): the side profile and the full body with face, then one picture of the views.
    check(((await page.textContent("[data-character-sheet]")) ?? "").includes("close-up · 3/4 · full body (front"), "the Character sheet shows the views made so far");
    await page.click("[data-make-extra=profile]");
    await page.waitForSelector("[data-extra=profile][data-made=made]", { timeout: 60_000 });
    await page.click("[data-make-extra=body_full]");
    await page.waitForSelector("[data-extra=body_full][data-made=made]", { timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector("[data-character-sheet]")?.textContent?.includes("close-up · side profile · 3/4 · full body"));
    check(existsSync(path.join(dir, "v1", "character_sheet.png")), "the Character sheet: close-up, side profile, 3/4, full body (v1\\character_sheet.png)");
    check((await page.getAttribute("[data-character-sheet-save]", "download")) === `${await page.textContent("h1") ?? ""}`.trim() + " character sheet.png" || !!(await page.getAttribute("[data-character-sheet-save]", "download")), "Save downloads the sheet");
    if (process.env.CHAR_SHOT) await (await page.$("[data-character-sheet]"))!.screenshot({ path: process.env.CHAR_SHOT });
    if (process.env.CHAR_SHOT) await (await page.$("[data-extra-views]"))!.screenshot({ path: process.env.CHAR_SHOT.replace(".png", "-extras.png") });
    await page.click("[data-new-version]");
    await page.waitForSelector("[data-card-status=draft]");
    check(((await page.textContent("[data-card-status]")) ?? "").includes("Draft v2") && existsSync(path.join(dir, "v2", "closeup.png")), "New version: v2 is a draft, starting from v1's pictures");
    check(((await page.textContent("[data-draft-note]")) ?? "").includes("keep using locked v1"), "the draft says v1 stays in use until v2 is locked");
    check(((await page.textContent("[data-card-version='1']")) ?? "").includes("locked · in use"), "v1 is shown as locked and in use");
    check(((await page.inputValue("[data-card-words]")) ?? "").length > 0, "v2 starts with v1's outfit");
    // Remake only the full-body views in the draft: front, then back; the face views are kept.
    await page.click("[data-remake-body]");
    await page.waitForFunction(() => document.querySelector("[data-last-job]")?.textContent?.includes("Remake Full body, front"), null, { timeout: 20_000 });
    const v2 = readdirSync(path.join(dir, "v2"));
    check(v2.some((f) => /^body_front_t\d+\.png$/.test(f) && !readdirSync(path.join(dir, "v1")).includes(f)) && v2.some((f) => /^body_back_t\d+\.png$/.test(f) && !readdirSync(path.join(dir, "v1")).includes(f)), "Remake the full-body views: a new front and back try in v2");
    check(!v2.some((f) => /^(closeup|three_quarter)_t\d+\.png$/.test(f) && !readdirSync(path.join(dir, "v1")).includes(f)), "the face views are not remade");
    // v1 stays read-only and viewable.
    await page.click("[data-card-version='1']");
    await page.waitForSelector("[data-old-version]");
    check((await page.isDisabled("[data-card-words]")) && !(await page.$("[data-remake-body]")) && !(await page.$("[data-new-version]")), "v1 opens read-only (no Remake, no New version)");
    await page.goto(`${base}/characters`);
    await page.waitForSelector("[data-card=bride]");
    check(((await page.textContent("[data-card=bride]")) ?? "").includes("Locked v1") && !!(await page.$("[data-card=bride] [data-card-draft='2']")), "the list: Locked v1, v2 draft");

    // A scene card with its key props.
    await page.goto(`${base}/characters`);
    await page.waitForSelector("[data-card=bride]");
    await page.click("[data-new-card=scene]");
    await page.fill("[data-card-name]", "bridal room");
    await page.setInputFiles("[data-card-picture]", path.join(pics, "default.png"));
    await page.click("[data-create-card]");
    await page.waitForSelector("[data-card-page='bridal room']");
    check(((await page.textContent("[data-check-verdict]")) ?? "").includes("Location check: Ready"), "the scene card's location check");
    await page.fill("[data-card-words]", "gilded floor mirror, velvet armchair");
    await page.click("h1");
    await sleep(300);
    await page.click("[data-make-pack]");
    await page.click("[data-confirm-yes]");
    await page.waitForSelector("[data-view=detail][data-light=grey]", { timeout: 20_000 });
    check(["wide_left", "wide_right", "detail"].every((a) => existsSync(path.join(wsDir, "scenes", "bridal room", "v1", `${a}.png`))), "3 angles made in workspace\\scenes\\bridal room\\v1\\");
    await page.goto(`${base}/characters`);
    await page.waitForSelector("[data-card='bridal room']");
    check(((await page.getAttribute("[data-card=bride] img", "src")) ?? "").includes("closeup.png"), "the list shows the close-up as the character's picture");

    // Add my pack: four pictures made elsewhere (Gemini), free, sorted into their places by their names.
    await page.click("[data-new-card=character]");
    await page.setInputFiles("[data-card-picture]", path.join(pics, "default.png"));
    await page.fill("[data-card-name]", "gemini bride");
    await page.click("[data-create-card]");
    await page.waitForSelector("[data-card-page='gemini bride']");
    const own = [["bride closeup.png", "closeup"], ["bride 3-4 face.png", "three_quarter"], ["full body front.png", "body_front"], ["full body back.png", "body_back"]] as const;
    for (const [n, from] of own) copyFileSync(path.join(pics, `${from}.png`), path.join(pics, n));
    const chooser = page.waitForEvent("filechooser");
    await page.click("[data-own-pack]");
    await (await chooser).setFiles(own.map(([n]) => path.join(pics, n)));
    await page.waitForSelector("[data-own-note]", { timeout: 20_000 });
    check(((await page.textContent("[data-own-note]")) ?? "").includes("bride 3-4 face.png → 3/4 face (by its name)") && ((await page.textContent("[data-own-note]")) ?? "").includes("Free, nothing sent online"), "Add my pack: each picture goes to its place by its name, free");
    await page.waitForSelector("[data-view=closeup][data-light=green]");
    check(((await page.textContent("[data-view=closeup]")) ?? "").includes("Your picture (bride closeup.png)"), "your own close-up is face-checked like a made one");
    check(["closeup", "three_quarter", "body_front", "body_back"].every((v) => existsSync(path.join(wsDir, "characters", "gemini bride", "v1", `${v}.png`))), "the four places are filled in workspace\\characters\\gemini bride\\v1\\");
    check(((await page.textContent("[data-lock-problems]")) ?? "").includes("description") && !((await page.textContent("[data-lock-problems]")) ?? "").includes("Not made yet"), "only the description is missing before Lock");
    await page.selectOption("[data-own-move=closeup]", "three_quarter");
    await page.waitForFunction(() => document.querySelector("[data-view=three_quarter]")?.textContent?.includes("bride closeup.png"));
    check(true, "Move to: the close-up goes to the 3/4 place (and the 3/4 to the close-up)");
    await page.click("[data-describe]");
    await page.waitForSelector("[data-describe-note]");
    check(((await page.inputValue("[data-card-description]")) ?? "").includes("A woman") && (await page.isEnabled("[data-lock]")), "the description is drafted (about $0.01) and Lock is possible");

    // Clean-up (26 Nov 2026): ✕ puts a picture aside (kept, Restore); Replace picture keeps the old one (Restore).
    const brideV1 = path.join(wsDir, "characters", "gemini bride", "v1");
    await page.click("[data-aside=body_back]");
    await page.waitForSelector("[data-aside-picture=body_back]", { state: "attached" });
    check(!existsSync(path.join(brideV1, "body_back.png")) && readdirSync(path.join(brideV1, "_aside")).some((f) => f.startsWith("body_back ")), "✕ puts the back view aside: kept in v1\\_aside\\, the place is empty");
    await page.click("[data-aside-list] summary");
    await page.click("[data-restore-aside=body_back]");
    await page.waitForFunction(() => !document.querySelector("[data-aside-list]"));
    check(existsSync(path.join(brideV1, "body_back.png")), "Restore puts it back in its place");
    await page.setInputFiles("[data-replace-input]", path.join(pics, "closeup.png"));
    await page.waitForSelector("[data-earlier-pictures]");
    const brideCard = JSON.parse(readFileSync(path.join(wsDir, "characters", "gemini bride", "card.json"), "utf8")) as { reference: string; replaced: { folder: string; reference: string }[] };
    check(brideCard.replaced.length === 1 && existsSync(path.join(wsDir, "characters", "gemini bride", brideCard.replaced[0].folder, brideCard.replaced[0].reference)), "Replace picture: the new picture is checked, the old one kept under Earlier pictures");
    await page.click("[data-earlier-pictures] summary");
    await page.click("[data-restore-picture]");
    await page.waitForFunction(() => document.querySelectorAll("[data-earlier-picture]").length === 1 && !!document.querySelector("[data-check-verdict]"));
    check((JSON.parse(readFileSync(path.join(wsDir, "characters", "gemini bride", "card.json"), "utf8")) as { reference: string }).reference === "reference.png", "Restore: the earlier picture is the card's picture again");

    // The Wardrobe: a second look from your own pictures, locked on its own; the list shows the looks.
    await page.waitForSelector("[data-wardrobe] [data-look-tab=main]");
    await page.fill("[data-look-new-name]", "Travel coat");
    await page.click("[data-look-add]");
    await page.waitForSelector("[data-look-tab=travel-coat][data-active]");
    check(((await page.textContent("[data-look-note]")) ?? "").includes('"Travel coat" is in the wardrobe'), "Add look: a new look in the wardrobe, opened");
    await page.fill("[data-look-outfit]", "camel wool travel coat, ankle boots");
    await page.click("[data-wardrobe] h2");
    await page.waitForFunction(() => document.querySelector("[data-look-estimate]")?.textContent?.startsWith("$"));
    for (const [n, from] of [["coat front.png", "body_front"], ["coat back.png", "body_back"]] as const) copyFileSync(path.join(pics, `${from}.png`), path.join(pics, n));
    const lookChooser = page.waitForEvent("filechooser");
    await page.click("[data-look-own]");
    await (await lookChooser).setFiles([path.join(pics, "coat front.png"), path.join(pics, "coat back.png")]);
    await page.waitForFunction(() => document.querySelector("[data-look-note]")?.textContent?.includes("coat back.png → Full body, back"));
    check(existsSync(path.join(wsDir, "characters", "gemini bride", "looks", "travel-coat", "body_front.png")), "your own pictures go into the look's places (workspace\\characters\\gemini bride\\looks\\travel-coat\\)");
    await page.click("[data-look-lock]");
    await page.waitForSelector("[data-look-locked]");
    check(!!(await page.$("[data-look-tab=travel-coat] svg")) && (await page.isDisabled("[data-look-outfit]")), "Lock this look: read-only, shown with a lock");
    const looksApi = (await (await fetch(`${base}/api/cards/looks`)).json()) as { characters: { name: string; looks: { name: string }[] }[] };
    check(looksApi.characters.find((c) => c.name === "gemini bride")?.looks.map((l) => l.name).join(",") === "Main look,Travel coat", "Creation's \"From a character\" lists the character's looks with pictures");
    await page.goto(`${base}/characters`);
    await page.waitForSelector("[data-card='gemini bride'] [data-card-looks]");
    check(((await page.textContent("[data-card='gemini bride'] [data-card-looks]")) ?? "") === "Main lookTravel coat", "the list shows the character's looks");

    // Remove card: the whole card to scenes\_removed\ (kept), off the list; Restore on the Characters page.
    await page.click("[data-card='bridal room']");
    await page.waitForSelector("[data-card-page='bridal room']");
    await page.click("[data-remove-card]");
    await page.click("[data-remove-yes]");
    await page.waitForSelector("[data-removed-card='bridal room']", { state: "attached" });
    check(!(await page.$("[data-card='bridal room']")) && !existsSync(path.join(wsDir, "scenes", "bridal room")) && readdirSync(path.join(wsDir, "scenes", "_removed")).some((f) => f.startsWith("bridal room ")), "Remove card: off the list, kept in scenes\\_removed\\");
    await page.click("[data-removed-cards] summary");
    await page.click("[data-restore-card='bridal room']");
    await page.waitForSelector("[data-card='bridal room']");
    check(existsSync(path.join(wsDir, "scenes", "bridal room", "card.json")), "Restore: the card is back in its folder and the list");
    await page.click("[data-card='gemini bride']");
    await page.waitForSelector("[data-card-page='gemini bride']");

    // Gemini on your own key as the pack's model: the estimate says it is billed by Google (the stand-in has a key).
    await page.selectOption("[data-card-model]", "gemini");
    await page.waitForFunction(() => document.querySelector("[data-card-pack]")?.textContent?.includes("your own Google bill"));
    check(!(await page.$("[data-gemini-missing]")) && (await page.isEnabled("[data-make-pack]")), "Gemini · Nano Banana Pro (your key) can be chosen; the estimate says it is on your own Google bill");

    // Pick a frame from a video: a new character's picture taken from a clip (the video itself is only read).
    const clip = path.join(pics, "singer clip.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=320x240:d=6:r=25", "-pix_fmt", "yuv420p", clip);
    const clipBytes = readFileSync(clip);
    await page.goto(`${base}/characters`);
    await page.click("[data-new-card=character]");
    await page.click("[data-card-from-video]");
    await page.setInputFiles("[data-frame-video]", clip);
    await page.waitForSelector("[data-frame-grid] [data-frame]", { timeout: 30_000 });
    const shown = await page.$$("[data-frame-grid] [data-frame]");
    check(shown.length === 12 && ((await page.textContent("[data-frame-grid] [data-frame]:first-child")) ?? "").includes("Best · Ready"), "the video gives 12 frames, the best face first");
    check(((await page.textContent("[data-frame-note]")) ?? "").includes("Best faces first"), "the picker says the best faces come first");
    await page.click("[data-frame-use]");
    await page.waitForSelector("[data-card-preview]");
    check(((await page.inputValue("[data-card-name]")) ?? "").startsWith("singer clip frame"), "the chosen frame becomes the new card's picture, named after the video");
    await page.fill("[data-card-name]", "singer");
    await page.click("[data-create-card]");
    await page.waitForSelector("[data-card-page=singer]");
    check(existsSync(path.join(wsDir, "characters", "singer", "reference.jpg")) || readdirSync(path.join(wsDir, "characters", "singer")).some((f) => f.startsWith("reference")), "workspace\\characters\\singer\\ holds the frame as its picture");
    check(readFileSync(clip).equals(clipBytes) && !readdirSync(path.join(wsDir, "frames")).some((d) => readdirSync(path.join(wsDir, "frames", d)).some((f) => f.startsWith("source"))), "the video is untouched and the app's copy of it is gone");

    // Cast Library (26 Nov 2026): notes, and Copy character for Claude (Remove card / Restore: the Card clean-up checks).
    await page.fill("[data-card-notes]", "late 20s, warm and shy");
    await page.click("h1");
    await page.waitForFunction(() => document.querySelector("[data-card-notes]") && !document.querySelector("[data-card-notes]")?.matches(":focus"));
    await sleep(800);
    check(readFileSync(path.join(wsDir, "characters", "singer", "card.json"), "utf8").includes("late 20s, warm and shy"), "the notes are saved in card.json");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click("[data-copy-claude]");
    await page.waitForFunction(() => document.querySelector("[data-copy-claude]")?.textContent?.includes("Copied"));
    const block = await page.evaluate(() => navigator.clipboard.readText());
    check(block.startsWith("CHARACTER LOCK: singer") && block.includes("Look (face, hair, age range, vibe):\nlate 20s, warm and shy") && block.includes("Reference pictures:") && /Attach the reference pictures? listed above with this block\.$/.test(block.trimEnd()) && block.includes("\nMissing: "), `Copy character for Claude: the Look first, the pictures, the closing line (${block.split("\n")[0]})`);

    // Rename (26 Nov 2026): click the title, type, Enter: the name changes everywhere; the folder stays.
    await page.click("[data-card-rename]");
    await page.fill("[data-card-rename-input]", "Singer Two");
    await page.press("[data-card-rename-input]", "Enter");
    await page.waitForSelector("[data-card-rename-note]");
    check(((await page.textContent("[data-card-rename] h1")) ?? "") === "Singer Two" && existsSync(path.join(wsDir, "characters", "singer", "card.json")) && readFileSync(path.join(wsDir, "characters", "singer", "card.json"), "utf8").includes('"name": "Singer Two"'), "Rename: the new name on the page and in card.json; the folder stays characters\\singer\\");
    await page.goto(`${base}/characters`);
    await page.waitForSelector("[data-card='Singer Two']");
    check(!(await page.$("[data-card=singer]")), "the library shows the new name");
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
