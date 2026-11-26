// Performance script in the browser (Part B, 26 Nov 2026): Prepare → Production → Story tools → Performance script.
// Copy script request (the music analysed locally on the way), Paste script (unrecognised parts shown), an entry marked
// checked and edited, a stale entry after the line changed, and Shape's energy band. Playwright with Chromium; the
// analysis is the real audio service (frequency bands: no Demucs here); nothing is generated.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets } from "@lyric/db";
import { createCard } from "@lyric/video/characters";
import { createSong, makeVideos, readRecipe, songPathsById, writeRecipe, type RenderOptions } from "@lyric/video/node";
import { setPersona } from "@lyric/video/persona-node";
import { emptyPersona } from "@lyric/video/persona";
import { setCast } from "@lyric/video/production";

import { fakeAlign } from "../../../packages/video/test/media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-script-"));
const wsDir = path.join(root, "workspace");
const port = 3201;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

const ANSWER = `SCRIPT: Hold On To Me
Sings to: Ken
Objective: to make him stay

L2 [0:02] Chorus
Singer: Aiko
Meaning: She asks him to stay.
Emotion: longing | Intensity: 3
Action: to plead
Laban: press
Face: inner brows raised, lip corners down
Camera: push-in | Pace: hold long

L40 [3:00] Outro
Emotion: calm`;

async function main() {
  process.env.WORKSPACE_DIR = wsDir;
  const lyrics = path.join(root, "lyrics.txt");
  writeFileSync(lyrics, ["Verse one here", "* Hold on to me", "Through the night", "Verse two here", "* Hold on to me", "Into the light"].join("\n") + "\n");
  const song = path.join(root, "Hold On To Me.wav");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=12", song);
  const ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  const { id } = await createSong(ws, { song, lyrics });
  const paths = songPathsById(ws, id);
  mkdirSync(paths.clips!, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=216x384:r=30:d=6", "-pix_fmt", "yuv420p", path.join(paths.clips!, "front.mp4"));
  writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), platforms: ["reels"], section: "0:00-0:12", variations: { reels: 1 } });
  const pic = path.join(root, "aiko.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=600x800", "-frames:v", "1", pic);
  const aiko = createCard(ws, { kind: "character", name: "Aiko", picture: readFileSync(pic), fileName: "aiko.png" }).id;
  setPersona(ws, aiko, { ...emptyPersona(), archetype: "The Quiet Romantic" });
  setCast(ws, id, [aiko]);
  const sample = path.join(root, "s.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=1", "-pix_fmt", "yuv420p", sample);
  await makeVideos({
    workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, platform: "win32",
    renderer: async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile),
    thumbnailRenderer: async (o) => (ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", o.outFile), o.outFile),
  });
  ws.close();

  const server = spawn(process.execPath, [path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, WORKSPACE_DIR: wsDir, NEXT_TELEMETRY_DISABLED: "1", LYRIC_CARDS_STUB: "1", LYRIC_VOICE_MAP: "off" },
    stdio: "ignore",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let playwright: any;
  try {
    playwright = require("playwright"); // eslint-disable-line @typescript-eslint/no-require-imports
  } catch {
    playwright = require("/opt/node22/lib/node_modules/playwright"); // eslint-disable-line @typescript-eslint/no-require-imports
  }
  try {
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`${base}/`)).ok) break;
      } catch {
        // not up yet
      }
      await sleep(500);
    }
    const browser = await playwright.chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await context.newPage();
    page.on("pageerror", (e: Error) => console.log(`page error: ${e.message}`));
    await page.goto(`${base}/songs/${id}?tab=production`);
    await page.waitForSelector("[data-story-tools]");
    if (!(await page.$("[data-story-tools][open]"))) await page.click("[data-story-tools] summary");
    await page.waitForSelector("[data-script-panel]");
    check(((await page.textContent("[data-production-section=script]")) ?? "").includes("Performance script"), "Production → Story tools has the Performance script");
    check((await page.$$eval("[data-script-scope] option", (o: Element[]) => o.map((x) => x.textContent))).join("|") === "Whole song|Reel range|Singing slots only", "scopes: Whole song / Reel range / Singing slots only");

    // Copy script request: the music is analysed on the way (local), then the text is on the clipboard.
    await page.click("[data-script-request]");
    await page.waitForFunction(() => document.querySelector("[data-script-note]")?.textContent?.startsWith("Copied:"), null, { timeout: 120_000 });
    const request = await page.evaluate(() => navigator.clipboard.readText());
    check(request.includes('L2 [0:02] Chorus') && request.includes("PERSONA: Aiko") && request.includes("Archetype: The Quiet Romantic") && /ESCALATE/.test(request), "the request: lines with sections and times, the persona, the escalation rule");
    check(/L1 \[0:01\] [^\n]*" - [a-z]/.test(request), "each line carries its music cues");
    check((await page.getAttribute("[data-script-cues]", "data-script-cues")) === "bands", "the music was listened to (frequency bands: no Demucs here), and the panel says how");

    // Paste script.
    await page.fill("[data-script-paste]", ANSWER);
    await page.click("[data-script-paste-save]");
    await page.waitForSelector("[data-script-entry=L2]");
    check(((await page.textContent("[data-script-unrecognised]")) ?? "").includes("L40: not a line of this song now"), "a key the song does not have is listed, not guessed");
    check((await page.inputValue("[data-script-sings-to]")) === "Ken" && (await page.inputValue("[data-script-objective]")) === "to make him stay", "Sings to and Objective saved");
    await page.click("[data-script-check=L2]");
    await page.waitForSelector("[data-script-entry=L2][data-checked]");
    await page.click("[data-script-entry=L2] summary");
    await page.fill("[data-script-field='L2.camera']", "hold on her face");
    await page.locator("[data-script-field='L2.camera']").blur();
    await page.waitForFunction(() => document.querySelector("[data-script-note]") === null || true);
    await sleep(800);
    const saved = JSON.parse(readFileSync(path.join(paths.root, "production", "script.json"), "utf8")) as { entries: { key: string; checked: boolean; camera: string }[] };
    check(saved.entries.find((e) => e.key === "L2")?.checked === true && saved.entries.find((e) => e.key === "L2")?.camera === "hold on her face", "marked checked and edited (production\\script.json)");

    // Mark all checked / Untick all.
    await page.click("[data-script-uncheck-all]");
    await page.waitForFunction(() => document.querySelector("[data-script-summary]")?.textContent?.includes("· 0 checked"));
    await page.click("[data-script-check-all]");
    await page.waitForFunction(() => !document.querySelector("[data-script-summary]")?.textContent?.includes("· 0 checked"));
    const all = JSON.parse(readFileSync(path.join(paths.root, "production", "script.json"), "utf8")) as { entries: { checked: boolean }[] };
    check(all.entries.length > 0 && all.entries.every((e) => e.checked), "Mark all checked ticks every line; Untick all clears them");

    // The line changed since the paste: the entry is stale and says why.
    const s = JSON.parse(readFileSync(path.join(paths.root, "production", "script.json"), "utf8")) as { entries: { key: string; basis: { text: string } }[] };
    s.entries.find((e) => e.key === "L2")!.basis.text = "Hold on to you";
    writeFileSync(path.join(paths.root, "production", "script.json"), JSON.stringify(s));
    await page.reload();
    await page.waitForSelector("[data-story-tools]");
    if (!(await page.$("[data-story-tools][open]"))) await page.click("[data-story-tools] summary");
    await page.waitForSelector("[data-script-entry=L2][data-stale]");
    check(((await page.textContent("[data-script-entry=L2] [data-stale-reason]")) ?? "").includes("words changed"), "a changed line is marked stale, with the reason");

    // Lyrics Sync: the sections bar for every song style (this song is not a Mini film).
    await page.goto(`${base}/songs/${id}?tab=lyrics`);
    await page.waitForSelector("[data-sections]", { timeout: 30_000 });
    check(true, "Lyrics Sync shows the sections bar on a song that is not a Mini film");

    // Shape: the energy band under the song track.
    await page.goto(`${base}/songs/${id}?tab=storyboard`);
    await page.waitForSelector("[data-energy-band]", { timeout: 60_000 });
    check((await page.$$("[data-energy-band] polyline")).length === 1, "Shape shows the music's energy band under the song track");

    await browser.close();
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
