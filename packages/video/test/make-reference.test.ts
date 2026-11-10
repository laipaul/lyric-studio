// The 2e-1 reference (asked by the user on 10 Nov 2026, in place of the golden manifest): three songs planned and "made"
// with a stand-in renderer that only records what it was given. Captured once on the code BEFORE 2e-1 (REF_WRITE=1:
// test/reference/2e1/*.json, committed); after 2e-1 (Make compiles every video from its shot plan, storyboards\*.json)
// the same songs must give the same cuts (shot starts, lengths, clips, trims, speeds, transitions) and the same lyric
// timing, frame for frame; any other difference in the props is listed.
//   capture:  REF_WRITE=1 npx vitest run test/make-reference.test.ts
//   compare:  npx vitest run test/make-reference.test.ts
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, loadFontCatalog, makeVideos, readRecipe, setThemeLook, songPathsById, writeClipEdits, readClipEdits, writeRecipe, type RenderOptions } from "../src/node";
import { fakeAlign, ffmpeg, makeClip, makeSong } from "./media-helpers";

const REF_DIR = path.join(__dirname, "reference", "2e1");
const WRITE = process.env.REF_WRITE === "1";
const root = mkdtempSync(path.join(os.tmpdir(), "lyric-ref-"));
const wsDir = path.join(root, "workspace");
const sample = path.join(root, "s.mp4");
const still = path.join(root, "s.jpg");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;

type Song = {
  key: string;
  title: string;
  seconds: number;
  lyrics: string[];
  vertical: string[]; // clip colours (9:16 sources)
  horizontal: string[]; // 16:9 sources (YouTube's clips layout)
  photo?: boolean;
  cover?: boolean;
  recipe: Record<string, unknown>;
  theme?: Record<string, unknown>;
  edits?: boolean; // a moved cut and a slip (clips.json), imported as locks
  platforms: string;
};
const LINES = ["Verse one here", "* Hold on to me", "Through the night", "Verse two here", "* Hold on to me", "Into the light", "Carry me home", "* Hold on to me"];
const SONGS: Song[] = [
  {
    key: "one", title: "Ref One", seconds: 20, lyrics: LINES.slice(0, 6), vertical: ["blue", "yellow", "red", "green"], horizontal: ["purple", "orange"],
    recipe: { platforms: ["reels", "youtube"], variations: { reels: 2, youtube: 1 }, section: "0:00-0:16", titleOpening: "on", tagline: "A song for the road", youtubeLayout: "clips" },
    theme: { endCard: "on", hookCard: "on" }, platforms: "reels,youtube",
  },
  {
    key: "two", title: "Ref Two", seconds: 24, lyrics: LINES, vertical: ["blue", "yellow", "red", "green", "white"], horizontal: [], photo: true, cover: true,
    recipe: { platforms: ["reels", "tiktok", "youtube"], variations: { reels: 1, tiktok: 1, youtube: 1 }, ending: "fade", youtubeLayout: "cover" },
    edits: true, platforms: "reels,tiktok,youtube",
  },
  {
    key: "three", title: "Ref Three", seconds: 16, lyrics: LINES.slice(0, 5), vertical: ["cyan", "magenta", "gray"], horizontal: ["navy", "olive"],
    recipe: { platforms: ["shorts", "youtube"], variations: { shorts: 1, youtube: 1 }, shotLength: "story", transitions: "flowing", youtubeLayout: "clips" },
    theme: { lineShape: "stacked", textLayout: "bighook" }, platforms: "shorts,youtube",
  },
];

// What Make handed the renderer, made comparable: no temp folders, no ids that differ between runs.
export type Recorded = { video: string; props: unknown };
const normal = (v: unknown, songRoot: string, id: string): unknown =>
  JSON.parse(
    JSON.stringify(v)
      .split(root.split(path.sep).join("/")).join("<root>")
      .split(root).join("<root>")
      .split(songRoot).join("<song>")
      .split(id).join("<id>"),
  );
type Props = { durationInFrames: number; shots: { start: number; duration: number; src?: string; startFrom?: number; playbackRate?: number; dissolve?: unknown; kind?: string }[]; cutFrames?: number[]; lyrics: { text: string; startFrame: number; endFrame: number; isHook?: boolean; enterFrame?: number; stampFrame?: number; sungEndFrame?: number }[]; audio?: unknown };
// The cuts and the lyric timing, the two things 2e-1 must keep exactly.
export const cutsAndTiming = (p: Props) => ({
  durationInFrames: p.durationInFrames,
  audio: p.audio ?? null,
  shots: p.shots.map((s) => ({ start: s.start, duration: s.duration, src: s.src ?? null, startFrom: s.startFrom ?? null, playbackRate: s.playbackRate ?? null, dissolve: s.dissolve ?? null, kind: s.kind ?? null })),
  cutFrames: p.cutFrames ?? null,
  lyrics: p.lyrics.map((l) => ({ text: l.text, startFrame: l.startFrame, endFrame: l.endFrame, enterFrame: l.enterFrame ?? null, stampFrame: l.stampFrame ?? null, sungEndFrame: l.sungEndFrame ?? null, isHook: !!l.isHook })),
});

async function makeSongOf(s: Song): Promise<Recorded[]> {
  const file = path.join(root, `${s.title}.wav`);
  makeSong(file, s.seconds);
  const id = (await findOrCreateSongProject(ws, file)).project.id;
  const paths = songPathsById(ws, id);
  writeFileSync(paths.lyricsTxt, `${s.lyrics.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  s.vertical.forEach((c, i) => makeClip(path.join(paths.clips!, `0${i + 1}_${c}.mp4`), 6 + i, c));
  s.horizontal.forEach((c, i) => makeClip(path.join(paths.clips!, `h${i + 1}_${c}.mp4`), 7 + i, c, "384x216"));
  if (s.photo) ffmpeg("-f", "lavfi", "-i", "color=c=0xd0b080:s=432x768:d=1", "-frames:v", "1", path.join(paths.clips!, "09_photo.jpg"));
  if (s.cover) ffmpeg("-f", "lavfi", "-i", "color=c=0x553344:s=600x600:d=1", "-frames:v", "1", path.join(paths.root, "cover.jpg"));
  writeRecipe(paths.recipe!, { ...readRecipe(paths.recipe!), ...s.recipe });
  if (s.theme) setThemeLook(ws, { projectId: id, scope: "song", catalog: loadFontCatalog(wsDir), values: s.theme });
  const records: Recorded[] = [];
  const renderer = async (o: RenderOptions) => {
    const rel = path.relative(paths.exports, o.outFile).split(path.sep).slice(1).join("/"); // reels/v1.mp4
    records.push({ video: rel.replace(/\.mp4$/, ""), props: normal(o.props, paths.root, id) });
    copyFileSync(sample, o.outFile);
    return o.outFile;
  };
  const make = () => makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: s.platforms, align: fakeAlign, frameCheck: false, renderer, thumbnailRenderer: async (o) => (copyFileSync(still, o.outFile), o.outFile), platform: "win32", now: new Date("2026-11-10T09:00:00Z") });
  await make();
  if (s.edits) {
    // A moved cut and a slip on the second shot of the Reel, then made again: the reference holds the edited videos.
    const reel = records.find((r) => r.video === "reels/v1")!.props as Props;
    const second = reel.shots[1];
    const startMs = (frames: number) => Math.round((frames * 1000) / 30);
    const sectionStart = ((reel.audio as { startFrame?: number } | null)?.startFrame ?? 0);
    const at = (startMs(second.start + sectionStart)) / 1000;
    writeClipEdits(paths.root, { ...readClipEdits(paths.root), cuts: [{ from: at, to: at + 0.3 }], slips: [{ at: at + 0.3, clip: path.basename(String(second.src ?? "")).replace(/\.[^.]+$/, ".mp4"), in: 0.5 }] });
    records.length = 0;
    await make();
  }
  return records.sort((a, b) => a.video.localeCompare(b.video));
}

const made = new Map<string, Recorded[]>();
beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", still);
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  for (const s of SONGS) made.set(s.key, await makeSongOf(s));
}, 900_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("2e-1 reference: cuts and lyric timing of Make's videos", () => {
  for (const s of SONGS) {
    it(`${s.title}: ${s.platforms}`, () => {
      const now = made.get(s.key)!;
      const file = path.join(REF_DIR, `${s.key}.json`);
      if (WRITE) {
        mkdirSync(REF_DIR, { recursive: true });
        writeFileSync(file, `${JSON.stringify({ song: s.title, platforms: s.platforms, captured: "before 2e-1 (Make planned at render time)", videos: now }, null, 1)}\n`);
      }
      expect(existsSync(file)).toBe(true);
      const before = (JSON.parse(readFileSync(file, "utf8")) as { videos: Recorded[] }).videos;
      expect(now.map((r) => r.video)).toEqual(before.map((r) => r.video));
      for (const [k, b] of before.entries()) {
        // The cuts and the lyric timing: identical, frame for frame.
        expect(cutsAndTiming(now[k].props as Props), `${s.title} ${b.video}: cuts and lyric timing`).toEqual(cutsAndTiming(b.props as Props));
        // Everything else Make hands the renderer: the same too.
        expect(now[k].props, `${s.title} ${b.video}: the whole props`).toEqual(b.props);
      }
    });
  }
});
