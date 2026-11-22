// Film looks (22 Nov 2026): one camera, grain and grade for every clip of a song. The store (film-looks\<name>\),
// a song's pick (song.json "filmLook"), the line in every Animate and singing prompt (kept on the take as sent),
// and "write it from the still" (Gemini on the user's key).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, resolveWorkspaceDir, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addPictures, motionPrompt, readPictures, runTakes, startAnimate, type Transport } from "../src/node/animate";
import { chooseFilmLook, createFilmLook, filmLookFor, filmLookFolder, filmLooksPage, filmLookUsers, listFilmLooks, readFilmLook, removedFilmLooks, removeFilmLook, restoreFilmLook, saveFilmLook, setFilmLookStill } from "../src/node/film-looks";
import { LOOK_WRITER_PROMPT, parseWritten, writeLookFromStill, writerReady } from "../src/node/film-look-writer";
import { findOrCreateSongProject, readRecipe, songPathsById } from "../src/node";
import { SINGING_CUE, singingPrompt } from "../src/node/singer";
import { ffmpeg, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-filmlook-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
const STUB = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;
let ws: Workspace;
const ids: string[] = [];
const LINE = "35mm film grain, ARRI Alexa 35 look, warm tungsten light, soft shallow depth of field";

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  for (const [i, name] of ["Wedding Day", "Night Drive"].entries()) {
    const file = path.join(root, `${name}.wav`);
    makeSong(file, 4 + i);
    ids.push((await findOrCreateSongProject(ws, file)).project.id);
  }
  ffmpeg("-f", "lavfi", "-i", "color=c=orange:s=96x160", "-frames:v", "1", path.join(root, "still.png"));
});
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("the prompts", () => {
  it("Animate: the look line after the app's own words, before the mood; none without a look", () => {
    expect(motionPrompt()).not.toMatch(/Film look/);
    expect(motionPrompt("quiet", `${LINE}.`)).toMatch(new RegExp(`exactly as in the picture.*Film look, the same in every shot: ${LINE}\\. Mood: quiet\\.$`));
  });
  it("singing: the cue, the script, then the look", () => {
    expect(singingPrompt("")).toBe(SINGING_CUE);
    expect(singingPrompt("turns to the sea", LINE)).toBe(`${SINGING_CUE}. turns to the sea. Film look, the same in every shot: ${LINE}`);
    expect(singingPrompt("", LINE)).toBe(`${SINGING_CUE}. Film look, the same in every shot: ${LINE}`);
  });
});

describe("the store", () => {
  it("a new look needs a name, and names are unique", () => {
    expect(() => createFilmLook(wsDir, { name: "  " })).toThrow(/name first/);
    createFilmLook(wsDir, { name: "Warm wedding film", line: LINE });
    expect(() => createFilmLook(wsDir, { name: "Warm wedding film" })).toThrow(/already a Film look/);
    expect(readFilmLook(wsDir, "Warm wedding film")?.line).toBe(LINE);
  });
  it("keeps the still in the folder; a new still moves the old one aside", () => {
    const png = readFileSync(path.join(root, "still.png"));
    expect(() => setFilmLookStill(wsDir, "Warm wedding film", png, "x.gif")).toThrow(/JPG, PNG or WebP/);
    setFilmLookStill(wsDir, "Warm wedding film", png, "shotdeck.png");
    setFilmLookStill(wsDir, "Warm wedding film", png, "frame.jpeg");
    const dir = filmLookFolder(wsDir, "Warm wedding film");
    expect(readFilmLook(wsDir, "Warm wedding film")?.still).toBe("still.jpg");
    expect(existsSync(path.join(dir, "still.jpg"))).toBe(true);
    expect(existsSync(path.join(dir, "still.png"))).toBe(false);
    expect(existsSync(path.join(dir, ".replaced"))).toBe(true);
    expect(filmLooksPage(ws, { ready: true, how: "" }).looks[0].stillUrl).toBe("film-looks/Warm wedding film/still.jpg");
  });
  it("a song picks a look; its takes get the line, a look without words gives none", () => {
    expect(filmLookFor(ws, ids[0])).toBeNull();
    chooseFilmLook(ws, ids[0], "Warm wedding film");
    expect(readRecipe(songPathsById(ws, ids[0]).recipe).filmLook).toBe("Warm wedding film");
    expect(filmLookFor(ws, ids[0])).toEqual({ name: "Warm wedding film", line: LINE });
    expect(() => chooseFilmLook(ws, ids[1], "Nope")).toThrow(/No Film look "Nope"/);
    createFilmLook(wsDir, { name: "Empty" });
    chooseFilmLook(ws, ids[1], "Empty");
    expect(filmLookFor(ws, ids[1])).toBeNull();
    chooseFilmLook(ws, ids[1], null);
    expect(readRecipe(songPathsById(ws, ids[1]).recipe).filmLook).toBeUndefined();
  });
  it("Save as new leaves the songs on the old look; a rename takes every song along", () => {
    const copy = saveFilmLook(ws, "Warm wedding film", { line: "cool blue grade", scope: "new" });
    expect(copy.name).toBe("Warm wedding film copy");
    expect(existsSync(path.join(filmLookFolder(wsDir, copy.name), "still.jpg"))).toBe(true);
    expect(readFilmLook(wsDir, "Warm wedding film")?.line).toBe(LINE);
    expect(filmLookUsers(ws, copy.name)).toEqual([]);
    saveFilmLook(ws, "Warm wedding film", { name: "Golden hour film", scope: "all" });
    expect(readFilmLook(wsDir, "Warm wedding film")).toBeNull();
    expect(readRecipe(songPathsById(ws, ids[0]).recipe).filmLook).toBe("Golden hour film");
    expect(() => saveFilmLook(ws, "Golden hour film", { name: "Empty" })).toThrow(/already a Film look/);
  });
  it("Delete is refused while a song uses it; otherwise it moves to _removed with Restore", () => {
    expect(() => removeFilmLook(ws, "Golden hour film")).toThrow(/1 song uses "Golden hour film" \(Wedding Day\)/);
    const label = removeFilmLook(ws, "Empty");
    expect(listFilmLooks(ws).map((l) => l.name)).toEqual(["Golden hour film", "Warm wedding film copy"]);
    expect(removedFilmLooks(wsDir).map((r) => r.folder)).toEqual([label]);
    createFilmLook(wsDir, { name: "Empty" });
    expect(restoreFilmLook(wsDir, label)).toBe("Empty 2");
    expect(readFilmLook(wsDir, "Empty 2")?.name).toBe("Empty 2");
  });
});

describe("takes", () => {
  it("an Animate take is sent with the song's look and keeps the line it was sent with", async () => {
    await addPictures(ws, ids[0], [{ file: path.join(root, "still.png"), name: "bride.png" }]);
    const { takes } = startAnimate(ws, ids[0], "bride.png", { service: "wavespeed", takes: 1 }, STUB);
    expect(takes[0]).toMatchObject({ filmLook: "Golden hour film", look: LINE });
    saveFilmLook(ws, "Golden hour film", { line: "black and white, high contrast" }); // a later change: the take keeps its line
    const prompts: string[] = [];
    const out = path.join(root, "take.mp4");
    ffmpeg("-f", "lavfi", "-i", "color=c=red:s=96x160:d=1", "-r", "30", "-pix_fmt", "yuv420p", out);
    const transport: Transport = {
      upload: async () => "https://cdn/p.png",
      submit: async (_u, prompt) => (prompts.push(prompt), { id: "r1" }),
      poll: async () => ({ status: "done", url: "x" }),
      download: async (_url, file) => writeFileSync(file, readFileSync(out)),
    };
    await runTakes(() => openWorkspace(resolveWorkspaceDir()), ids[0], "bride.png", [takes[0].n], { transport, sleep: async () => undefined });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(`Film look, the same in every shot: ${LINE}.`);
    const dir = songPathsById(ws, ids[0]).root;
    expect(readPictures(path.join(dir, "pictures")).pictures["bride.png"].takes[0]).toMatchObject({ status: "done", look: LINE });
  });
});

describe("write it from the still", () => {
  it("reads the JSON from the answer, in fences or not; nothing usable is said plainly", () => {
    expect(parseWritten('```json\n{"line": "warm grade.", "midjourney": "warm --style raw"}\n```')).toEqual({ line: "warm grade", midjourney: "warm --style raw" });
    expect(() => parseWritten("I cannot")).toThrow(/no look/);
    expect(() => parseWritten('{"line": ""}')).toThrow(/no look line/);
  });
  it("Gemini on the user's key: the still inline, JSON asked; without a key, what to add", async () => {
    expect(writerReady({}).ready).toBe(false);
    expect(writerReady({ GEMINI_API_KEY: "k" }).how).toMatch(/Gemini/);
    await expect(writeLookFromStill(path.join(root, "still.png"), {})).rejects.toThrow(/GEMINI_API_KEY/);
    let sent: { url: string; init?: RequestInit } | null = null;
    const f = (async (url: string, init?: RequestInit) => {
      sent = { url, init };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ line: LINE, midjourney: "35mm --style raw" }) }] } }] });
    }) as typeof fetch;
    const w = await writeLookFromStill(path.join(root, "still.png"), { GEMINI_API_KEY: "KEY" }, f);
    expect(w).toMatchObject({ line: LINE, midjourney: "35mm --style raw" });
    expect(sent!.url).toMatch(/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
    expect((sent!.init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY");
    const body = JSON.parse(String(sent!.init?.body));
    expect(body.contents[0].parts[0].text).toBe(LOOK_WRITER_PROMPT);
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });
});

