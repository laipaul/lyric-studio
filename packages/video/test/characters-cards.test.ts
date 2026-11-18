// Character and scene cards (C1): folders and card.json, the database row, drafts, Make pack with the stand-in fal
// and face checks (no network), body views cropped by the app, lock (read-only), new version, the cost cap, jobs and
// "Get missing pictures" for a paid picture that could not be downloaded.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { cardJob, openWorkspace, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { findOrCreateSongProject, songPathsById } from "../src/node";
import {
  calibrationSongs, cardRoot, cardThresholds, createCard, currentVersion, enqueueCardJob, fetchMissing, getCard, listCardJobs, listCards, lockCard, lockProblems, makePictures, newVersion,
  packEstimate, readCardFile, readReport, rescore, repickLegacy, runCardJob, updateDraft, versionDir,
} from "../src/node/characters";
import { anglePrompt, ANGLES, classify, DEFAULT_THRESHOLDS, imageSize, MIN_FACE_FRACTION, VIEWS, viewPrompt } from "../src/node/characters/plan";
import { stubFace, stubFal } from "../src/node/characters/stub";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-cards-"));
const wsDir = path.join(root, "workspace");
const pics = path.join(root, "pics");
let ws: Workspace;
const ffmpeg = (...a: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...a]);
const png = (name: string, colour: string) => {
  ffmpeg("-f", "lavfi", "-i", `color=c=${colour}:s=300x400`, "-frames:v", "1", path.join(pics, name));
  return path.join(pics, name);
};
const tools = () => ({ fal: stubFal(pics), face: stubFace() });

beforeAll(() => {
  mkdirSync(pics, { recursive: true });
  for (const [n, c] of [["default", "white"], ["closeup", "pink"], ["three_quarter", "orange"], ["body_front", "beige"], ["body_back", "gray"], ["wide_left", "brown"]] as const) png(`${n}.png`, c);
  ws = openWorkspace(wsDir);
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("cards", () => {
  test("a new character: folder, card.json (v1 draft, Seedream), database row; names and pictures checked", () => {
    const c = createCard(ws, { kind: "character", name: "bride", picture: readFileSync(path.join(pics, "default.png")), fileName: "Bride photo.PNG" });
    const dir = cardRoot(ws, c);
    expect(c.folder).toBe("characters/bride");
    expect(existsSync(path.join(dir, "reference.png"))).toBe(true);
    const f = readCardFile(dir);
    expect(f.versions).toEqual([expect.objectContaining({ n: 1, status: "draft", model: "seedream" })]);
    expect(() => createCard(ws, { kind: "character", name: "bride", picture: Buffer.from("x"), fileName: "a.png" })).toThrow(/already a character called "bride"/);
    expect(() => createCard(ws, { kind: "scene", name: "room", picture: Buffer.from("x"), fileName: "a.gif" })).toThrow(/Use a picture/);
    expect(listCards(ws).map((x) => [x.name, x.thumbnail])).toEqual([["bride", "reference.png"]]);
  });

  test("Make pack: 4 views with the outfit, body views cropped by the app (model's picture kept), report, description draft", async () => {
    const c = getCard(ws, listCards(ws)[0].id);
    updateDraft(ws, c.id, { outfit: "floor-length white A-line gown, long sheer veil" });
    expect(lockProblems(cardRoot(ws, c), readCardFile(cardRoot(ws, c)))[0]).toMatch(/Not made yet: Close-up face, 3\/4 face, Full body, front, Full body, back\./);
    const r = await makePictures(ws, c.id, { ...tools(), sleep: async () => {} }, { cap: 3 });
    const dir = versionDir(cardRoot(ws, c), 1);
    for (const f of ["closeup.png", "three_quarter.png", "body_front.png", "body_back.png", "body_front_t1_full.png", "sheet.jpg", "report.json"]) expect(existsSync(path.join(dir, f)), f).toBe(true);
    const rep = readReport(dir)!;
    expect(rep.items.map((i) => [i.id, i.light])).toEqual([["closeup", "green"], ["three_quarter", "green"], ["body_front", "grey"], ["body_back", "grey"]]);
    expect(r.summary).toMatch(/4 picture\(s\) made · 2 of 2 face views green · about \$0\.17 sent/);
    expect(currentVersion(readCardFile(cardRoot(ws, c))).description).toMatch(/A woman in her twenties/);
    expect(listCards(ws)[0].thumbnail).toBe("v1/closeup.png");
  });

  test("the back view gets the front view as an extra reference (the same outfit from behind); face prompts guard brows and hair", async () => {
    const c = createCard(ws, { kind: "character", name: "groom", picture: readFileSync(path.join(pics, "default.png")), fileName: "g.png" });
    const fal = stubFal(pics);
    const sent: Record<string, unknown>[] = [];
    const submit = fal.queue.submit.bind(fal.queue);
    (fal.queue as { submit: unknown }).submit = (e: string, o: { input: Record<string, unknown> }) => (sent.push(o.input), submit(e as never, o as never));
    await makePictures(ws, c.id, { fal, face: stubFace(), sleep: async () => {} }, { cap: 3 });
    const prompts = sent.filter((i) => Array.isArray(i.image_urls));
    const back = prompts.find((i) => /seen from behind/.test(String(i.prompt)))!;
    const front = prompts.find((i) => /from the front, standing/.test(String(i.prompt)))!;
    expect((front.image_urls as string[]).length).toBe(1);
    expect((back.image_urls as string[]).length).toBe(2);
    expect(String(back.prompt)).toMatch(/SAME outfit seen from the front/);
    expect(String(prompts.find((i) => /close-up portrait of her face and the top/.test(String(i.prompt)))!.prompt)).toMatch(/Eyebrows exactly as in the reference.*no net, mesh/);
  });

  test("face-view prompts: head-and-shoulders only (no shoes, trousers), firm framing; the back view hides front-only details", () => {
    const view = (id: string) => VIEWS.find((v) => v.id === id)!;
    const outfit = "white blouse with a lace collar, pleated skirt, black trousers, white shoes, boutonniere";
    for (const id of ["closeup", "three_quarter"]) {
      const p = viewPrompt(view(id), outfit);
      expect(p).toMatch(/only the part inside this head-and-shoulders frame/);
      expect(p).toMatch(/do NOT show the waist, legs, skirt, trousers or shoes/);
      expect(p).toMatch(/eye level, portrait lens \(about 85 mm\)\. Not a full-length shot, no high angle, no wide angle/);
      expect(p).toMatch(/Eyebrows exactly as in the reference/);
    }
    expect(viewPrompt(view("body_front"), outfit)).toMatch(/Outfit: white blouse.*Keep exactly this outfit/);
    expect(viewPrompt(view("body_back"))).toMatch(/pinned or worn on the front only \(a boutonni.re, brooch, corsage, front buttons\) is not visible from behind/);
  });

  test("a face that is small in the picture is red 'Not a close-up' and is made again (frame height from the PNG header)", async () => {
    const t = DEFAULT_THRESHOLDS;
    expect(MIN_FACE_FRACTION).toBe(0.2);
    expect(classify("closeup", { score: 0.7, face_px: 36 }, t, 400)).toEqual({ light: "red", text: "Not a close-up: the face is only 9% of the picture's height.", regenerate: true });
    expect(classify("three_quarter", { score: 0.7, face_px: 100 }, t, 400).light).toBe("green");
    expect(classify("closeup", { score: 0.7, face_px: 36 }, t).light).toBe("green"); // no frame height: no rule
    expect(imageSize(readFileSync(path.join(pics, "default.png")))).toEqual({ width: 300, height: 400 });
    const c = createCard(ws, { kind: "character", name: "smallface", picture: readFileSync(path.join(pics, "default.png")), fileName: "s.png" });
    const face = stubFace();
    let calls = 0;
    const compare = face.compare;
    face.compare = async (ref, files) => {
      const r = await compare(ref, files);
      if (files.some((f) => /closeup_t1\.png$/.test(f))) calls++, (r.results[0].face_px = 36);
      return r;
    };
    await makePictures(ws, c.id, { fal: stubFal(pics), face, sleep: async () => {} }, { cap: 3, only: ["closeup"] });
    const item = readReport(versionDir(cardRoot(ws, c), 1))!.items[0];
    expect(calls).toBe(1);
    expect(item.tries.map((x) => [x.light, x.frame_h])).toEqual([["red", 400], ["green", 400]]);
    expect(item.tries[0].text).toMatch(/^Not a close-up: the face is only 9%/);
    expect(item.chosen).toBe(1);
  });

  test("the latest run wins: after a new outfit every chosen try (body views too) is from run 2; legacy drafts are picked again once", async () => {
    const c = createCard(ws, { kind: "character", name: "runs", picture: readFileSync(path.join(pics, "default.png")), fileName: "r.png" });
    const cardDir = cardRoot(ws, c);
    updateDraft(ws, c.id, { outfit: "red dress" });
    await makePictures(ws, c.id, { ...tools(), sleep: async () => {} }, { cap: 3 });
    updateDraft(ws, c.id, { outfit: "blue suit" });
    await makePictures(ws, c.id, { ...tools(), sleep: async () => {} }, { cap: 3 });
    const dir = versionDir(cardDir, 1);
    const rep = readReport(dir)!;
    for (const i of rep.items) {
      expect(i.tries.map((t) => t.run), i.id).toEqual([1, 2]);
      expect(i.chosen, i.id).toBe(1);
      expect(readFileSync(path.join(dir, `${i.id}.png`)).equals(readFileSync(path.join(dir, `${i.id}_t2.png`))), i.id).toBe(true);
    }
    // Legacy: no run numbers, the chosen one is the old first try; the newest try counts again, once, and a locked version is untouched.
    for (const i of rep.items) {
      i.chosen = 0;
      for (const t of i.tries) delete t.run;
    }
    delete rep.picked;
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(rep));
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(true);
    const again = readReport(dir)!;
    expect(again.picked).toBe(2);
    expect(again.items.map((i) => i.chosen)).toEqual([1, 1, 1, 1]);
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(false);
    lockCard(ws, c.id);
    const locked = readReport(dir)!;
    delete locked.picked;
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(locked));
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(false);
  });

  test("lock: read-only; a new version starts from it as a draft", () => {
    const c = listCards(ws)[0];
    lockCard(ws, c.id);
    expect(getCard(ws, c.id).status).toBe("locked");
    expect(() => updateDraft(ws, c.id, { outfit: "red dress" })).toThrow(/locked/);
    expect(() => enqueueCardJob(ws, c.id, "pack")).toThrow(/locked/);
    const f = newVersion(ws, c.id);
    expect(f.versions.map((v) => [v.n, v.status])).toEqual([[1, "locked"], [2, "draft"]]);
    expect(existsSync(path.join(versionDir(cardRoot(ws, c), 2), "closeup.png"))).toBe(true); // the pictures came along
    expect(currentVersion(f).outfit).toMatch(/A-line gown/);
    expect(getCard(ws, c.id)).toMatchObject({ status: "draft", version: 2 });
  });

  test("scene cards: 3 angles with the key props named; the cost estimate and the cap", () => {
    const s = createCard(ws, { kind: "scene", name: "bridal room", picture: readFileSync(path.join(pics, "default.png")), fileName: "room.jpg" });
    updateDraft(ws, s.id, { props: "gilded floor mirror, velvet armchair" });
    expect(anglePrompt(ANGLES[0], "gilded floor mirror")).toMatch(/Key props that must stay exactly as they are in the reference .*: gilded floor mirror\./);
    expect(anglePrompt(ANGLES[1])).toMatch(/OPPOSITE side of the room/);
    const e = packEstimate(readCardFile(cardRoot(ws, s)));
    expect([e.images, e.usd.toFixed(2)]).toEqual([3, "0.13"]); // 3 × $0.04 + $0.01
    expect(() => enqueueCardJob(ws, s.id, "pack", { cap: 0.05 })).toThrow(/above the cap of \$0\.05/);
  });

  test("a job: queued, run in the studio's process, done with its summary and cost; one job per card at a time", async () => {
    const s = listCards(ws).find((x) => x.kind === "scene")!;
    const job = enqueueCardJob(ws, s.id, "pack", { cap: 1 });
    expect(() => enqueueCardJob(ws, s.id, "pack")).toThrow(/still running/);
    await runCardJob(() => openWorkspace(wsDir), job.id, tools());
    const done = ws.db.select().from(cardJob).where(eq(cardJob.id, job.id)).get()!;
    expect(done).toMatchObject({ status: "done", progress: 1, cost_usd: 0.13 });
    expect(done.message).toMatch(/3 picture\(s\) made/);
    expect(listCardJobs(ws)[0]).toMatchObject({ cardName: "bridal room", label: "bridal room · Make pack" });
    expect(readdirSync(versionDir(cardRoot(ws, s), 1))).toEqual(expect.arrayContaining(["wide_left.png", "wide_right.png", "detail.png"]));
  });

  test("no FAL_KEY: the job fails with a plain message", async () => {
    const c = listCards(ws).find((x) => x.kind === "character")!;
    const job = enqueueCardJob(ws, c.id, "view", { only: ["closeup"] });
    await runCardJob(() => openWorkspace(wsDir), job.id, { error: "No FAL_KEY in .env: …" });
    expect(ws.db.select().from(cardJob).where(eq(cardJob.id, job.id)).get()).toMatchObject({ status: "failed", message: "No FAL_KEY in .env: …", label: "bride · Remake Close-up face" });
  });

  test("a paid picture that could not be downloaded is never made again; Get missing pictures fetches it free", async () => {
    const c = listCards(ws).find((x) => x.kind === "character")!;
    const fal = stubFal(pics);
    const real = fal.queue.result.bind(fal.queue);
    let broken = true;
    (fal.queue as { result: unknown }).result = async (e: string, o: { requestId: string }) => {
      const r = (await real(e as never, o as never)) as { data: { images?: { url: string }[] } };
      if (broken && r.data.images) r.data.images[0].url = "http://127.0.0.1:9/broken.png";
      return r;
    };
    const submits = () => (fal.queue as unknown as { submit: { calls?: number } }).submit;
    void submits;
    const r = await makePictures(ws, c.id, { fal, face: stubFace(), sleep: async () => {} }, { cap: 1, only: ["closeup"] });
    expect(r.notDownloaded).toBe(1);
    const dir = versionDir(cardRoot(ws, c), 2);
    const item = readReport(dir)!.items.find((i) => i.id === "closeup")!;
    const last = item.tries[item.tries.length - 1];
    expect(last.text).toMatch(/Made but not downloaded/);
    expect(item.tries.filter((t) => /not downloaded/.test(t.text))).toHaveLength(1); // not made again
    broken = false;
    last.url = undefined; // an old report: ask fal again by request ID
    const rep = readReport(dir)!;
    rep.items.find((i) => i.id === "closeup")!.tries.at(-1)!.url = undefined;
    (await import("node:fs")).writeFileSync(path.join(dir, "report.json"), JSON.stringify(rep));
    const f = await fetchMissing(ws, c.id, { fal, face: stubFace(), sleep: async () => {} });
    expect(f.summary).toMatch(/Got 1 missing picture/);
    expect(readReport(dir)!.items.find((i) => i.id === "closeup")!.tries.at(-1)!.file).toMatch(/closeup_t\d+\.png/);
  });

  test("calibrate on a song's clips (local, free): calibration.json, the card's lines change; scene cards refused", async () => {
    const songFile = path.join(root, "Wedding Day.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=2", songFile);
    const sp = await findOrCreateSongProject(ws, songFile);
    mkdirSync(songPathsById(ws, sp.project.id).clips!, { recursive: true });
    expect(calibrationSongs(ws).map((x) => x.title)).toEqual(["Wedding Day"]);
    const c = listCards(ws).find((x) => x.kind === "character")!;
    expect(cardThresholds(cardRoot(ws, c)).green_from).toBe(0.363);
    const job = enqueueCardJob(ws, c.id, "calibrate", { songId: sp.project.id, her: ["Korean_bri"] });
    await runCardJob(() => openWorkspace(wsDir), job.id, { fal: undefined as never, face: stubFace() });
    const done = ws.db.select().from(cardJob).where(eq(cardJob.id, job.id)).get()!;
    expect(done).toMatchObject({ status: "done", cost_usd: 0 });
    expect(done.message).toMatch(/Green ≥ 0\.528, red < 0\.458 \(3 other clip\(s\) of Wedding Day/);
    expect(cardThresholds(cardRoot(ws, c))).toMatchObject({ green_from: 0.528, red_below: 0.458, source: "calibrated on your clips" });
    expect(done.message).toMatch(/^3 face picture\(s\) judged again\./); // every try already made (the 3/4 was remade once), free
    // Stricter lines: the same pictures are judged again (no new picture made), the face views turn amber.
    const before = readdirSync(versionDir(cardRoot(ws, c), 2)).length;
    expect(rescore(cardRoot(ws, c), readCardFile(cardRoot(ws, c)), { red_below: 0.5, green_from: 0.7, source: "test" })).toBe(3);
    const rep = readReport(versionDir(cardRoot(ws, c), 2))!;
    expect(rep.items.filter((i) => i.kind === "view").map((i) => i.light)).toEqual(["amber", "amber", "grey", "grey"]);
    expect(readdirSync(versionDir(cardRoot(ws, c), 2)).length).toBe(before);
    const s = listCards(ws).find((x) => x.kind === "scene")!;
    const sj = enqueueCardJob(ws, s.id, "calibrate", { songId: sp.project.id });
    await runCardJob(() => openWorkspace(wsDir), sj.id, { fal: undefined as never, face: stubFace() });
    expect(ws.db.select().from(cardJob).where(eq(cardJob.id, sj.id)).get()!.message).toMatch(/Only characters are calibrated/);
  });
});
