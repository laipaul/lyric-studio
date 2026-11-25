// Browser test (needs a studio build, FFmpeg and Playwright, as videos-post.e2e.ts): Song style (22 Nov 2026, Paul's
// three levels). Song Details → Song style saves song.json "songStyle"; Cut to the song hides Who sings in Lyrics
// Sync, Add lip sync shows it; Mini film opens Creation's story tools; the Library card names the style.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, songPathsById, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-style-"));
const wsDir = path.join(root, "workspace");
const port = 3243;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  const song = path.join(root, "Wedding Day.wav");
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=20", song]);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  writeFileSync(paths.lyricsTxt, "You're beautiful\n* On our wedding day\n");
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, "[00:02.00]<00:02.00>You're <00:03.00>beautiful <00:04.50>\n[00:06.00]<00:06.00>On <00:06.50>our <00:07.00>wedding <00:07.60>day <00:08.50>\n[00:12.00]\n");
    const lines = ["You're beautiful", "On our wedding day"].map((text, i) => ({ number: i + 1, text, is_hook: i === 1, start_ms: [2_000, 6_000][i], end_ms: [4_500, 8_500][i], confidence: 0.9 }));
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines }));
  };
  const p = ws.db.select().from(project).where(eq(project.id, sp.project.id)).get()!;
  await ensureAlignment(ws, { ...sp, project: p }, { lyricsTxt: paths.lyricsTxt, durationMs: 20_000, align: aligner });
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
    const saved = () => (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { songStyle?: string }).songStyle;
    const put = (r: { url(): string; request(): { method(): string } }) => r.url().includes("/style") && r.request().method() === "PUT";

    // Not chosen yet: Cut to the song (no singing lines), said so; Lyrics Sync has no Who sings.
    await page.goto(`${base}/songs/${sp.project.id}?tab=details`);
    await page.waitForSelector("[data-song-style=cut] [data-song-style-default]");
    check(true, "a new song starts on Cut to the song, said as not chosen yet");
    await page.goto(`${base}/songs/${sp.project.id}?tab=lyrics`);
    await page.waitForSelector("[data-singing-off]");
    check((await page.$$("[data-singer-cell]")).length === 0, "Cut to the song: Who sings is hidden in Lyrics Sync, with a line saying why");

    // Add lip sync: saved, and Who sings is back.
    await page.goto(`${base}/songs/${sp.project.id}?tab=details`);
    await page.waitForSelector("[data-song-style-option=singing]");
    await Promise.all([page.waitForResponse(put), page.click("[data-song-style-option=singing]")]);
    await page.waitForSelector("[data-song-style=singing]");
    check(saved() === "singing", `song.json "songStyle" is singing (${saved()})`);
    await page.goto(`${base}/songs/${sp.project.id}?tab=lyrics`);
    await page.waitForSelector("[data-singer-cell]");
    check((await page.$("[data-singing-off]")) === null && (await page.$$("[data-singer-cell]")).length === 2, "Add lip sync: Who sings shows on every line");

    // Mini film: Creation's story tools open; the Library card names it.
    await page.goto(`${base}/songs/${sp.project.id}?tab=details`);
    await page.waitForSelector("[data-song-style-option=film]");
    await Promise.all([page.waitForResponse(put), page.click("[data-song-style-option=film]")]);
    await page.waitForSelector("[data-song-style=film]");
    check(saved() === "film", `song.json "songStyle" is film (${saved()})`);
    await page.goto(`${base}/songs/${sp.project.id}?tab=production`);
    await page.waitForSelector("[data-story-tools][open]", { timeout: 15_000 }).catch(() => null);
    check((await page.$("[data-story-tools][open]")) !== null, "Mini film: Creation's story tools are open");
    // Where am I (23 Nov 2026): the stage header names the song style; a click opens Song Details.
    const chip = ((await page.textContent("[data-work-status] [data-song-style-chip=film]")) ?? "").trim();
    check(chip.includes("Mini film") && chip.includes("whole song"), `the stage header says Mini film · whole song (${chip})`);
    await page.click("[data-work-status] [data-song-style-chip]");
    await page.waitForSelector("[data-song-style=film]");
    check(true, "clicking it opens Song Details");
    // A Mini film makes only its two films (23 Nov 2026): Make offers Film 9:16 and Film 16:9, both on; no Reels.
    await page.goto(`${base}/songs/${sp.project.id}?tab=generate`);
    await page.waitForSelector("[data-make-chips]");
    const chips = await page.$$eval("[data-make-chip]", (els) => els.map((e) => `${e.getAttribute("data-make-chip")}:${e.getAttribute("data-count")}`));
    check(JSON.stringify(chips) === JSON.stringify(["film:1", "film-wide:1"]), `Make offers only the two films, both on (${chips.join(", ")})`);
    await page.goto(`${base}/`);
    await page.waitForSelector("[data-song-style-badge]");
    check((await page.getAttribute("[data-song-style-badge]", "data-song-style-badge")) === "film" && ((await page.textContent("[data-song-style-badge]")) ?? "").includes("Mini film"), "the Library card says Mini film");
    if (process.env.STYLE_SHOT) {
      await page.goto(`${base}/songs/${sp.project.id}?tab=details`);
      await page.waitForSelector("[data-song-style=film]");
      await (await page.$("[data-song-style]"))!.screenshot({ path: process.env.STYLE_SHOT });
    }
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
