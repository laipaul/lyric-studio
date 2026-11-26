// Lip-sync readiness in the browser (26 Nov 2026, Nextgen step 2): Prepare → Storyboard → Check lip sync (all clips), the
// verdicts on the cards, the singing slots with the meter, Accept / Ignore saved and read again after a reload, Export
// performance excerpt (its files), and the Shape timeline's bands. Playwright with Chromium; the face checks are the
// browser tests' stand-in (LYRIC_CARDS_STUB: by the clip's name), nothing is generated.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets } from "@lyric/db";
import { createSong, makeVideos, readRecipe, songPathsById, writeRecipe, type RenderOptions } from "@lyric/video/node";

import { fakeAlign } from "../../../packages/video/test/media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-lipsync-"));
const wsDir = path.join(root, "workspace");
const port = 3199;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

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
  for (const [n, c] of [["front.mp4", "blue"], ["profile.mp4", "red"], ["wide.mp4", "green"]] as const) ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=216x384:r=30:d=6`, "-pix_fmt", "yuv420p", path.join(paths.clips!, n));
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=12", path.join(paths.root, "vocals.wav"));
  writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), platforms: ["reels"], section: "0:00-0:12", variations: { reels: 1 } });
  // The lyrics timed (a stored alignment), as after Lyrics Sync.
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
    playwright = require("playwright");
  } catch {
    playwright = require("/opt/node22/lib/node_modules/playwright");
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (e: Error) => console.log(`page error: ${e.message}`));
    await page.goto(`${base}/songs/${id}?tab=clips`);
    await page.waitForSelector("[data-singing-meter]", { timeout: 30_000 });
    check(((await page.textContent("[data-singing-meter]")) ?? "").startsWith("Singing: 0 s / "), `the meter before any check (${await page.textContent("[data-singing-meter]")})`);
    await page.selectOption("[data-singing-kind]", "full");
    await page.waitForFunction(() => document.querySelector("[data-singing-meter]")?.textContent?.includes("/ 4 s"));
    check(true, "for the whole song: 1/3 of 12 s, a 4 s target");

    await page.click("[data-lip-check-all]");
    await page.waitForSelector("[data-lip='front.mp4'][data-lip-verdict=good]", { timeout: 60_000 });
    check((await page.getAttribute("[data-lip='profile.mp4']", "data-lip-verdict")) === "bad" && ((await page.textContent("[data-lip='profile.mp4']")) ?? "").includes("side profile"), "Check all: the profile clip ❌ with its reason");
    check(((await page.textContent("[data-lip='wide.mp4']")) ?? "").includes("face too small"), "the wide clip ❌: face too small");
    check(((await page.textContent("[data-lip='front.mp4']")) ?? "").includes("best 0.0–6.0 s"), "the front clip ✅ with its best window");
    const slot = await page.getAttribute("[data-slot][data-slot-state=suggested]", "data-slot");
    check(!!slot && ((await page.textContent(`[data-slot='${slot}'] [data-slot-text]`)) ?? "").includes("front.mp4"), `a slot suggests the ✅ clip (${slot})`);

    // Accept: saved on the clip, still there after a reload; the card says it sings.
    await page.click(`[data-slot-accept='${slot}']`);
    await page.waitForSelector(`[data-slot='${slot}'][data-slot-state=accepted]`);
    const edits = JSON.parse(readFileSync(path.join(paths.root, "clips.json"), "utf8")) as { clips: Record<string, { lipsync?: { slot: string } }> };
    check(edits.clips["front.mp4"]?.lipsync?.slot === slot, "Accept is saved on the clip in clips.json");
    await page.reload();
    await page.waitForSelector("[data-singing-meter]");
    await page.selectOption("[data-singing-kind]", "full");
    await page.waitForSelector(`[data-slot='${slot}'][data-slot-state=accepted]`);
    check(((await page.textContent("[data-lip='front.mp4'] [data-lip-sings]")) ?? "").trim().startsWith("sings"), "after a reload: still accepted, and the card says it sings");

    // Export performance excerpt: its folder with the vocal, the mix and the texts; Open folder offered.
    await page.click(`[data-slot-export='${slot}']`);
    await page.waitForSelector(`[data-slot-open='${slot}']`);
    const perf = path.join(paths.root, "performance");
    const dirs = existsSync(perf) ? readdirSync(perf) : [];
    const info = dirs.length ? (JSON.parse(readFileSync(path.join(perf, dirs[0], "slot.json"), "utf8")) as { vocal: { source: string; label: string } }) : null;
    // The vocal: the song's stem when its check accepts it, else the app's Demucs vocals, else none (only the mix): said in slot.json.
    check(dirs.length === 1 && ["mix.wav", "slot.txt", "slot.json"].every((f) => existsSync(path.join(perf, dirs[0], f))) && existsSync(path.join(perf, dirs[0], "vocal.wav")) === (info?.vocal.source !== "none"), `the excerpt's folder: the mix, slot.txt, slot.json, and the vocal when there is one (${dirs.join(", ")}; vocal: ${info?.vocal.label})`);
    check(dirs[0]?.startsWith("Hold On To Me · ") && !/[<>:"/\\|?*]/.test(dirs[0]), "named after the song, the slot and the line, Windows-safe");

    // Ignore on another suggestion, then Shape's bands.
    const other = await page.getAttribute("[data-slot][data-slot-state=suggested], [data-slot][data-slot-state=partial]", "data-slot").catch(() => null);
    if (other) {
      await page.click(`[data-slot-ignore='${other}']`);
      await sleep(800);
      check(existsSync(path.join(paths.root, ".studio", "singing.json")), "Ignore is saved (.studio\\singing.json)");
    }
    await page.goto(`${base}/songs/${id}?tab=shape`);
    await page.waitForSelector("[data-singing-band]", { timeout: 60_000 });
    check((await page.$$("[data-singing-band]")).length >= 1, "Shape shows the singing slots as bands on the song track");
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
