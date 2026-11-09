// Shape → Look → Change → Apply (before 2e-1): applying another theme to a song changes only the look. A theme holds
// fonts, effects, colours, cards and the text layout, never pacing (shotLength, transitions, paceShift, ending are
// the song's own), so the shots, their trims, the cuts the user moved, the lyric timing and the storyboard's locks
// must come back exactly the same; only the storyboard's theme name changes.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { chooseTheme, createTheme, findOrCreateSongProject, loadFontCatalog, readClipEdits, makeVideos, readRecipe, readStoryboard, setThemeLook, songPathsById, storyboardFile, storyboardPlan, writeClipEdits, writeRecipe, type RenderOptions } from "../src/node";
import { THEME_FIELDS } from "../src/node/themes";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-theme-apply-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "Apply Test.wav");
const sample = path.join(root, "s.mp4");
const previousWorkspace = process.env.WORKSPACE_DIR;
const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
let ws: Workspace;
let id: string;
let songRoot: string;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  makeSong(song, 20);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, name] of ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4"].entries()) makeClip(path.join(paths.clips!, name), 8, ["blue", "yellow", "red", "green"][i]);
  writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 }, shotLength: "rate" });
  await makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32" });
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

const timing = (sb: NonNullable<ReturnType<typeof readStoryboard>>) => ({
  shots: sb.shots.map((s) => ({ id: s.id, clip: s.clip, startMs: s.startMs, endMs: s.endMs, trim: s.trim, speed: s.speed, transitionIn: s.transitionIn, locked: s.locked, carries: s.carries })),
  lyrics: sb.text.filter((x) => x.kind === "lyric").map((x) => ({ id: x.id, startMs: x.startMs, endMs: x.endMs, locked: x.locked })),
  range: sb.output.range,
  analysis: sb.analysis,
  unmatched: sb.edits.unmatched,
});

describe("applying a theme from Shape", () => {
  it("a theme holds no pacing field", () => {
    for (const f of ["shotLength", "transitions", "paceShift", "ending", "section", "length", "tempo"]) expect(THEME_FIELDS as readonly string[]).not.toContain(f);
  });

  it("keeps every shot, trim, moved cut, lock and the lyric timing; only the theme name changes", async () => {
    const catalog = loadFontCatalog(wsDir);
    const before = await storyboardPlan(ws, id, "reels", "v1");
    // The user's own edits: a moved cut and a slip (they become locks in the storyboard).
    const second = before.shots[1];
    writeClipEdits(songRoot, { ...readClipEdits(songRoot), cuts: [{ from: second.songMs / 1000 - 0.4, to: second.songMs / 1000 }], slips: [{ at: second.songMs / 1000, clip: second.clip, in: second.inS }] });
    await storyboardPlan(ws, id, "reels", "v1");
    const file = storyboardFile(songRoot, "reels-1");
    const was = readStoryboard(file)!;
    expect(was.shots.some((s) => s.locked.includes("trim"))).toBe(true);
    const oldTheme = readRecipe(songPathsById(ws, id).recipe!).theme!;

    // A theme as different as a theme can be: every text and card choice changed.
    createTheme(ws, { projectId: id, name: "Contrast", from: oldTheme, catalog });
    chooseTheme(ws, id, oldTheme, catalog); // createTheme points the song at it: back to the old one first
    const contrast = { verseEffect: "typewriter", hookEffect: "neon", lineShape: "stacked", lineBuild: "build", textLayout: "bighook", finalHook: "on", hookCard: "on", endCard: "on", accentColour: "#33CCFF", textColour: "#FFEE00", grade: "warm", vignette: "strong" };
    chooseTheme(ws, id, "Contrast", catalog);
    setThemeLook(ws, { projectId: id, scope: "all", catalog, values: contrast });

    await storyboardPlan(ws, id, "reels", "v1");
    const now = readStoryboard(file)!;
    expect(now.output.theme.name).toBe("Contrast");
    expect(was.output.theme.name).toBe(oldTheme);
    expect(timing(now)).toEqual(timing(was));
  }, 300_000);
});
