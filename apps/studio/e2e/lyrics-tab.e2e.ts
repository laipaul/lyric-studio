// Browser test of the Lyrics tab (Step 5c.2; needs a studio build, FFmpeg and Playwright, as the others):
//   pnpm test:e2e
// First real case: A Heart For Two ~1:10, the hook "You had a heart for two" stamped 1.5 s early and
// flagged by the vocal-start check. Nudge it +1.5 s, Save: hints.lrc gets a hand-set line and the
// stored alignment is kept; Reset takes it back. lyrics.txt: a "[Chorus]" label is flagged and removed
// (words change: the re-align warning first), an earlier version is restored. The song plays.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, songPathsById, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-lyrics-"));
const wsDir = path.join(root, "workspace");
const port = 3199;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

const LRC = [
  "[01:05.00]<01:05.00>The verse <01:06.00>line <01:08.40>",
  "[01:08.50]<01:08.50>You <01:10.40>had <01:10.70>a <01:10.90>heart <01:11.20>for <01:11.50>two <01:12.50>",
  "[01:13.00]<01:13.00>Next <01:13.60>verse <01:14.40>",
  "[01:20.00]",
].join("\n");

async function main() {
  const song = path.join(root, "A Heart For Two.wav");
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=90", song]);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  writeFileSync(paths.lyricsTxt, "The verse line\n* You had a heart for two\nNext verse\n");
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, `${LRC}\n`);
    const lines = ["The verse line", "You had a heart for two", "Next verse"].map((text, i) => ({ number: i + 1, text, is_hook: i === 1, start_ms: [65_000, 68_500, 73_000][i], end_ms: [68_400, 72_500, 74_400][i], confidence: 0.9 }));
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines }));
  };
  const p = ws.db.select().from(project).where(eq(project.id, sp.project.id)).get()!;
  const stored = await ensureAlignment(ws, { ...sp, project: p }, { lyricsTxt: paths.lyricsTxt, durationMs: 90_000, align: aligner });
  writeFileSync(
    path.join(path.dirname(stored.lrcFile), `guard-${stored.lrcHash.slice(0, 12)}.json`),
    JSON.stringify({ moves: [], check: { level_db: -14, threshold_db: -29, words_check: "ran", lines: [{ number: 2, text: "You had a heart for two", stamp_ms: 68_500, voice_ms: null, words_ms: 70_050, words_text: "You had a", duration_ms: 68_500, first_word_ms: 1_900, loudest_before_db: null, stamp_level_db: -40, target_ms: 68_500, agree: [], why: "only words 1:10.1 (+1.6 s); no second signal agrees", result: "flagged for review" }] } }),
  );
  const songFile = absPath(ws, p.audio_path!);
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${base}/songs/${sp.project.id}?tab=lyrics`);
    await page.waitForSelector("[data-line='2']");
    check(((await page.textContent("[data-lyrics-summary]")) ?? "").includes("1 flagged for review"), "summary: 1 flagged for review");
    check((await page.getAttribute("[data-line='2']", "data-flagged")) === "true", "the 1:10 hook is highlighted as flagged");
    check(((await page.textContent("[data-line='2'] [data-flag-reason]")) ?? "").includes("only words 1:10.1"), "with the reason");
    check(((await page.textContent("[data-line='2'] [data-screen]")) ?? "").includes("readable 1:08.27"), "what the viewer sees: readable 1:08.27 (0.25 s before the stamp)");

    // "Checked by ear": the flagged line is no longer flagged (stored with the song).
    await page.click("[data-line='2'] [data-ear='off']");
    await page.waitForSelector("[data-line='2'][data-checked-by-ear='true']");
    check(((await page.textContent("[data-lyrics-summary]")) ?? "").includes("0 flagged for review · 0 low confidence · 1 checked by ear"), "checked by ear: 0 flagged, 1 checked by ear");
    check(existsSync(path.join(path.dirname(stored.lrcFile), "checked-by-ear.json")), "stored with the song (.studio\\lyrics\\checked-by-ear.json)");
    await page.click("[data-line='2'] [data-ear='on']");
    await page.waitForSelector("[data-line='2'][data-flagged='true']");
    check(true, "taken off again: flagged again");
    await page.click("[data-line='2'] [data-ear='off']");
    await page.waitForSelector("[data-line='2'][data-checked-by-ear='true']");

    // Nudge +0.5 three times (1.5 s later), then Save.
    for (let i = 0; i < 3; i++) await page.click("[data-line='2'] [data-nudge='500']");
    check(((await page.textContent("[data-line='2'] [data-start]")) ?? "").includes("1:10.00"), "after +1.5 s: starts 1:10.00 (not saved)");
    check(((await page.textContent("[data-line='2'] [data-screen]")) ?? "").includes("readable 1:09.77"), "the screen times follow the change");
    await page.click("[data-line='1'] [data-nudge='100']");
    await page.click("[data-undo]");
    check(!((await page.textContent("[data-line='1'] [data-start]")) ?? "").includes("not saved"), "Undo takes back the last nudge");
    await page.click("[data-save-times]");
    await page.waitForSelector("[role=status]");
    const hints = readFileSync(paths.hints!, "utf8");
    check(hints === "[01:10.00]! #2 You had a heart for two\n", `hints.lrc holds the hand-set line (${JSON.stringify(hints)})`);
    await page.waitForFunction(() => document.querySelector("[data-line='2'] [data-start]")?.textContent?.includes("set by hand"));
    check((await page.getAttribute("[data-line='2']", "data-flagged")) === null, "a hand-set line is no longer flagged");
    check(readdirSync(path.dirname(stored.lrcFile)).filter((f) => /^aligned-.*\.lrc$/.test(f)).length === 1, "the stored alignment is kept (no new alignment)");
    check(!!(await page.$("[data-line='2'] [data-ear-lapsed]")), "the time changed: the \"checked by ear\" mark lapsed (check it again)");

    // Reset the line: the hand-set time goes again.
    await page.click("[data-line='2'] [data-reset]");
    await page.click("[data-save-times]");
    await page.waitForFunction(() => document.querySelector("[role=status]")?.textContent?.includes("(0 line(s) set by hand)"));
    check(!readFileSync(paths.hints!, "utf8").includes("!"), "Reset + Save: no hand-set line left in hints.lrc");

    // The song plays (the audio is served).
    const audioSrc = await page.getAttribute("audio", "src");
    const audio = await fetch(`${base}${audioSrc}`, { headers: { Range: "bytes=0-99" } });
    check(audio.status === 206 && (audio.headers.get("content-type") ?? "").startsWith("audio/"), `the song is served for ▶ (${audio.status} ${audio.headers.get("content-type")})`);

    // lyrics.txt: a label line is flagged, removed (words change: the warning first), then undone.
    await page.fill("[data-lyrics-editor]", "[Chorus]\nThe verse line\n* You had a heart for two\nNext verse\n");
    await page.click("[data-save-text]");
    await page.waitForSelector("[data-realign-warning]");
    await page.click("[data-save-text]");
    await page.waitForSelector("[data-label-flags]");
    check(((await page.textContent("[data-label-flags]")) ?? "").includes("[Chorus]"), 'the "[Chorus]" label is flagged');
    await page.click("[data-remove-labels]");
    check(!(await page.inputValue("[data-lyrics-editor]")).includes("[Chorus]"), "Remove takes it out of the text");
    await page.click("[data-save-text]");
    await page.waitForSelector("[data-realign-warning]");
    await page.click("[data-save-text]");
    await page.waitForFunction(() => document.querySelector("[role=status]")?.textContent?.includes("lyrics.txt saved"));
    check(readFileSync(paths.lyricsTxt, "utf8") === "The verse line\n* You had a heart for two\nNext verse\n", "lyrics.txt saved without the label");
    check(existsSync(path.join(paths.root, ".studio", "replaced")) && readdirSync(path.join(paths.root, ".studio", "replaced")).some((f) => f.endsWith("-lyrics.txt")), "the old lyrics.txt is kept in .studio\\replaced\\");
    await page.click("[data-lyrics-text] summary");
    await page.click("[data-restore] >> nth=0");
    await page.waitForSelector("[data-label-flags]");
    check(readFileSync(paths.lyricsTxt, "utf8").startsWith("[Chorus]"), "Restore brings the earlier version back");
    check(existsSync(songFile), "the song file is untouched");
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
