// Step 2e-1: Make makes every video from its shot plan (storyboards\<platform>-<n>.json). No plan yet: saved first. The
// same plan: made as saved. The song's settings changed: planned and saved again first (the old one kept as .previous,
// what changed said in the run's notes and the manifest). Nothing changed but the plan differs from what the app would
// plan now: the SAVED plan is made (the file wins). A Try other looks video has its own shot plan. The compile itself:
// test/storyboard-file.test.ts style checks below.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileShotPlan, planChanges, sameDecisions, storyboardTiming, type StoryboardFile } from "../src";
import { createTheme, findOrCreateSongProject, runSummary, songRuns, storyboardChoices, loadFontCatalog, makeVideos, readRecipe, readStoryboard, songPathsById, storyboardFile, storyboardPlan, writeRecipe, writeStoryboard, type Manifest, type RenderOptions } from "../src/node";
import { collectionFolder } from "../src/node/collections";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-shotplan-"));
const wsDir = path.join(root, "workspace");
const sample = path.join(root, "s.mp4");
const still = path.join(root, "s.jpg");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id: string;
let songRoot: string;
type Props = RenderOptions["props"];
let rendered: { video: string; props: Props }[] = [];

const make = async (extra: Record<string, unknown> = {}) => {
  rendered = [];
  const paths = songPathsById(ws, id);
  const result = await makeVideos({
    workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, platform: "win32",
    renderer: async (o: RenderOptions) => (rendered.push({ video: path.basename(o.outFile, ".mp4"), props: o.props }), copyFileSync(sample, o.outFile), o.outFile),
    thumbnailRenderer: async (o) => (copyFileSync(still, o.outFile), o.outFile),
    ...extra,
  });
  return result;
};
const manifestOf = (exportDir: string, video = "v1") => JSON.parse(readFileSync(path.join(exportDir, "reels", `${video}.manifest.json`), "utf8")) as Manifest;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", still);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  const song = path.join(root, "Plan Test.wav");
  makeSong(song, 20);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, c] of ["blue", "yellow", "red", "green"].entries()) makeClip(path.join(paths.clips!, `0${i + 1}_${c}.mp4`), 8, c);
  writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 } });
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("Make makes every video from its shot plan", () => {
  it("no plan yet: saved first, said in the notes and the manifest; the copy sits next to the video", async () => {
    const r = await make();
    const file = storyboardFile(songRoot, "reels-1");
    expect(existsSync(file)).toBe(true);
    const m = manifestOf(r.exportDir);
    expect(m.shot_plan).toMatchObject({ id: "reels-1", status: "new", note: "no shot plan yet: saved before making it" });
    expect(existsSync(path.join(r.exportDir, "reels", "v1.shotplan.json"))).toBe(true);
    // The props made are the shot plan's: its cuts and lyric timing, frame for frame.
    const sb = readStoryboard(file)!;
    const t = storyboardTiming(sb);
    expect(rendered[0].props.shots.map((s) => [s.start, s.duration])).toEqual(t.shots.map((s) => [s.start, s.duration]));
    expect(rendered[0].props.lyrics.map((l) => [l.startFrame, l.endFrame])).toEqual(t.lyrics.map((l) => [l.startFrame, l.endFrame]));
  }, 300_000);

  it("Shape's plan and Make agree: made as saved, nothing to say", async () => {
    await storyboardPlan(ws, id, "reels", "v1");
    const r = await make();
    expect(manifestOf(r.exportDir).shot_plan).toMatchObject({ status: "same", note: null });
  }, 300_000);

  it("nothing changed but the saved plan differs from the app's: the SAVED plan is made (the file wins)", async () => {
    const file = storyboardFile(songRoot, "reels-1");
    const sb = readStoryboard(file)!;
    // The second cut moved 0.5 s later in the file (as a future Shape edit or an older app would have it).
    const edited: StoryboardFile = { ...sb, shots: sb.shots.map((s, i) => (i === 1 ? { ...s, startMs: s.startMs + 500 } : i === 0 ? { ...s, endMs: s.endMs + 500 } : s)) };
    writeStoryboard(file, edited);
    const r = await make();
    const m = manifestOf(r.exportDir);
    expect(m.shot_plan?.status).toBe("kept");
    expect(m.shot_plan?.note).toMatch(/made from its saved shot plan as it is; the app would now plan it differently \(1 of \d+ cuts moved\)/);
    const t = storyboardTiming(edited);
    expect(rendered[0].props.shots[1].start).toBe(t.shots[1].start);
    expect(rendered[0].props.shots[0].duration).toBe(t.shots[0].duration);
    expect(rendered[0].props.cutFrames?.[0]).toBe(t.shots[1].start);
    expect(readStoryboard(file)!.shots[1].startMs).toBe(edited.shots[1].startMs); // the file stays as it was
    // Shape shows the same saved plan, and says so.
    const view = await storyboardPlan(ws, id, "reels", "v1");
    expect(view.props.shots[1].start).toBe(t.shots[1].start);
    expect(view.notes.some((n) => n.startsWith("This is your saved shot plan"))).toBe(true);
  }, 300_000);

  it("the song's settings changed: planned and saved again first, the old plan kept, what changed said", async () => {
    const paths = songPathsById(ws, id);
    writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), section: "0:02-0:18" });
    const before = readStoryboard(storyboardFile(songRoot, "reels-1"))!;
    const r = await make();
    const m = manifestOf(r.exportDir);
    expect(m.shot_plan?.status).toBe("replanned");
    expect(m.shot_plan?.note).toMatch(/^shot plan saved again before making it: the part of the song: 0:0\d\.\d-0:16\.0 -> 0:0\d\.\d-0:18\.0; 4 shots -> 5 \(/);
    expect(m.shot_plan?.note).toContain("reels-1.previous.json");
    // ...and the run's message in Tasks says it (never silently).
    expect(runSummary(r, false)).toMatch(/\n[^\n]*Reels v1: shot plan saved again before making it: the part of the song/);
    const previous = readStoryboard(storyboardFile(songRoot, "reels-1").replace(/\.json$/, ".previous.json"))!;
    expect(previous.output.range).toEqual(before.output.range);
    expect(readStoryboard(storyboardFile(songRoot, "reels-1"))!.output.range.endMs).toBeGreaterThan(before.output.range.endMs);
    writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), section: "0:00-0:16" });
  }, 300_000);

  it("a Try other looks theme has its own shot plan; the video's own plan is untouched; Shape opens it", async () => {
    await make(); // the video's own plan, with the song's settings as they are now
    const own = readFileSync(storyboardFile(songRoot, "reels-1"), "utf8");
    const song = readRecipe(songPathsById(ws, id).recipe!).theme!;
    createTheme(ws, { projectId: id, name: "Night Drive", from: song, catalog: loadFontCatalog(wsDir) });
    writeRecipe(songPathsById(ws, id).recipe!, { ...readRecipe(songPathsById(ws, id).recipe!), theme: song }); // createTheme moved the song: back
    const r = await make({ theme: "Night Drive" });
    const file = storyboardFile(songRoot, "reels-1~theme-night-drive");
    expect(existsSync(file)).toBe(true);
    const t = readStoryboard(file)!;
    expect(t.output.try).toEqual({ kind: "theme", label: "Night Drive", theme: "Night Drive" });
    expect(t.output.theme.name).toBe("Night Drive");
    expect(manifestOf(r.exportDir).shot_plan).toMatchObject({ id: "reels-1~theme-night-drive", status: "new" });
    // Review labels it (11 Nov 2026): "try: theme Night Drive" on its card; the song's own versions have no label.
    const videos = songRuns(ws, id).flatMap((x) => x.platforms.flatMap((p) => p.videos));
    expect(videos.filter((v) => v.try === "theme Night Drive")).toHaveLength(1);
    expect(videos.filter((v) => !v.try).length).toBeGreaterThan(0);
    expect(readFileSync(storyboardFile(songRoot, "reels-1"), "utf8")).toBe(own);
    // A theme is only the look: the try plans the same cuts and lyric timing.
    expect(sameDecisions(readStoryboard(storyboardFile(songRoot, "reels-1"))!, t)).toBe(true);
    const view = await storyboardPlan(ws, id, "reels", "v1", undefined, "reels-1~theme-night-drive");
    expect(view.video).toBe("v1");
    expect(readStoryboard(file)!.output.try?.theme).toBe("Night Drive");
  }, 300_000);
});

describe("Try other looks: picture versions and font pairings", () => {
  it("each picture version and each font pairing has its own shot plan, named after it", async () => {
    const city = collectionFolder(ws, "city");
    mkdirSync(city, { recursive: true });
    for (const [i, c] of ["purple", "orange", "white"].entries()) makeClip(path.join(city, `c${i + 1}_${c}.mp4`), 8, c);
    const pictures = await make({ pictures: "song,city" });
    expect(pictures.variations.filter((v) => !v.error)).toHaveLength(2);
    for (const label of ["song", "city"]) {
      const sb = readStoryboard(storyboardFile(songRoot, `reels-1~pictures-${label}`))!;
      expect(sb.output.try).toMatchObject({ kind: "pictures", clipSet: label });
    }
    // Other clips: other shots (the city version uses the city clips only).
    const city1 = readStoryboard(storyboardFile(songRoot, "reels-1~pictures-city"))!;
    expect(city1.shots.every((s) => s.clip.startsWith("c"))).toBe(true);
    const fonts = await make({ pairings: "elegant,dramatic" });
    expect(fonts.variations.filter((v) => !v.error)).toHaveLength(2);
    expect(readStoryboard(storyboardFile(songRoot, "reels-1~fonts-elegant"))!.output.try).toMatchObject({ kind: "fonts", pairing: "elegant" });
    expect(sameDecisions(readStoryboard(storyboardFile(songRoot, "reels-1~fonts-elegant"))!, readStoryboard(storyboardFile(songRoot, "reels-1~fonts-dramatic"))!)).toBe(true); // fonts are only the look
    // Shape lists the tries and opens one with its own clips.
    const view = await storyboardPlan(ws, id, "reels", "v1", undefined, "reels-1~pictures-city");
    expect(view.shots.every((s) => s.clip.startsWith("c"))).toBe(true);
    expect(storyboardChoices(ws, id).tries.map((t) => t.id).sort()).toEqual(["reels-1~fonts-dramatic", "reels-1~fonts-elegant", "reels-1~pictures-city", "reels-1~pictures-song", "reels-1~theme-night-drive"]);
  }, 600_000);
});

describe("the compile (shot plan -> props)", () => {
  it("a shot plan that does not fit the props (other lyrics) is refused; planChanges names the changes", () => {
    const sb = readStoryboard(storyboardFile(songRoot, "reels-1"))!;
    const look = rendered[0]?.props;
    expect(look).toBeTruthy();
    expect(compileShotPlan(sb, { ...look, lyrics: look.lyrics.slice(1) })).toBeNull();
    const moved: StoryboardFile = { ...sb, text: sb.text.map((x) => (x.kind === "lyric" ? { ...x, startMs: x.startMs + 100 } : x)) };
    expect(planChanges(sb, moved)).toEqual([`the lyric timing of ${sb.text.filter((x) => x.kind === "lyric").length} lines`]);
    const older: StoryboardFile = { ...sb, output: { ...sb.output, audio: undefined }, shots: sb.shots.map(({ render: _r, ...s }) => s) };
    expect(compileShotPlan(older, look)).toBeNull(); // from before 2e-1: completed the next time it is planned
    expect(sameDecisions(older, sb)).toBe(true); // ...quietly: only the render detail was missing
  });
});
