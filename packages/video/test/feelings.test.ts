// Feeling per section (25 Nov 2026, realism plan step 3): one word per section, saved on song.json "sections"; the app
// turns it into small changes of the face, sent with Animate (a picture on a shot of that section) and singing clips
// (their lines' section, changing over a take that runs into another section). Loose pictures and old takes: unchanged.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanFeeling, feelingOfLines, feelingWords } from "../src/feelings";
import { cleanSections, nameSections } from "../src/sections";
import { findOrCreateSongProject, songPathsById } from "../src/node";
import { addPictures, motionPrompt, picturesView, readPictures, setPictureFeeling, startAnimate } from "../src/node/animate";
import { feelingForLines, feelingForSlot } from "../src/node/section-feelings";
import { setPictureShot } from "../src/node/shot-production";
import { importShotList } from "../src/node/shotlist";
import { singingPrompt, SINGING_CUE } from "../src/node/singer";
import { setSongSections, songSections } from "../src/node/song-sections";
import { takeFacts } from "../src/take-facts";
import { LYRICS, ffmpeg, makeSong } from "./media-helpers";

describe("feeling words", () => {
  it("a known feeling becomes face movements; an own word stays the user's word; none says nothing", () => {
    expect(feelingWords("longing")).toMatch(/^Feeling: longing, the eyes resting just past the camera/);
    expect(feelingWords("Wonder.")).toBe("Feeling: wonder, the feeling of wonder, shown only in small natural changes of the eyes, brows and breath");
    expect(feelingWords()).toBe("");
    expect(feelingWords("  ")).toBe("");
    expect(cleanFeeling("  Quiet   ache ")).toBe("quiet ache");
    expect(cleanFeeling(3)).toBeUndefined();
  });

  it("two different feelings make a slow two-stage change; the same twice is one", () => {
    expect(feelingWords("longing", "hope")).toMatch(/^Feeling: it starts longing \(.+\), then in the second half slowly turns to hope \(.+\), with no sudden change$/);
    expect(feelingWords("hope", "hope")).toBe(feelingWords("hope"));
  });

  it("sections keep their feeling; a line takes its section's; a run into another section turns", () => {
    const list = cleanSections([{ line: 1, kind: "verse", feeling: "Longing" }, { line: 4, kind: "chorus", feeling: "hope" }, { line: 6, kind: "outro" }, { line: 2, kind: "x", feeling: "joy" }], 6);
    expect(list).toEqual([{ line: 1, kind: "verse", feeling: "longing" }, { line: 4, kind: "chorus", feeling: "hope" }, { line: 6, kind: "outro" }]);
    const named = nameSections(list, 6);
    expect(feelingOfLines(named, 2)).toEqual({ feeling: "longing" });
    expect(feelingOfLines(named, 3, 5)).toEqual({ feeling: "longing", feelingTo: "hope" });
    expect(feelingOfLines(named, 4, 5)).toEqual({ feeling: "hope" });
    expect(feelingOfLines(named, 6)).toEqual({});
    expect(feelingOfLines(named, null)).toEqual({});
  });
});

describe("the prompts", () => {
  it("Animate: the feeling follows the realism rules; without one the prompt is as before", () => {
    expect(motionPrompt(undefined, undefined, "natural", "joy")).toMatch(/Feeling: joy, an open smile/);
    expect(motionPrompt(undefined, undefined, "natural")).toBe(motionPrompt(undefined, undefined, "natural", undefined));
    expect(motionPrompt()).not.toMatch(/Feeling/);
  });

  it("singing: the feeling comes after the cue and realism, before Paul's script", () => {
    const p = singingPrompt("she smiles at the end", undefined, "natural", "longing", "hope");
    expect(p.startsWith(SINGING_CUE)).toBe(true);
    expect(p.indexOf("Feeling: it starts longing")).toBeLessThan(p.indexOf("she smiles at the end"));
    expect(singingPrompt("x", undefined, "natural")).not.toMatch(/Feeling/);
  });

  it("the take's facts show it", () => {
    const base = { status: "done", started_at: "2026-11-25T10:00:00Z", request_id: "r", cost_usd: 0.54, seconds: 5 };
    expect(takeFacts({ ...base, feeling: "longing", feelingTo: "hope" }, "en-GB")).toMatch(/^5 s · longing → hope · about \$0\.54/);
    expect(takeFacts({ ...base, feeling: "calm" }, "en-GB")).toMatch(/^5 s · calm · about/);
    expect(takeFacts(base, "en-GB")).toMatch(/^5 s · about/);
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-feelings-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;
let id = "";

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "Feeling Song.wav");
  makeSong(song, 4);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  writeFileSync(songPathsById(ws, id).lyricsTxt, `${LYRICS.join("\n")}\n`);
  await importShotList(ws, id, { slots: [
    { id: "s01", order: 1, shows: "Her face at the window", characters: [], scene: null, shot: "close-up", line: 2 },
    { id: "s02", order: 2, shows: "Rain on the glass", characters: [], scene: null, shot: "detail" },
    { id: "s03", order: 3, shows: "She turns to the light", characters: [], scene: null, shot: "medium", line: 5 },
  ] }, "shots.json");
  for (const [n, c] of [["window.png", "orange"], ["rain.png", "blue"], ["turn.png", "green"], ["loose.png", "white"]]) ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=96x160`, "-frames:v", "1", path.join(root, n)); // different pictures (the same one twice is added once)
  await addPictures(ws, id, ["window.png", "rain.png", "turn.png", "loose.png"].map((n) => ({ file: path.join(root, n), name: n })));
  setPictureShot(ws, id, "window.png", "s01");
  setPictureShot(ws, id, "rain.png", "s02");
  setPictureShot(ws, id, "turn.png", "s03");
}, 120_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("a song with feelings", () => {
  it("saves the feeling in song.json with the sections; back to the suggestion forgets it", () => {
    const view = setSongSections(ws, id, [{ line: 1, kind: "verse", feeling: "longing" }, { line: 4, kind: "chorus", feeling: "my own hope" }]);
    expect(view.sections.map((s) => [s.name, s.feeling])).toEqual([["Verse", "longing"], ["Chorus", "my own hope"]]);
    expect(JSON.parse(readFileSync(songPathsById(ws, id).recipe!, "utf8")).sections[1]).toEqual({ line: 4, kind: "chorus", feeling: "my own hope" });
    expect(songSections(ws, id).sections[0].feeling).toBe("longing");
  });

  it("a shot gets its line's section; a shot without a line the one before it; a loose picture none", () => {
    expect(feelingForSlot(ws, id, "s01")).toEqual({ feeling: "longing" });
    expect(feelingForSlot(ws, id, "s02")).toEqual({ feeling: "longing" });
    expect(feelingForSlot(ws, id, "s03")).toEqual({ feeling: "my own hope" });
    expect(feelingForSlot(ws, id, undefined)).toEqual({});
    expect(feelingForSlot(ws, id, "nope")).toEqual({});
    expect(feelingForLines(ws, id, 3, 4)).toEqual({ feeling: "longing", feelingTo: "my own hope" });
  });

  it("Animate records the feeling on its takes (loose pictures: none)", () => {
    const env = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;
    const o = { service: "wavespeed" as const, quality: "draft" as const, takes: 1, seconds: 5 };
    expect(startAnimate(ws, id, "turn.png", o, env).takes[0]).toMatchObject({ feeling: "my own hope" });
    expect(startAnimate(ws, id, "loose.png", o, env).takes[0].feeling).toBeUndefined();
    const dir = path.join(songPathsById(ws, id).root, "pictures");
    expect(readPictures(dir).pictures["turn.png"].takes[0].feeling).toBe("my own hope");
  });

  it("a picture's own feeling wins over its section's, also on a loose picture; empty goes back to the section's", async () => {
    const env = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;
    const o = { service: "wavespeed" as const, quality: "draft" as const, takes: 1, seconds: 5 };
    expect(setPictureFeeling(ws, id, "loose.png", "Joy")).toBe("joy");
    expect(setPictureFeeling(ws, id, "turn.png", "grief")).toBe("grief");
    expect(startAnimate(ws, id, "loose.png", o, env).takes[0]).toMatchObject({ feeling: "joy" });
    expect(startAnimate(ws, id, "turn.png", o, env).takes[0]).toMatchObject({ feeling: "grief" });
    const view = await picturesView(ws, id, env);
    expect(view.pictures.find((p) => p.file === "turn.png")).toMatchObject({ feeling: "grief", sectionFeeling: "my own hope" });
    expect(setPictureFeeling(ws, id, "turn.png", "")).toBe("");
    expect(startAnimate(ws, id, "turn.png", o, env).takes[0]).toMatchObject({ feeling: "my own hope" });
    expect(() => setPictureFeeling(ws, id, "nope.png", "joy")).toThrow(/No picture/);
  });
});
