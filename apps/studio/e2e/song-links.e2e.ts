// Browser test (needs a studio build, FFmpeg and Playwright, as videos-post.e2e.ts): Prepare → Song Details → Links.
// Bug fix 11 Nov 2026: an Apple Music link added after a Spotify link never replaces it. The service is recognised from the
// address, rows show the link with ✎ to edit that row only, a removed link comes back with Undo (no browser confirm).
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace } from "@lyric/db";
import { findOrCreateSongProject, songPathsById } from "@lyric/video/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-links-"));
const wsDir = path.join(root, "workspace");
const port = 3231;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  const song = path.join(root, "Here With Me.wav");
  execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=6", song]);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
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
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
    page.on("dialog", () => check(false, "no browser dialog (confirm) is used"));
    const patch = (r: { url(): string; request(): { method(): string } }) => r.url().includes("/links") && r.request().method() === "PATCH";
    const rows = () => page.$$eval("[data-link-row]", (els: Element[]) => els.map((e) => e.getAttribute("data-link-row")).join(","));
    const saved = () => (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { links?: { service: string; url: string }[] }).links ?? [];

    await page.goto(`${base}/songs/${sp.project.id}?tab=details`);
    await page.waitForSelector("[data-links] [data-link-new]");

    // Spotify, then Apple Music: the service comes from the address; both stay, also after a reload.
    for (const url of ["https://open.spotify.com/track/abc", "https://music.apple.com/album/here-with-me/123"]) {
      await page.fill("[data-link-new]", url);
      await Promise.all([page.waitForResponse(patch), page.click("[data-link-add]")]);
    }
    await page.waitForSelector("[data-link-row=appleMusic]");
    check((await rows()) === "spotify,appleMusic", `Spotify and Apple Music are both listed (${await rows()})`);
    await page.reload();
    await page.waitForSelector("[data-links] [data-link-row=appleMusic]");
    check((await rows()) === "spotify,appleMusic", `both are still there after a reload (${await rows()})`);
    check(saved().map((l) => l.service).join(",") === "spotify,appleMusic", "song.json has both links");
    check(((await page.textContent("[data-link-row=spotify] [data-link-shown]")) ?? "") === "open.spotify.com/track/abc", "a row shows the address readably");

    // ✎ opens one row's editor; changing its service keeps the other row; Cancel changes nothing.
    await page.click("[data-link-row=appleMusic] [data-link-edit]");
    check((await page.$$("[data-link-editing]")).length === 1 && (await page.$$("[data-link-edit]")).length === 1, "✎ opens the editor of that row only");
    await page.click("[data-link-cancel]");
    check((await page.$$("[data-link-editing]")).length === 0 && (await rows()) === "spotify,appleMusic", "Cancel changes nothing");
    await page.click("[data-link-row=appleMusic] [data-link-edit]");
    await page.fill("[data-link-row] [data-link-url]", "https://music.apple.com/album/here-with-me/456");
    await Promise.all([page.waitForResponse(patch), page.click("[data-link-save]")]);
    await page.waitForSelector("[data-link-row=appleMusic]:not([data-link-editing])");
    check(saved().map((l) => l.url).join(",") === "https://open.spotify.com/track/abc,https://music.apple.com/album/here-with-me/456", "Save changes that row's address; the Spotify link is untouched");

    // Remove -> Undo brings it back at its old place (after a reload too).
    await Promise.all([page.waitForResponse(patch), page.click("[data-link-row=spotify] [data-link-remove]")]);
    await page.waitForSelector("[data-link-undo]");
    check((await rows()) === "appleMusic", `Spotify removed (${await rows()})`);
    await Promise.all([page.waitForResponse(patch), page.click("[data-link-undo]")]);
    await page.waitForSelector("[data-link-row=spotify]");
    await page.reload();
    await page.waitForSelector("[data-links] [data-link-row=spotify]");
    check((await rows()) === "spotify,appleMusic", `Undo put Spotify back first, also after a reload (${await rows()})`);
    // Tags (11 Nov 2026): a ranked list of hashtags in Song Details; the brand's tag on every song; grey suggestions
    // (one click adds them, they turn pink); each platform uses its top ones (Instagram / Facebook 5).
    const tagsNow = () => (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { tags?: string[] }).tags;
    const tagList = () => page.$$eval("[data-tag-list] [data-tag]", (e: Element[]) => e.map((x) => x.getAttribute("data-tag")));
    await page.waitForSelector("[data-tags] [data-tag-brand]");
    check(JSON.stringify(await tagList()) === JSON.stringify(["lifelyrics"]) && tagsNow() === undefined, `the brand's tag is there on its own, "from your brand" (${(await tagList()).join(", ")})`);
    const suggested = await page.$$eval("[data-tag-suggestion]", (e: Element[]) => e.map((x) => x.getAttribute("data-tag-suggestion")));
    check(suggested.includes("herewithme") && !suggested.some((t) => ["reels", "explore", "fyp", "viral"].includes(t ?? "")), `suggestions from the title (#herewithme), never generic (${suggested.join(", ")})`);
    await page.click("[data-tag-suggestion=herewithme]");
    await page.waitForSelector("[data-tag-suggestion=herewithme][aria-pressed=true]");
    await page.fill("[data-tag-new]", "Emotional Pop, #Chanson Française, emotionalpop");
    await page.press("[data-tag-new]", "Enter");
    await page.waitForSelector("[data-tag-list] [data-tag=chansonfrancaise]");
    check(JSON.stringify(await tagList()) === JSON.stringify(["lifelyrics", "herewithme", "emotionalpop", "chansonfrancaise"]), `added: clean (lowercase, no spaces or accents, no duplicates) (${(await tagList()).join(", ")})`);
    for (const t of ["piano", "ballad", "lovesong"]) {
      await page.fill("[data-tag-new]", t);
      await page.press("[data-tag-new]", "Enter");
      await page.waitForSelector(`[data-tag-list] [data-tag=${t}]`);
    }
    // Drag #lovesong to the front: the top 5 for Instagram follow.
    await page.dragAndDrop("[data-tag-list] [data-tag=lovesong]", "[data-tag-list] [data-tag=lifelyrics]");
    for (let i = 0; i < 20 && tagsNow()?.[0] !== "lovesong"; i++) await sleep(150);
    await page.reload();
    await page.waitForSelector("[data-tag-list] [data-tag=lovesong]");
    check((tagsNow() ?? [])[0] === "lovesong" && (await tagList()).length === 7, `dragged first, kept after a reload, more than 5 kept (${(await tagList()).join(", ")})`);
    const insta = (await page.textContent("[data-tag-preview=reels]")) ?? "";
    check(insta.includes("uses: #lovesong #lifelyrics #herewithme #emotionalpop #chansonfrancaise") && insta.includes("(top 5)"), `Instagram / Facebook uses the top 5 (${insta})`);
    check(((await page.textContent("[data-tag-preview=youtube]")) ?? "").includes("#lovesong #lifelyrics #herewithme above the title"), "YouTube: 3 above the title, the rest in its Tags box");
    await page.click("[data-tag-remove=piano]");
    await page.waitForSelector("[data-tag-list] [data-tag=piano]", { state: "detached" });
    check(!(await page.$("[data-tag-remove=lifelyrics]")), "a brand tag cannot be taken off one song (it is the artist's)");
    if (process.env.TAGS_SHOT) await (await page.$("[data-tags]"))!.screenshot({ path: process.env.TAGS_SHOT });
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
