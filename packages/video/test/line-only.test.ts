// Singing takes and clips picked in Lyrics Sync are not story moments (22 Nov 2026): clips.json "lineOnly", Send to
// Storyboard from Lyrics Sync (forLine) vs from Creation, clips removed after sending, the Storyboard's roles and the planner.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { composeProps, getCutPoints, type RenderBase } from "../src";
import { findOrCreateSongProject, readClipEdits, songPathsById } from "../src/node";
import { picturesView, readPictures, runTakes, sendToStoryboard, startAnimate, update } from "../src/node/animate";
import { removeSongClip, songAssets } from "../src/node/assets";
import { checkClipEdits } from "../src/node/clip-edits";
import { saveAnchors } from "../src/node/lyrics-view";
import { setStoryOrder, songStory } from "../src/node/story-line";
import { ffmpeg, makeClip, makeSong } from "./media-helpers";
import { grid } from "./helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-line-only-"));
const wsDir = path.join(root, "workspace");
let ws: Workspace;
let id: string;
let clips: string;
let pics: string;
const previousWorkspace = process.env.WORKSPACE_DIR;
const STUB = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;
const open = () => openWorkspace(wsDir);
const now = async () => undefined;
const PIC = "bride.png";

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "Line Only.wav");
  makeSong(song, 4);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  clips = paths.clips!;
  mkdirSync(clips, { recursive: true });
  makeClip(path.join(clips, "01_a.mp4"), 1, "red");
  makeClip(path.join(clips, "02_b.mp4"), 1, "blue");
  makeClip(path.join(clips, "sings lines 2-3.mp4"), 1, "green");
  pics = path.join(paths.root, "pictures");
  mkdirSync(pics, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=96x160", "-frames:v", "1", path.join(pics, PIC));
  startAnimate(ws, id, PIC, { service: "wavespeed", takes: 2 }, STUB);
  await runTakes(open, id, PIC, [1, 2], { env: STUB, sleep: now });
});
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});
const edits = () => readClipEdits(songPathsById(ws, id).root);

describe("lineOnly in clips.json", () => {
  it("is checked: true or left out", () => {
    expect(checkClipEdits({ clips: { "a.mp4": { lineOnly: true } } }).edits.clips["a.mp4"]).toEqual({ lineOnly: true });
    expect(checkClipEdits({ clips: { "a.mp4": { lineOnly: "yes" } } }).problems[0]).toMatch(/lineOnly must be true/);
  });
});

describe("Send to Storyboard for a line, then from Creation", () => {
  it("forLine: the clip is copied, marked lineOnly and does not join the story order", async () => {
    const before = [...edits().order];
    const r = await sendToStoryboard(ws, id, PIC, 1, { forLine: true });
    expect(r).toEqual({ clip: "bride take 1.mp4", already: false });
    expect(existsSync(path.join(clips, r.clip))).toBe(true);
    expect(edits().clips[r.clip]?.lineOnly).toBe(true);
    expect(edits().order).toEqual(before);
    expect(edits().order).not.toContain(r.clip);
    // a second pick of the same take changes nothing
    expect(await sendToStoryboard(ws, id, PIC, 1, { forLine: true })).toEqual({ clip: r.clip, already: true });
    const a = await songAssets(ws, id);
    expect(a.clips.find((c) => c.name === r.clip)?.role).toBe("lineOnly");
    expect((await songStory(ws, id, a.clips)).items.map((i) => i.key)).not.toContain(r.clip);
  });
  it("a normal Send later makes it a story moment at the END of the order; nothing else moves", async () => {
    const paths = songPathsById(ws, id);
    saveAnchors(ws, id, [{ line: 1, clip: "bride take 1.mp4" }]);
    await sendToStoryboard(ws, id, PIC, 2); // a normal send of another take, so there is an end to compare with
    const order = edits().order;
    const before = order.filter((n) => n !== "bride take 1.mp4");
    const r = await sendToStoryboard(ws, id, PIC, 1);
    expect(r).toEqual({ clip: "bride take 1.mp4", already: false });
    expect(edits().clips["bride take 1.mp4"]?.lineOnly).toBeUndefined();
    const after = edits().order;
    expect(after.at(-1)).toBe("bride take 1.mp4");
    expect(after.filter((n) => n !== "bride take 1.mp4")).toEqual(before);
    expect(await sendToStoryboard(ws, id, PIC, 1)).toEqual({ clip: "bride take 1.mp4", already: true });
    expect(paths.clips).toBe(clips);
  });
});

describe("a sent clip that was removed counts as not sent", () => {
  it("picturesView shows it unsent and Send puts the same file back from _removed (no duplicate)", async () => {
    await removeSongClip(ws, id, "bride take 2.mp4");
    const v = await picturesView(ws, id, STUB);
    expect(v.pictures.find((p) => p.file === PIC)!.takes.map((t) => t.sent ?? null)).toEqual(["bride take 1.mp4", null]);
    const r = await sendToStoryboard(ws, id, PIC, 2);
    expect(r).toEqual({ clip: "bride take 2.mp4", already: false });
    expect(readdirSync(clips).filter((f) => f.startsWith("bride take 2"))).toEqual(["bride take 2.mp4"]);
    expect(readdirSync(path.join(clips, "_removed")).filter((f) => f.startsWith("bride take 2"))).toEqual([]);
    expect(readPictures(pics).pictures[PIC].takes.find((t) => t.n === 2)!.sent).toBe("bride take 2.mp4");
  });
  it("without a copy in _removed it is copied again", async () => {
    const f = path.join(clips, "bride take 2.mp4");
    const fs = await import("node:fs");
    fs.rmSync(f); // gone by hand
    const r = await sendToStoryboard(ws, id, PIC, 2);
    expect(r.already).toBe(false);
    expect(existsSync(path.join(clips, r.clip))).toBe(true);
  });
});

describe("the Storyboard's roles", () => {
  it("story / singing (anchor with sync, lipsync take) / lineOnly; saving the order keeps the hidden entries", async () => {
    const paths = songPathsById(ws, id);
    saveAnchors(ws, id, [{ line: 2, clip: "sings lines 2-3.mp4", sync: 1.5, through: 3 }]);
    update(pics, PIC, (p) => p.takes.push({ n: 9, kind: "lipsync", status: "done", sent: "02_b.mp4", line: 5 } as never)); // a lip-sync take's own clip
    await sendToStoryboard(ws, id, PIC, 1); // already a story moment
    const a = await songAssets(ws, id);
    const role = Object.fromEntries(a.clips.map((c) => [c.name, c.role]));
    expect(role["sings lines 2-3.mp4"]).toBe("singing");
    expect(role["02_b.mp4"]).toBe("singing");
    expect(role["01_a.mp4"]).toBe("story");
    expect(a.singing).toEqual([{ line: 2, through: 3 }]);
    const story = (await songStory(ws, id, a.clips)).items.map((i) => i.key);
    expect(story).not.toContain("sings lines 2-3.mp4");
    expect(story).not.toContain("02_b.mp4");
    // lineOnly clip hidden too
    await sendToStoryboard(ws, id, PIC, 2, { forLine: true }).catch(() => null);
    const hiddenBefore = edits().order.filter((n) => ["sings lines 2-3.mp4", "02_b.mp4"].includes(n));
    await setStoryOrder(ws, id, [...story].reverse());
    const order = edits().order;
    for (const n of hiddenBefore) expect(order).toContain(n);
    expect(order.filter((n) => story.includes(n))).toEqual([...story].reverse());
    expect(paths.clips).toBe(clips);
  });
});

describe("the planner", () => {
  it("never uses a lineOnly clip as gap fill, and still plays it on its line", () => {
    const plan = getCutPoints(grid(120, 40, 500), { start_ms: 500, end_ms: 16_500 }, { cutRate: "1x" });
    const mk = (name: string, over = {}) => ({ id: name, name, duration_ms: 10_000, path: `cache/${name}`, durationFrames: 300, ...over });
    const clipsIn = [mk("a"), mk("b"), mk("c"), mk("d"), mk("e"), mk("cover", { lineOnly: true })];
    const style = { name: "Simple", font: "Inter", weight: 600, textCase: "none" as const, effect: "none", animation: "fade" };
    const base: RenderBase = {
      plan, clips: clipsIn, audio: null, durationInFrames: plan.end_frame - plan.start_frame, lyrics: [{ text: "x", start_ms: 1_500, end_ms: 4_500, isHook: false }],
      styles: { simple: { style, textSize: 64, hookFont: null, fonts: [] }, bold: { style, textSize: 72, hookFont: null, fonts: [] } },
      colour: "#fff", cinematicBars: false, pins: [],
    };
    for (const seed of [1, 2, 3]) {
      const { props } = composeProps(base, { seed, style: "simple" });
      expect(props.shots.some((s) => s.src === "cache/cover")).toBe(false);
    }
    const pinned = composeProps({ ...base, pins: [{ clipId: "cover", clipName: "cover", lineNumber: 1, text: "x", startMs: 0, endMs: 1 } as never] }, { seed: 1, style: "simple" });
    expect(pinned.props.shots.length).toBeGreaterThan(0);
  });
});
