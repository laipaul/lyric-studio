// Browser test of C2 Shot list import (Prepare → Storyboard; needs a studio build, FFmpeg and Playwright):
//   npx tsx apps/studio/e2e/shotlist.e2e.ts
// The Import shot list button; a file with errors shows them slot by slot and cannot be imported; a good file shows
// "N slots ready" with the slots, then Import puts them in the story line at their places (dashed slot cards: "No
// picture yet", shot type, characters, scene, the lyric line's words, a warning for a card not locked); a re-import
// shows what changes; the previous shot list is in Replaced files.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { card as cardTable, openWorkspace } from "@lyric/db";
import { createSong, readRecipe, songPathsById, writeRecipe } from "@lyric/video/node";
import { createCard } from "@lyric/video/characters";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-shotlist-"));
const wsDir = path.join(root, "workspace");
const port = 3198;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, "Hold on to me\n* Never let go\nThrough the night\n");
  const song = path.join(root, "Hold On.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=4", song);
  const ws = openWorkspace(wsDir);
  const { id } = await createSong(ws, { song, lyrics });
  const paths = songPathsById(ws, id);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, c] of ["blue", "red"].entries()) ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=216x384:r=30:d=2`, "-pix_fmt", "yuv420p", path.join(paths.clips!, `0${i + 1}_${c}.mp4`));
  writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), platforms: ["reels"] });
  const pic = path.join(root, "p.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=pink:s=60x80", "-frames:v", "1", pic);
  for (const [kind, name] of [["character", "Bride No 2"], ["character", "Bridegroom"], ["scene", "Beach path"]] as const) createCard(ws, { kind, name, picture: readFileSync(pic), fileName: "p.png" });
  ws.db.update(cardTable).set({ status: "locked" }).where(eq(cardTable.name, "Bride No 2")).run();
  ws.db.update(cardTable).set({ status: "locked" }).where(eq(cardTable.name, "Beach path")).run();
  ws.close();
  const bad = path.join(root, "bad.json");
  writeFileSync(bad, JSON.stringify({ slots: [{ id: "s01", shows: "She walks", characters: ["Brde No 2"], shot: "wide" }, { id: "s02", shows: "He waits", characters: ["Bridegroom"], shot: "aerial", line: 9 }] }));
  const good = path.join(root, "wedding.json");
  writeFileSync(good, JSON.stringify({ slots: [
    { id: "s01", order: 1, shows: "She walks along the path toward the sea", characters: ["Bride No 2"], scene: "Beach path", shot: "wide", line: 1, tag: "intro" },
    { id: "s02", order: 3, shows: "He waits at the end of the path", characters: ["Bridegroom"], scene: "Beach path", shot: "close-up", line: 2 },
  ] }));
  const good2 = path.join(root, "wedding v2.json");
  writeFileSync(good2, JSON.stringify({ slots: [{ id: "s01", order: 1, shows: "She runs along the path", characters: ["Bride No 2"], scene: "Beach path", shot: "wide", line: 1 }] }));

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
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.goto(`${base}/songs/${id}?tab=clips`);
    await page.waitForSelector("[data-clip='01_blue.mp4']");
    check(!!(await page.$("[data-import-shotlist]")), "Prepare → Storyboard has an Import shot list button");

    // A file with errors: shown slot by slot, Import stays off.
    await page.click("[data-import-shotlist]");
    await page.waitForSelector("[data-shotlist-dialog]");
    await page.setInputFiles("[data-shotlist-input]", bad);
    await page.waitForSelector("[data-shotlist-check=errors]");
    const problems = await page.$$eval("[data-shotlist-problem=error]", (e: Element[]) => e.map((x) => x.textContent ?? ""));
    check(problems.some((t) => /s01: no character called "Brde No 2" \(did you mean Bride No 2\?\)/.test(t)), "an unknown name says which slot and suggests the right card");
    check(problems.some((t) => /s02: "shot" must be one of/.test(t)) && problems.some((t) => /there is no line 9/.test(t)), "a wrong shot type and a line that does not exist are named");
    check(await page.isDisabled("[data-shotlist-import]"), "with errors, Import is off");

    // A good file: N slots ready, the list, a warning for a card not locked; Import.
    await page.setInputFiles("[data-shotlist-input]", good);
    await page.waitForSelector("[data-shotlist-check=ok]");
    check(((await page.textContent("[data-shotlist-summary]")) ?? "").includes("2 slots ready · 2 new"), "a good file: 2 slots ready, 2 new");
    check(((await page.textContent("[data-shotlist-problem=warn]")) ?? "").includes('"Bridegroom" is not locked yet'), "a card not locked is a warning, not an error");
    await page.click("[data-shotlist-example-toggle]");
    check(((await page.textContent("[data-shotlist-example]")) ?? "").includes('"shows"'), "an example shot list can be shown");
    await page.click("[data-shotlist-import]");
    await page.waitForSelector("[data-story-slot=s02]");
    const keys = await page.$$eval("[data-position]", (e: Element[]) => e.map((x) => x.getAttribute("data-story-slot") ?? x.getAttribute("data-clip")));
    check(JSON.stringify(keys) === JSON.stringify(["s01", "01_blue.mp4", "s02", "02_red.mp4"]), `the slots sit at their places in the story line (${keys.join(", ")})`);
    const s1 = (await page.textContent("[data-story-slot=s01]")) ?? "";
    check(s1.includes("No picture yet") && s1.includes("She walks along the path") && s1.includes("wide") && s1.includes("Bride No 2") && s1.includes("Beach path"), "a slot card: no picture yet, what it shows, shot type, character, scene");
    check(((await page.textContent("[data-story-slot=s01] [data-slot-line]")) ?? "").includes("line 1: “Hold on to me”"), "the slot shows its lyric line's words");
    check(((await page.textContent("[data-story-slot=s02] [data-slot-warning]")) ?? "").includes("Bridegroom (not locked yet)"), "a card not locked is flagged on the slot");
    check(!!(await page.$("[data-story-slot=s01] img")), "the slot shows the cards' pictures");
    check(existsSync(path.join(paths.root, "shotlist.json")), "shotlist.json is in the song folder");

    // Re-import: what changes; the previous list is kept.
    await page.click("[data-import-shotlist]");
    await page.setInputFiles("[data-shotlist-input]", good2);
    await page.waitForSelector("[data-shotlist-check=ok]");
    check(((await page.textContent("[data-shotlist-summary]")) ?? "").includes("1 changed · 1 taken out (s02)"), "a re-import says what changes: 1 changed, 1 taken out");
    await page.click("[data-shotlist-import]");
    await page.waitForFunction(() => !document.querySelector("[data-story-slot=s02]"));
    check(((await page.textContent("[data-story-slot=s01]")) ?? "").includes("She runs along the path"), "the changed slot is updated, the removed one is gone");
    const replaced = (await (await fetch(`${base}/api/songs/${id}/replaced`)).json()) as { files: { role: string }[] };
    check(replaced.files.some((f) => f.role === "shotlist"), "the previous shot list is in Replaced files (with a Restore)");
    // Paul (21 Nov 2026): a planned slot can be removed from its ⋯ menu; "Remove all planned slots" takes the rest.
    await page.click("[data-story-slot=s01] [data-card-menu]");
    await page.click("[data-remove-slot=s01]");
    await page.waitForFunction(() => !document.querySelector("[data-story-slot=s01]"), null, { timeout: 15_000 });
    check(!(await page.$("[data-story-slot]")) && !(await page.$("[data-remove-all-slots]")), "Remove this planned slot: the card leaves the Storyboard (no slot left: no Remove all)");
    check(((await page.textContent("[data-assets-notice], [role=status], body")) ?? "").includes("kept under Replaced files"), "it says the shot list is kept under Replaced files");
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
