// Instrumental songs in "+ New song" and pnpm make: song.json "instrumental", story.txt instead of
// lyrics.txt (optional), never aligned; the story timed on the music, a new shot at each sentence, no
// .lrc for lyric services; without a story: no words, no captions.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkNewSong, createSong, makeVideos, readManifest, readRecipe, songPathsById, type RenderOptions } from "../src/node";
import { ffmpeg, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-instrumental-"));
const wsDir = path.join(root, "workspace");
const inDir = path.join(root, "in");
const sample = path.join(root, "s.mp4");
const previousWorkspace = process.env.WORKSPACE_DIR;
const renderer = async (o: RenderOptions) => (copyFileSync(sample, o.outFile), o.outFile);
const noAlign = async () => {
  throw new Error("an instrumental is never aligned");
};
let ws: Workspace;

beforeAll(() => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(inDir, { recursive: true });
  makeSong(path.join(inDir, "Tea With The Monk.wav"), 60);
  makeSong(path.join(inDir, "Mountain Air.wav"), 50);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  writeFileSync(path.join(inDir, "story.txt"), "There's a secret place\nMy path always leads me there\n\nTea with the mountain monk\n");
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

const clipsFor = (id: string) => {
  const paths = songPathsById(ws, id);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [i, name] of ["01_a.mp4", "02_b.mp4", "03_c.mp4", "04_d.mp4"].entries()) makeClip(path.join(paths.clips!, name), 8, ["blue", "yellow", "red", "green"][i]);
  return paths;
};

describe("+ New song: Instrumental", () => {
  it("lyrics are optional; a story must be a .txt", () => {
    const song = path.join(inDir, "Tea With The Monk.wav");
    expect(checkNewSong({ song, lyrics: "" })).toContain("Choose the lyrics (lyrics.txt), or tick Instrumental.");
    expect(checkNewSong({ song, lyrics: "", instrumental: true })).toEqual([]);
    expect(checkNewSong({ song, lyrics: song, instrumental: true })[0]).toMatch(/The story must be a \.txt file/);
  });

  it("with a story: song.json instrumental, the story in story.txt; the Reel shows it, never aligned", async () => {
    const r = await createSong(ws, { song: path.join(inDir, "Tea With The Monk.wav"), lyrics: path.join(inDir, "story.txt"), instrumental: true });
    const paths = clipsFor(r.id);
    expect(paths.instrumental).toBe(true);
    expect(readRecipe(paths.recipe).instrumental).toBe(true);
    expect(path.basename(paths.lyricsTxt)).toBe("story.txt");
    expect(readFileSync(paths.lyricsTxt, "utf8")).toContain("Tea with the mountain monk");
    expect(existsSync(path.join(paths.root, "lyrics.txt"))).toBe(false);

    const logs: string[] = [];
    const made = await makeVideos({
      workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", variations: 1, align: noAlign, frameCheck: false, renderer, platform: "win32",
      log: (m) => logs.push(m),
    });
    expect(logs.some((m) => m.startsWith("story: 3 sentence(s) of story.txt timed on the music"))).toBe(true);
    expect(logs.some((m) => /reels: an instrumental: the section starts at/.test(m))).toBe(true);
    const v = made.platforms[0].variations[0];
    const m = readManifest(v.manifestFile);
    // The sentences inside the section, as lyric lines (no hooks); a new shot where each appears.
    const shown = m.props.lyrics.map((l) => l.text);
    expect(shown.length).toBeGreaterThan(0);
    for (const t of shown) expect(["There's a secret place", "My path always leads me there", "Tea with the mountain monk"]).toContain(t);
    const cutFrames = m.props.shots.map((s) => s.start);
    expect((m.settings.pace as { text: string }).text).toMatch(/^Pacing: an instrumental, paced as a calm piece/);
    for (const l of m.props.lyrics) {
      const appears = l.startFrame;
      if (appears > 30) expect(cutFrames.some((f) => Math.abs(f - appears) <= 3)).toBe(true);
    }
    // Captions with the story; no .lrc for lyric services.
    const dir = path.dirname(v.file);
    expect(readFileSync(v.srtFile, "utf8")).toContain(shown[0]);
    expect(readdirSync(path.dirname(dir)).some((f) => f.endsWith(".lrc"))).toBe(false);
  }, 300_000);

  it("without a story: an empty story.txt, no words on screen and no captions", async () => {
    const r = await createSong(ws, { song: path.join(inDir, "Mountain Air.wav"), lyrics: "", instrumental: true, title: "Mountain Air" });
    const paths = clipsFor(r.id);
    expect(readFileSync(paths.lyricsTxt, "utf8")).toBe("");
    writeFileSync(paths.recipe!, JSON.stringify({ ...JSON.parse(readFileSync(paths.recipe!, "utf8")), titleOpening: "on" }));
    const made = await makeVideos({
      workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", variations: 1, align: noAlign, frameCheck: false, renderer, platform: "win32",
      coverRenderer: async (o) => (writeFileSync(o.outFile, "jpg"), o.outFile),
    });
    const v = made.platforms[0].variations[0];
    const m = readManifest(v.manifestFile);
    expect(m.props.lyrics).toEqual([]);
    expect(existsSync(v.srtFile)).toBe(false);
    // The title opening stays a few seconds (there is no first lyric line to make way for).
    const title = (m.props.textCards ?? []).find((c) => c.type === "title")!;
    expect(title.endFrame).toBeLessThanOrEqual(Math.round(4.5 * 30) + 1);
    expect(title.endFrame).toBeGreaterThan(60);
  }, 300_000);
});
