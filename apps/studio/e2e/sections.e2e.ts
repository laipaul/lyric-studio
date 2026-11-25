// Browser test (needs a studio build, FFmpeg and Playwright, as videos-post.e2e.ts): Sections in Lyrics Sync (22 Nov
// 2026, Mini film step 2). Only on a Mini film song: the suggestion from the lyrics' stanzas, repeats and hooks; a
// kind changed on its row; ✕ joins a section to the one before; a section started on a line; Back to the suggestion.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, songPathsById, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-sections-"));
const wsDir = path.join(root, "workspace");
const port = 3247;
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
  writeFileSync(paths.lyricsTxt, "You're beautiful\n\n* On our wedding day\n\nYears from now\n\n* On our wedding day\n");
  writeFileSync(paths.recipe!, JSON.stringify({ songStyle: "singing" }));
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, "[00:02.00]<00:02.00>You're <00:03.00>beautiful <00:04.50>\n[00:06.00]<00:06.00>On <00:06.50>our <00:07.00>wedding <00:07.60>day <00:08.50>\n[00:10.00]<00:10.00>Years <00:10.60>from <00:11.00>now <00:12.00>\n[00:13.00]<00:13.00>On <00:13.50>our <00:14.00>wedding <00:14.40>day <00:15.00>\n[00:18.00]\n");
    const lines = ["You're beautiful", "On our wedding day", "Years from now", "On our wedding day"].map((text, i) => ({ number: i + 1, text, is_hook: i % 2 === 1, start_ms: [2_000, 6_000, 10_000, 13_000][i], end_ms: [4_500, 8_500, 12_000, 15_000][i], confidence: 0.9 }));
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
    const saved = () => (JSON.parse(readFileSync(paths.recipe!, "utf8")) as { sections?: { line: number; kind: string; feeling?: string }[] }).sections;
    const put = (r: { url(): string; request(): { method(): string } }) => r.url().includes("/sections") && r.request().method() === "PUT";
    const kinds = () => page.$$eval("[data-section-chip]", (els: Element[]) => els.map((e) => e.getAttribute("data-section-chip")).join(","));
    const rows = () => page.$$eval("[data-section-row]", (els: Element[]) => els.map((e) => e.getAttribute("data-section-row")).join(","));

    // Add lip sync: no sections.
    await page.goto(`${base}/songs/${sp.project.id}?tab=lyrics`);
    await page.waitForSelector("[data-lines-scroll] th");
    await sleep(1000);
    check((await page.$("[data-sections]")) === null && (await page.$$("[data-section-row]")).length === 0, "not a Mini film song: no sections in Lyrics Sync");

    // Mini film: the suggestion.
    await fetch(`${base}/api/songs/${sp.project.id}/style`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: "film" }) });
    await page.reload();
    await page.waitForSelector("[data-sections=suggested] [data-section-chip]");
    check((await rows()) === "1,2,3,4", `suggested: a section row above lines 1, 2, 3, 4 (${await rows()})`);
    check((await kinds()) === "verse,chorus,verse,chorus", `verse, chorus, verse, chorus from the stanzas and the hooks (${await kinds()})`);
    check(saved() === undefined, "nothing saved while it is only suggested");

    // A kind changed on its row saves the whole list.
    await Promise.all([page.waitForResponse(put), page.selectOption("[data-section-row='3'] [data-section-kind]", "bridge")]);
    await page.waitForSelector("[data-sections=saved] [data-section-chip=bridge]");
    check(JSON.stringify(saved()) === JSON.stringify([{ line: 1, kind: "verse" }, { line: 2, kind: "chorus" }, { line: 3, kind: "bridge" }, { line: 4, kind: "chorus" }]), `the kind is saved in song.json (${JSON.stringify(saved())})`);

    // ✕ joins line 3 to the chorus before it; + starts a section there again.
    await Promise.all([page.waitForResponse(put), page.click("[data-section-row='3'] [data-section-join]")]);
    await page.waitForFunction(() => !document.querySelector("[data-section-row='3']"));
    check((await rows()) === "1,2,4", `✕ joins the section to the one before (${await rows()})`);
    await page.hover("tr[data-line='3']");
    await Promise.all([page.waitForResponse(put), page.click("[data-section-start='3']")]);
    await page.waitForSelector("[data-section-row='3']");
    check((await rows()) === "1,2,3,4" && (await page.$eval("[data-section-row='3'] [data-section-kind]", (e: Element) => (e as HTMLSelectElement).value)) === "verse", "Start a section on line 3 adds a verse there");
    // Feeling (25 Nov 2026): chosen on the row, kept with a later change of kind; your own word too.
    await Promise.all([page.waitForResponse(put), page.selectOption("[data-section-row='2'] [data-section-feeling]", "longing")]);
    await page.waitForSelector("[data-section-chip-feeling]");
    await Promise.all([page.waitForResponse(put), page.selectOption("[data-section-row='2'] [data-section-kind]", "bridge")]);
    await page.waitForSelector("[data-sections=saved] [data-section-chip=bridge]");
    check(JSON.stringify(saved()?.[1]) === JSON.stringify({ line: 2, kind: "bridge", feeling: "longing" }), `the feeling is saved and kept when the kind changes (${JSON.stringify(saved()?.[1])})`);
    await page.selectOption("[data-section-row='4'] [data-section-feeling]", "__own");
    await page.fill("[data-section-feeling-own]", "Quiet wonder");
    await Promise.all([page.waitForResponse(put), page.press("[data-section-feeling-own]", "Enter")]);
    await page.waitForFunction(() => (document.querySelector("[data-section-row='4'] [data-section-feeling]") as HTMLSelectElement | null)?.value === "quiet wonder");
    check(saved()?.[3]?.feeling === "quiet wonder", `your own word is saved (${JSON.stringify(saved()?.[3])})`);
    if (process.env.SECTIONS_SHOT) await (await page.$("[data-sections]"))!.screenshot({ path: process.env.SECTIONS_SHOT });
    if (process.env.SECTIONS_SHOT) await (await page.$("[data-lines-scroll]"))!.screenshot({ path: process.env.SECTIONS_SHOT.replace(".png", "-rows.png") });

    // Back to the suggestion forgets the saved list.
    await Promise.all([page.waitForResponse(put), page.click("[data-sections-reset]")]);
    await page.waitForSelector("[data-sections=suggested]");
    check(saved() === undefined, "Back to the suggestion: song.json has no sections");
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
