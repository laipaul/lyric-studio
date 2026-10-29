// The title opening in pnpm make (Step D): song.json titleOpening "on" + tagline -> the Reel opens with
// title + byline in the upper third and the tagline in the lower third, gone before the first lyric line;
// QA checks them; every Reel gets a cover with the same cards (no lyrics, no audio).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, makeVideos, readManifest, songPathsById, writeRecipe, type RenderOptions } from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-title-opening-"));
const wsDir = path.join(root, "workspace");
const song = path.join(root, "Opening Test.wav");
const sample = path.join(root, "s.mp4");
const previousWorkspace = process.env.WORKSPACE_DIR;
const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
let ws: Workspace;
let paths: ReturnType<typeof songPathsById>;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  makeSong(song, 20);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  const id = (await findOrCreateSongProject(ws, song)).project.id;
  paths = songPathsById(ws, id);
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, name] of ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4"].entries()) makeClip(path.join(paths.clips!, name), 8, ["blue", "yellow", "red", "green"][i]);
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("the title opening", () => {
  it("opens the Reel with the title cards, checks them and makes a cover", async () => {
    writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 }, titleOpening: "on", tagline: "A song for the road" });
    const covers: { outFile: string; frame: number; lyrics: number; audio: unknown; cards: string[] }[] = [];
    const r = await makeVideos({
      workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32",
      coverRenderer: async (o) => {
        covers.push({ outFile: o.outFile, frame: o.frame, lyrics: o.props.lyrics.length, audio: o.props.audio, cards: (o.props.textCards ?? []).map((c) => c.type) });
        writeFileSync(o.outFile, "jpg");
        return o.outFile;
      },
    });
    const v = r.platforms[0].variations[0];
    const m = readManifest(v.manifestFile);
    const cards = m.props.textCards ?? [];
    expect(cards.map((c) => c.type)).toEqual(["title", "byline", "tagline"]);
    expect(cards.find((c) => c.type === "tagline")!.text).toBe("A song for the road");
    const first = m.props.lyrics[0];
    const firstFrame = first.enterFrame ?? first.startFrame;
    for (const c of cards) expect(c.endFrame).toBeLessThanOrEqual(firstFrame + 1);
    const title = cards.find((c) => c.type === "title")!;
    const tagline = cards.find((c) => c.type === "tagline")!;
    expect(title.centerY!).toBeLessThan(1920 / 2);
    expect(tagline.centerY!).toBeGreaterThan(1920 / 2);
    // QA lists the title-card checks.
    const qa = readFileSync(v.manifestFile.replace(/\.manifest\.json$/, ".qa.txt"), "utf8");
    expect(qa).toContain("Title cards clear of the first lyric");
    expect(qa).toContain("Title characters");
    // The cover: the same cards, no lyrics, no audio.
    expect(covers).toHaveLength(1);
    expect(covers[0]).toMatchObject({ lyrics: 0, audio: null, cards: ["title", "byline", "tagline"] });
    expect(path.basename(covers[0].outFile)).toBe("cover.jpg");
    expect(existsSync(covers[0].outFile)).toBe(true);
  }, 300_000);

  it("off (the library default): no title cards on the Reel, the cover still has them", async () => {
    writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:16", variations: { reels: 1 }, tagline: "A song for the road" });
    const covers: string[][] = [];
    const r = await makeVideos({
      workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, renderer, platform: "win32",
      coverRenderer: async (o) => (covers.push((o.props.textCards ?? []).map((c) => c.type)), writeFileSync(o.outFile, "jpg"), o.outFile),
    });
    const m = readManifest(r.platforms[0].variations[0].manifestFile);
    expect(m.props.textCards ?? []).toEqual([]);
    expect(covers).toEqual([["title", "byline", "tagline"]]);
  }, 300_000);
});
