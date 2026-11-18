// Browser test of the Characters page (C1; needs a studio build, FFmpeg and Playwright with Chromium):
//   npx tsx apps/studio/e2e/characters.e2e.ts
// With the stand-ins for fal and the face checks (LYRIC_CARDS_STUB): nothing goes to fal.ai, no face models needed.
// The header link; a new character from one picture (its reference check shown); the outfit saved; Make pack (the
// cost shown first, confirm, the job in the Tasks menu); the 4 views with their lights; the body views cropped by the
// app (the model's picture kept); the drafted description; Remake one view; Approve and lock (read-only); New
// version; a scene card with its key props and 3 angles.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
