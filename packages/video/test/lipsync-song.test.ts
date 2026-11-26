// Nextgen step 2 (26 Nov 2026): a song's clips checked for lip sync (cached by content), the slots of its videos,
// Accept / Ignore / Split saved and read again, the performance excerpt, and the video unchanged by all of it.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, makeVideos, readClipEdits, readRecipe, songPathsById, writeRecipe, type RenderOptions } from "../src/node";
import { stubFace } from "../src/node/characters/stub";
import { acceptSlot, checkLipsync, exportExcerpt, ignoreSuggestion, readChecks, safePart, singingView, splitAfterLine } from "../src/node/lipsync";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-lipsync-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id: string;
const props: string[] = [];

const make = async () => {
  const p = songPathsById(ws, id);
  const sample = path.join(root, "s.mp4");
  const still = path.join(root, "s.jpg");
  if (!existsSync(sample)) {
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=1", "-pix_fmt", "yuv420p", sample);
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", still);
  }
  await makeVideos({
    workspaceDir: wsDir, song: p.audio!, lyrics: p.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, platform: "win32",
    renderer: async (o: RenderOptions) => (props.push(JSON.stringify(o.props)), copyFileSync(sample, o.outFile), o.outFile),
    thumbnailRenderer: async (o) => (copyFileSync(still, o.outFile), o.outFile),
  });
};

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  const song = path.join(root, "Hold On To Me.wav");
  makeSong(song, 12);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const p = songPathsById(ws, id);
  writeFileSync(p.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(p.clips!, { recursive: true });
  for (const [n, c] of [["front.mp4", "blue"], ["profile.mp4", "red"], ["wide.mp4", "green"], ["turn.mp4", "yellow"]] as const) makeClip(path.join(p.clips!, n), 6, c);
  // A vocal stem (the singing clips' guide): its own sound, so the excerpt can be told apart from the mix.
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=12", path.join(p.root, "vocals.wav")]);
  writeRecipe(p.recipe!, { ...readRecipe(p.recipe!), platforms: ["reels"], section: "0:00-0:12", variations: { reels: 1 } });
  await make(); // the lyrics get timed (stored alignment), and the video before any check
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("a song ready for lip sync", () => {
  it("Check all: each clip judged and cached by its content (a changed clip is checked again)", async () => {
    const r = await checkLipsync(ws, id, stubFace());
    expect(Object.fromEntries(Object.entries(r).map(([n, c]) => [n, c.verdict]))).toEqual({ "front.mp4": "good", "profile.mp4": "bad", "turn.mp4": "risky", "wide.mp4": "bad" });
    expect(r["profile.mp4"].reasons).toContain("side profile");
    expect(r["turn.mp4"].window).toEqual({ from: 0, to: expect.closeTo(3, 0.25) });
    const root2 = songPathsById(ws, id).root;
    const before = readChecks(root2).clips["front.mp4"].at;
    await checkLipsync(ws, id, stubFace(), ["front.mp4"]);
    expect(readChecks(root2).clips["front.mp4"].at).toBe(before);
    await expect(checkLipsync(ws, id, stubFace(), ["nope.mp4"])).rejects.toThrow(/not a video of this song/);
  });

  it("the whole song's slots (1/3), matched: the ✅ clip first, the shortfall said", async () => {
    const v = await singingView(ws, id, "full");
    expect(v.timed).toBe(true);
    expect(v.meter.targetMs).toBe(4000); // 12 s song: 1/3
    expect(v.matches.length).toBeGreaterThan(0);
    // The chorus entry chooses first and gets the ✅ clip; the ⚠️ one goes to the next slot.
    const chorus = v.matches.find((m) => m.slot.kind === "chorus")!;
    expect(chorus.clip).toBe("front.mp4");
    expect(v.matches.filter((m) => m.clip).map((m) => m.clip)).toContain("turn.mp4");
    expect(v.meter.text).toMatch(/^Singing: \d+ s \/ 4 s/);
  });

  it("Accept is saved on the clip (clips.json) and read again; Ignore and Split too; the video is unchanged", async () => {
    let v = await singingView(ws, id, "full");
    const slot = v.matches[0].slot.key;
    await acceptSlot(ws, id, slot, "front.mp4", "full");
    expect(readClipEdits(songPathsById(ws, id).root).clips["front.mp4"].lipsync).toMatchObject({ slot });
    v = await singingView(ws, id, "full");
    expect(v.matches.find((m) => m.slot.key === slot)).toMatchObject({ clip: "front.mp4", accepted: true });
    ignoreSuggestion(ws, id, slot, "turn.mp4");
    splitAfterLine(ws, id, 99);
    const decisions = JSON.parse(readFileSync(path.join(songPathsById(ws, id).root, ".studio", "singing.json"), "utf8"));
    expect(decisions).toEqual({ ignored: { [slot]: ["turn.mp4"] }, splits: [99] });
    // The same video with checks, an accepted slot and decisions.
    await make();
    expect(props.at(-1)).toBe(props[0]);
  }, 300_000);

  it("Export performance excerpt: vocal and mix with 1 s handles, slot.txt / slot.json with the times and the vocal source", async () => {
    const v = await singingView(ws, id, "full");
    const m = v.matches.find((x) => x.accepted)!;
    const r = await exportExcerpt(ws, id, m.slot.key, "full");
    expect(path.basename(r.folder)).toMatch(/^Hold On To Me · .+ · line \d+ /);
    expect(r.files).toEqual(["vocal.wav", "mix.wav", "slot.txt", "slot.json"]);
    const info = JSON.parse(readFileSync(path.join(r.folder, "slot.json"), "utf8"));
    expect(info.excerpt.fromMs).toBe(Math.max(0, m.slot.fromMs - 1000));
    expect(info.excerpt.toMs).toBe(m.slot.toMs + 1000);
    expect(info.vocal).toMatchObject({ source: "own", file: "vocals.wav" });
    expect(info.alignTo).toBe("excerpt.fromMs");
    const dur = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(r.folder, f)], { encoding: "utf8" }).trim());
    expect(dur("mix.wav")).toBeCloseTo(info.excerpt.durationMs / 1000, 1);
    expect(dur("vocal.wav")).toBeCloseTo(info.excerpt.durationMs / 1000, 1);
    expect(readFileSync(path.join(r.folder, "slot.txt"), "utf8")).toMatch(/Vocal: your vocal file \(vocals\.wav\)/);
    await expect(exportExcerpt(ws, id, "L99-99", "full")).rejects.toThrow(/Accept a clip/);
  });

  it("folder names are Windows-safe and short", () => {
    expect(safePart('Love: "you" <me>/ |again?*  ', 40)).toBe("Love you me again");
    expect(safePart("A thousand little moments everywhere around us tonight", 20).length).toBeLessThanOrEqual(20);
    expect(safePart("...", 10)).toBe("untitled");
  });
});
