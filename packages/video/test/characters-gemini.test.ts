// Gemini (Nano Banana Pro) on the user's own key for a card's pack (21 Nov 2026): the request Google gets (the key in
// a header, the pictures inline, the 3:4 / 2:3 size), its answer read as a picture, plain errors, and a whole pack made
// with it (fetch replaced: nothing goes to Google). Without the key: the plain "add it to .env" message.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, expect, test } from "vitest";

import { cardRoot, createCard, GEMINI_KEY_MISSING, geminiClient, geminiImage, getCard, hasGeminiKey, makePictures, MODELS, readReport, updateDraft, versionDir } from "../src/node/characters";
import { callModel } from "../src/node/characters/fal";
import { stubFace, stubFal } from "../src/node/characters/stub";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-gemini-"));
const pics = path.join(root, "pics");
let ws: Workspace;
let png: Buffer;

beforeAll(() => {
  mkdirSync(pics, { recursive: true });
  for (const [n, c] of [["default", "white"], ["closeup", "pink"]] as const)
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${c}:s=300x400`, "-frames:v", "1", path.join(pics, `${n}.png`)]);
  png = readFileSync(path.join(pics, "closeup.png"));
  ws = openWorkspace(path.join(root, "workspace"));
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

const answer = (b: Buffer) => ({ candidates: [{ content: { parts: [{ text: "Here it is." }, { inlineData: { mimeType: "image/png", data: b.toString("base64") } }] } }] });
const opts = { timeoutMs: 5000, pollMs: 1, sleep: async () => {} };

test("the request: the key in a header (never the URL), the pictures inline, the size; the answer read as a picture", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const g = geminiClient("secret-key", (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(answer(png)), { status: 200 });
  }) as unknown as typeof fetch);
  const ref = await g.storage.upload(new File([new Uint8Array(png)], "ref.png", { type: "image/png" }));
  const r = await callModel(g, MODELS.gemini.endpoint, MODELS.gemini.input("A close-up portrait", [ref], "3:4", 7), opts);
  expect(seen[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent");
  expect(seen[0].url).not.toContain("secret-key");
  expect((seen[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
  const body = JSON.parse(String(seen[0].init.body));
  expect(body.contents[0].parts[0].text).toBe("A close-up portrait");
  expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/png", data: png.toString("base64") });
  expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4", imageSize: "2K" } });
  const url = (r.data.images as { url: string }[])[0].url;
  expect(Buffer.from(url.split(",")[1], "base64").equals(png)).toBe(true);
});

test("plain errors: Google's own message, a refusal, a text-only answer", async () => {
  const g = geminiClient("k", (async () => new Response(JSON.stringify({ error: { message: "API key not valid." } }), { status: 400 })) as unknown as typeof fetch);
  await expect(callModel(g, MODELS.gemini.endpoint, MODELS.gemini.input("x", [], "3:4", 1), opts)).rejects.toThrow(/HTTP 400: API key not valid/);
  expect(() => geminiImage({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(/refused the request \(SAFETY\)/);
  expect(() => geminiImage({ candidates: [{ content: { parts: [{ text: "I can't draw that." }] }, finishReason: "STOP" }] })).toThrow(/no picture \(STOP\): "I can't draw that\."/);
  expect(hasGeminiKey({ GEMINI_API_KEY: " " } as NodeJS.ProcessEnv)).toBe(false);
  expect(hasGeminiKey({ GEMINI_API_KEY: "abc" } as NodeJS.ProcessEnv)).toBe(true);
});

test("a whole pack with Gemini: the four views from Google, the description and outfit split still from fal", async () => {
  const c = createCard(ws, { kind: "character", name: "bride", picture: readFileSync(path.join(pics, "default.png")), fileName: "bride.png" });
  updateDraft(ws, c.id, { model: "gemini", outfit: "white gown, long veil" });
  // Without the key: the plain message, nothing made.
  await expect(makePictures(ws, c.id, { fal: stubFal(pics), face: stubFace(), gemini: null, sleep: async () => {} }, { cap: 3 })).rejects.toThrow(GEMINI_KEY_MISSING);
  let calls = 0;
  const gemini = geminiClient("k", (async () => {
    calls++;
    return new Response(JSON.stringify(answer(png)), { status: 200 });
  }) as unknown as typeof fetch);
  const r = await makePictures(ws, c.id, { fal: stubFal(pics), face: stubFace(), gemini, sleep: async () => {} }, { cap: 3 });
  expect(calls).toBe(4);
  expect(r.made).toBe(4);
  const dir = versionDir(cardRoot(ws, getCard(ws, c.id)), 1);
  for (const v of ["closeup", "three_quarter", "body_front", "body_back"]) expect(existsSync(path.join(dir, `${v}.png`))).toBe(true);
  expect(readReport(dir)!.endpoint).toBe("gemini/gemini-3-pro-image");
  expect(r.spentUsd).toBeGreaterThanOrEqual(4 * 0.14); // + the cheap text calls on fal
});
