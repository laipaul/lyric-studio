// The render adds the soft backing by itself (readability "auto") when the clips are bright behind the
// lyrics, and not over dark clips; "normal" in song.json is the user's override (planned with a dry
// run: the same planner and props as the render).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, openWorkspace, seedStylePresets } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureAlignment, findOrCreateSongProject, loadTheme, makeVideos, readRecipe, songPathsById, writeRecipe, writeTheme, type AlignRunner } from "../src/node";
import { BIG_HOOK_SCALE } from "../src/text-layout";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-readability-"));
const wsDir = path.join(root, "workspace");
const inDir = path.join(root, "in");
const ffmpeg = (...args: string[]) => execFileSync(ffmpegBin(), ["-y", "-v", "error", ...args]);
const previousWorkspace = process.env.WORKSPACE_DIR;
const LYRICS = ["Verse one here", "* Hold on to me", "Through the night", "Verse two here"];

const fakeAlign: AlignRunner = async (a) => {
  const texts = readFileSync(a.lyrics, "utf8").split(/\r?\n/).filter(Boolean);
  const stamp = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(2).padStart(5, "0")}`;
  const lines = texts.map((raw, i) => {
    const hook = raw.startsWith("* ");
    const text = raw.replace(/^\*\s+/, "");
    const start = 1000 + i * 1500;
    return { line: `[${stamp(start)}]${hook ? "* " : ""}${text.split(" ").map((w, k) => `<${stamp(start + k * 300)}>${w}`).join(" ")}`, report: { number: i + 1, text, is_hook: hook, start_ms: start, end_ms: start + 1100, confidence: 0.9 } };
  });
  writeFileSync(a.out, `${lines.map((l) => l.line).join("\n")}\n[${stamp(1000 + texts.length * 1500)}]\n`);
  writeFileSync(a.report, JSON.stringify({ model: "fake", lang: a.lang, low_confidence: 0.5, lines: lines.map((l) => l.report) }));
};

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(inDir, { recursive: true });
  for (const [name, colour] of [["night", "0x101018"], ["dress", "0xf0ece4"]] as const) {
    mkdirSync(path.join(wsDir, "clips", name), { recursive: true });
    for (const n of [1, 2]) ffmpeg("-f", "lavfi", "-i", `color=c=${colour}:s=216x384:r=30:d=4`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(wsDir, "clips", name, `0${n}_${name}.mp4`));
  }
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)':s=44100:d=10", "-ac", "2", path.join(inDir, "song.wav"));
  writeFileSync(path.join(inDir, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  const ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  // A stored alignment (a dry run never aligns).
  const sp = await findOrCreateSongProject(ws, path.join(inDir, "song.wav"));
  const lyricsTxt = songPathsById(ws, sp.project.id).lyricsTxt;
  writeFileSync(lyricsTxt, `${LYRICS.join("\n")}\n`);
  await ensureAlignment(ws, sp, { lyricsTxt, durationMs: 10_000, align: fakeAlign });
  ws.close();
}, 120_000);
afterAll(() => {
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("lyric readability in the render", () => {
  const plan = async (collection: string) => {
    const logs: string[] = [];
    const r = await makeVideos({
      workspaceDir: wsDir, song: path.join(inDir, "song.wav"), lyrics: path.join(inDir, "lyrics.txt"), collection, variations: 1, section: "0:01-0:07",
      dryRun: true, align: fakeAlign, log: (m: string) => logs.push(m),
    });
    return { props: r.platforms[0].plan!.videos[0].props, logs };
  };

  it("auto: dark clips get no backing, bright clips get the soft backing; normal is the user's override", async () => {
    const dark = await plan("night");
    expect(dark.props.lyricBacking).toBeUndefined();
    expect(dark.logs.some((l) => /lyric readability auto: the lyrics read clearly over all 2 clips, no backing/.test(l))).toBe(true);
    const bright = await plan("dress");
    expect(bright.props.lyricBacking).toBe(true);
    expect(bright.logs.some((l) => /lyric readability auto: 2 of 2 clips are bright behind the lyrics, so a soft dark band goes behind them/.test(l))).toBe(true);
    const ws = openWorkspace(wsDir);
    const id = (await findOrCreateSongProject(ws, path.join(inDir, "song.wav"))).project.id;
    writeRecipe(songPathsById(ws, id).recipe!, { readability: "normal" });
    ws.close();
    expect((await plan("dress")).props.lyricBacking).toBeUndefined();
  }, 300_000);

  it("the theme's text layout goes into the planned video: Lower third moves the lyric area, Big hook sizes the chorus", async () => {
    const before = (await plan("night")).props;
    const ws = openWorkspace(wsDir);
    const id = (await findOrCreateSongProject(ws, path.join(inDir, "song.wav"))).project.id;
    const name = readRecipe(songPathsById(ws, id).recipe!).theme!;
    const setLayout = (textLayout: "centre" | "lower" | "bighook") => {
      const t = loadTheme(wsDir, name);
      writeTheme(wsDir, { ...t, look: { ...t.look, textLayout } });
    };
    setLayout("lower");
    const lower = (await plan("night")).props;
    expect(lower.textLayout).toBe("lower");
    expect(lower.lyricArea!.centerY).toBeGreaterThan(before.lyricArea!.centerY);
    expect(lower.lyricEffects?.hookScale).toBeUndefined();
    setLayout("bighook");
    const big = (await plan("night")).props;
    expect(big.lyricArea!.centerY).toBe(before.lyricArea!.centerY);
    expect(big.lyricEffects?.hookScale).toBe(BIG_HOOK_SCALE);
    setLayout("centre");
    ws.close();
  }, 300_000);

  it("an empty shared collection is skipped with a note, the run goes on with the other clips (1 Nov 2026)", async () => {
    mkdirSync(path.join(wsDir, "clips", "Flowers"), { recursive: true }); // made in Collections, never filled
    const r = await plan("night,Flowers");
    expect(r.props.shots.length).toBeGreaterThan(0);
    expect(r.logs.some((l) => /collection Flowers skipped: it has no clips/.test(l))).toBe(true);
  });
});

