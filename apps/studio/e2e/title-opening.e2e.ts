// Browser test of the Reel's title opening (needs a studio build, FFmpeg and Playwright, as the others).
// A Reels part of the song that starts exactly on a sung line (Let My Love Carry You, hook in a script font),
// Title opening on, a tagline. Shape's player is seeked to 1.5-2.7 s and the boxes of the title, byline,
// tagline and the lyric line are read from the DRAWN DOM (data-text-card, data-lyric), in composition pixels:
// no title-opening block may touch the lyric box, and the cards are still on screen after 4 s of video time.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, project } from "@lyric/db";
import { ensureAlignment, findOrCreateSongProject, songPathsById, type AlignRunner } from "@lyric/video/node";
import { eq } from "drizzle-orm";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-e2e-title-opening-"));
const wsDir = path.join(root, "workspace");
const port = 3194;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};
const ffmpeg = (...args: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...args]);
const TEXTS = ["Let my love carry you through the night", "Hold on to me", "Through the night", "Verse two here", "Hold on to me", "Into the light"];
const STARTS = [1000, 5500, 8000, 10_500, 13_000, 16_000];
const stamp = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, "0")}`;

type Box = { left: number; top: number; right: number; bottom: number };

async function main() {
  process.env.WORKSPACE_DIR = wsDir;
  const song = path.join(root, "Let My Love Carry You.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)+0.9*sin(2*PI*55*t)*exp(-12*mod(t-0.25,2))*gte(t,0.25)':s=44100:d=20", "-ac", "2", song);
  const ws = openWorkspace(wsDir);
  const sp = await findOrCreateSongProject(ws, song);
  const paths = songPathsById(ws, sp.project.id);
  writeFileSync(paths.lyricsTxt, `${TEXTS.map((t, i) => (i === 0 || i === 4 ? `* ${t}` : t)).join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [name, colour] of [["01_a.mp4", "blue"], ["02_b.mp4", "yellow"], ["03_c.mp4", "red"]] as const) {
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=6", "-vf", `drawbox=c=${colour}@0.6:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(paths.clips!, name));
  }
  // The part of the song starts exactly on the first sung line (1.0 s): the line is on screen from ~0.6 s.
  const baseRecipe = { platforms: ["reels"], section: "0:01-0:17", titleOpening: "on", tagline: "Flower arrangements by Noriko", hookFont: "Kaushan Script" };
  writeFileSync(paths.recipe!, JSON.stringify(baseRecipe));
  const lrc = TEXTS.map((t, i) => `[${stamp(STARTS[i])}]${t.split(" ").map((w, k) => `<${stamp(STARTS[i] + k * 300)}>${w}`).join(" ")} <${stamp(STARTS[i] + 2400)}>`).join("\n");
  const aligner: AlignRunner = async (a) => {
    writeFileSync(a.out, `${lrc}\n[00:19.00]\n`);
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: TEXTS.map((text, i) => ({ number: i + 1, text, is_hook: i === 0 || i === 4, start_ms: STARTS[i], end_ms: STARTS[i] + 2400, confidence: 0.9 })) }));
  };
  const p = ws.db.select().from(project).where(eq(project.id, sp.project.id)).get()!;
  await ensureAlignment(ws, { ...sp, project: p }, { lyricsTxt: paths.lyricsTxt, durationMs: 20_000, align: aligner });
  absPath(ws, p.audio_path!);
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript("window.__name = (f) => f;"); // tsx's keepNames helper, used inside page.evaluate
    let planned: { textCards?: { id: string; top?: number; centerY?: number; size: number; endFrame: number; lines?: string[] }[]; lyricArea?: unknown; lyricEffects?: unknown; textLayout?: string; textSize?: number } | null = null;
    page.on("response", async (res: { url(): string; json(): Promise<Record<string, unknown>> }) => {
      if (!/\/api\/songs\/[^/]+\/storyboard(\?|$)/.test(res.url())) return;
      const j = await res.json().catch(() => null);
      const pr = (j?.props ?? (j?.view as { props?: unknown } | undefined)?.props) as typeof planned;
      if (pr) planned = pr;
    });
    const SCENARIOS: { name: string; recipe: Record<string, unknown> }[] = process.env.SCENARIOS
      ? JSON.parse(process.env.SCENARIOS)
      : [
          { name: "script hook font, the theme's default hook effect", recipe: {} },
          { name: "hook effect floating (lyric moves)", recipe: { hookEffect: "floating" } },
          { name: "hook effect ascend", recipe: { hookEffect: "ascend" } },
          { name: "Big hook layout, word reveal", recipe: { textLayout: "bighook", hookEffect: "word-reveal" } },
        ];
    for (const sc of SCENARIOS) {
    console.log(`  scenario: ${sc.name}`);
    writeFileSync(paths.recipe!, JSON.stringify({ ...baseRecipe, ...sc.recipe }));
    await page.goto(`${base}/songs/${sp.project.id}?tab=storyboard`);
    await page.waitForSelector("[data-storyboard-show]");
    await page.waitForSelector("[data-shot='1']", { timeout: 180_000 });
    await page.waitForSelector("[data-replanning]", { state: "detached", timeout: 180_000 }).catch(() => null);
    const tFrame = async () => Number(await page.getAttribute("[data-transport]", "data-frame"));
    const seek = async (frame: number) => {
      // Home, then frame steps: Shift + forward steps one frame; forward alone one bar.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.click("[data-transport-button=start]");
      await page.waitForFunction(() => Number(document.querySelector("[data-transport]")?.getAttribute("data-frame")) === 0, null, { timeout: 5000 }).catch(() => {});
      await page.click("[data-transport-button=forward]"); // one bar = 60 frames at 120 BPM
      await page.waitForFunction(() => Number(document.querySelector("[data-transport]")?.getAttribute("data-frame")) > 0, null, { timeout: 5000 }).catch(() => {});
      let guard = 0;
      while ((await tFrame()) !== frame && guard++ < 200) {
        const now = await tFrame();
        await page.click(`[data-transport-button=${now < frame ? "forward" : "back"}]`, { modifiers: ["Shift"] });
        await sleep(25);
      }
      await sleep(250);
    };
    // The boxes of what the player draws, in composition pixels (the player scales the 1080×1920 frame).
    const read = () =>
      page.evaluate(() => {
        const lyric = document.querySelector("[data-lyric]");
        if (!lyric) return null;
        let frameEl: HTMLElement | null = lyric.parentElement;
        while (frameEl && !(frameEl.offsetWidth === 1080 && frameEl.offsetHeight === 1920)) frameEl = frameEl.parentElement;
        if (!frameEl) return null;
        const o = frameEl.getBoundingClientRect();
        const s = o.width / 1080;
        const inkBox = (el: Element): { left: number; top: number; right: number; bottom: number } | null => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
          if (!rects.length) return null;
          const l = Math.min(...rects.map((r) => r.left));
          const t = Math.min(...rects.map((r) => r.top));
          const r = Math.max(...rects.map((x) => x.right));
          const b = Math.max(...rects.map((x) => x.bottom));
          return { left: (l - o.left) / s, top: (t - o.top) / s, right: (r - o.left) / s, bottom: (b - o.top) / s };
        };
        const cards = [...frameEl.querySelectorAll("[data-text-card]")].map((e) => {
          // The card's row boxes (its line boxes, as laid out), across the text's width.
          const r = e.getBoundingClientRect();
          const ink = inkBox(e);
          return { id: e.getAttribute("data-text-card")!, box: ink ? { left: ink.left, right: ink.right, top: (r.top - o.top) / s, bottom: (r.bottom - o.top) / s } : null };
        });
        const lyrics = [...frameEl.querySelectorAll("[data-lyric]")].map((e) => {
          const r = e.getBoundingClientRect();
          return { text: e.getAttribute("data-lyric")!, role: e.getAttribute("data-role"), box: inkBox(e), css: { top: (r.top - o.top) / s, bottom: (r.bottom - o.top) / s }, opacity: getComputedStyle(e).opacity };
        });
        return { scale: s, cards, lyrics };
      });
    const hit = (a: Box, b: Box, m: number) => a.left < b.right + m && a.right > b.left - m && a.top < b.bottom + m && a.bottom > b.top - m;
    const rnd = (b: Box | null) => (b ? `${Math.round(b.top)}-${Math.round(b.bottom)}` : "none");
    console.log("    plan cards:", JSON.stringify(planned?.textCards?.map((c) => ({ id: c.id, top: c.top, centerY: c.centerY, size: c.size, end: c.endFrame, lines: c.lines }))), "area", JSON.stringify(planned?.lyricArea), "textSize", planned?.textSize, "layout", planned?.textLayout, "fx", JSON.stringify(planned?.lyricEffects));
    for (const sec of [1.5, 2.1, 2.7, 3.3, 3.9]) {
      const frame = Math.round(sec * 30);
      await seek(frame);
      const got = await read();
      if (!got) {
        check(false, `at ${sec} s nothing is drawn`);
        continue;
      }
      const cards = got.cards.filter((c) => c.box);
      const lyrics = got.lyrics.filter((l) => l.box && l.role !== "next");
      console.log(`    t=${sec} s (frame ${await tFrame()}, scale ${got.scale.toFixed(3)}): ${got.cards.map((c) => `${c.id} y ${rnd(c.box)}`).join(", ")} | ${got.lyrics.map((l) => `"${l.text}" [${l.role}, op ${l.opacity}] y ${rnd(l.box)} (row ${Math.round(l.css.top)}-${Math.round(l.css.bottom)})`).join(" | ")}`);
      check(cards.some((c) => c.id === "title") && cards.some((c) => c.id === "tagline"), `at ${sec} s the title and the tagline are still on screen (${cards.map((c) => c.id).join(", ")})`);
      const clashes = cards.flatMap((c) => lyrics.filter((l) => hit(c.box!, l.box!, 4)).map((l) => `${c.id} ${rnd(c.box)} x "${l.text}" ${rnd(l.box)}`));
      check(clashes.length === 0, `at ${sec} s no title-opening block touches a lyric line${clashes.length ? ` (${clashes.join("; ")})` : ""}`);
    }
    }
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? root, "title-opening.png") });
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
