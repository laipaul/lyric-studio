// "Who is this" on a Creation picture (25 Nov 2026): Animate sends the picture and the character's face sheet (close-up,
// side profile, 3/4) to Seedance 2.5 reference-to-video; the clothes and place come from the picture. Nobody: as before.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, songPathsById } from "../src/node";
import { addPictures, readPictures, runTakes, setPictureFeeling, type Transport } from "../src/node/animate";
import { createCard } from "../src/node/characters/cards";
import { makePictures } from "../src/node/characters/generate";
import { stubFace, stubFal } from "../src/node/characters/stub";
import { characterChoices, faceKeepPrompt, setPictureWho, startPictureAnimate } from "../src/node/picture-character";
import { makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-who-"));
const wsDir = path.join(root, "workspace");
const pics = path.join(root, "pics");
const previous = process.env.WORKSPACE_DIR;
const ffmpeg = (...a: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...a]);
let ws: Workspace;
let id = "";
let jennifer = "";
const env = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(pics, { recursive: true });
  for (const [n, c] of [["default", "white"], ["closeup", "pink"], ["three_quarter", "orange"], ["body_front", "beige"], ["body_back", "gray"], ["profile", "purple"]] as const) ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=300x400`, "-frames:v", "1", path.join(pics, `${n}.png`));
  ws = openWorkspace(wsDir);
  const c = createCard(ws, { kind: "character", name: "Jennifer", picture: readFileSync(path.join(pics, "default.png")), fileName: "j.png" });
  jennifer = c.id;
  await makePictures(ws, c.id, { fal: stubFal(pics), face: stubFace(), sleep: async () => {} }, { cap: 3 });
  await makePictures(ws, c.id, { fal: stubFal(pics), face: stubFace(), sleep: async () => {} }, { cap: 3, only: ["profile"] });
  createCard(ws, { kind: "character", name: "No views yet", picture: readFileSync(path.join(pics, "default.png")), fileName: "n.png" });
  const song = path.join(root, "Wedding Day.wav");
  makeSong(song, 4);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  for (const [n, c] of [["mj bride.png", "orange"], ["mj chapel.png", "blue"]] as const) ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=96x160`, "-frames:v", "1", path.join(root, n));
  await addPictures(ws, id, ["mj bride.png", "mj chapel.png"].map((n) => ({ file: path.join(root, n), name: n })));
}, 120_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("who is this", () => {
  it("offers the characters with a close-up; a card without views is refused", () => {
    expect(characterChoices(ws)).toEqual([{ id: jennifer, name: "Jennifer" }]);
    expect(() => setPictureWho(ws, id, "mj bride.png", "nope")).toThrow(/no close-up yet/);
    expect(setPictureWho(ws, id, "mj bride.png", jennifer)).toEqual({ id: jennifer, name: "Jennifer" });
  });

  it("Animate sends the picture and her face sheet (close-up, side profile, 3/4) with the usual prompt", async () => {
    setPictureFeeling(ws, id, "mj bride.png", "tender");
    const started = startPictureAnimate(ws, id, "mj bride.png", { service: "wavespeed", quality: "draft", takes: 1, seconds: 5, capUsd: 10 }, env);
    expect(started.withFace).toBe("Jennifer");
    expect(started.estimate).toMatchObject({ usdPerTake: 1.62 });
    const t = started.takes[0];
    expect(t).toMatchObject({ kind: "references", aspect: "9:16", feeling: "tender", refNames: ["mj bride.png", "Jennifer · face sheet"] });
    expect(t.prompt).toMatch(/^@Image 1 is the picture to bring to life.*@Image 2 is Jennifer's face reference sheet \(left to right: close-up, side profile, 3\/4\)/);
    expect(t.prompt).toMatch(/never change the clothes/);
    expect(t.prompt).toMatch(/Feeling: tender/);
    expect(t.refFiles!.every((f) => existsSync(path.join(wsDir, f)))).toBe(true);

    const sent: { images: string[]; prompt: string }[] = [];
    const transport: Transport = { upload: async (f) => `https://cdn/${path.basename(f)}`, submit: async () => ({ id: "x" }), submitRefs: async (images, prompt) => (sent.push({ images, prompt }), { id: "r1" }), poll: async () => ({ status: "done", url: "u" }), download: async () => undefined };
    await runTakes(() => openWorkspace(wsDir), id, "mj bride.png", [t.n], { transport, sleep: async () => undefined });
    expect(sent).toHaveLength(1);
    expect(sent[0].images[0]).toBe("https://cdn/mj bride.png");
    expect(sent[0].prompt).toBe(t.prompt);
  });

  it("nobody: Animate as before; the prompt keeps the clothes", () => {
    const plain = startPictureAnimate(ws, id, "mj chapel.png", { service: "wavespeed", quality: "draft", takes: 1, seconds: 5 }, env);
    expect(plain.withFace).toBeUndefined();
    expect(plain.takes[0].kind).toBeUndefined();
    expect(setPictureWho(ws, id, "mj bride.png", null)).toBeNull();
    expect(readPictures(path.join(songPathsById(ws, id).root, "pictures")).pictures["mj bride.png"].who).toBeUndefined();
    expect(faceKeepPrompt("A", ["close-up"], "move.")).toMatch(/@Image 2 is A's face reference sheet: /);
  });
});
