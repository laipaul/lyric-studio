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
  packEstimate, readCardFile, readReport, rescore, repickLegacy, runCardJob, updateDraft, versionDir, ensureSplit, makeSplit, parseSplit,
} from "../src/node/characters";
import { anglePrompt, ANGLES, classify, DEFAULT_THRESHOLDS, DESCRIPTION_PROMPT, PACK_STYLE, imageSize, MAX_YAW, minFaceFor, VIEWS, viewPrompt } from "../src/node/characters/plan";
import { outfitSplitPrompt } from "../src/node/characters/split";
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
    expect(r.summary).toMatch(/4 picture\(s\) made · 2 of 2 face views green · about \$0\.18 sent/);
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
    expect(String(prompts.find((i) => /close-up portrait of this person's face and the top/.test(String(i.prompt)))!.prompt)).toMatch(/Eyebrows exactly as in the reference.*no net, mesh/);
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

  test("face views: eye-level / no top-down in all four prompts; 3/4 is 45 degrees with both eyes visible", () => {
    for (const v of VIEWS) expect(viewPrompt(v), v.id).toMatch(/eye level[^.]*no high angle, no top-down view/);
    const three = VIEWS.find((v) => v.id === "three_quarter")!.prompt;
    expect(three).toMatch(/turned about 45 degrees toward the camera, both eyes visible, not viewed from behind/);
    expect(VIEWS.find((v) => v.id === "closeup")!.prompt).toMatch(/straight on.*the face filling about half the frame/);
  });

  test("a head turned away is red (yaw), judged from the Try's stored yaw; unknown yaw is no rule", () => {
    const t = DEFAULT_THRESHOLDS;
    expect(MAX_YAW).toBe(70);
    expect(classify("three_quarter", { score: 0.7, face_px: 200, yaw: 110 }, t, 400)).toEqual({ light: "red", text: "Turned away: the face is turned 110°, both eyes should be visible.", regenerate: true });
    expect(classify("three_quarter", { score: 0.7, face_px: 200, yaw: -45 }, t, 400).light).toBe("green");
    expect(classify("three_quarter", { score: 0.7, face_px: 200, yaw: null }, t, 400).light).toBe("green");
    expect(classify("three_quarter", { score: 0.7, face_px: 200 }, t, 400).light).toBe("green");
    const c = createCard(ws, { kind: "character", name: "yawcard", picture: readFileSync(path.join(pics, "default.png")), fileName: "y.png" });
    const dir = path.join(cardRoot(ws, c), "v1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "three_quarter_t1.png"), readFileSync(path.join(pics, "default.png")));
    const mk = (yaw: number | null) => ({ file: "three_quarter_t1.png", request_id: "r", score: 0.7, face_px: 200, frame_h: 400, yaw, run: 1, light: "green", text: "", attempts: [], seed: 1 });
    const rep = (yaw: number | null) => JSON.stringify({ updated_at: "", model: "seedream", endpoint: "x", thresholds: DEFAULT_THRESHOLDS, request_ids: [], spent_usd: 0, items: [{ id: "three_quarter", label: "3/4 face", kind: "view", tries: [mk(yaw)], chosen: 0, light: "green", text: "" }] });
    writeFileSync(path.join(dir, "report.json"), rep(110));
    rescore(cardRoot(ws, c), readCardFile(cardRoot(ws, c)), DEFAULT_THRESHOLDS);
    expect(readReport(dir)!.items[0].tries[0].text).toMatch(/^Turned away: the face is turned 110°/);
    expect(readReport(dir)!.items[0].tries[0].light).toBe("red");
    writeFileSync(path.join(dir, "report.json"), rep(null));
    rescore(cardRoot(ws, c), readCardFile(cardRoot(ws, c)), DEFAULT_THRESHOLDS);
    expect(readReport(dir)!.items[0].tries[0].light).toBe("green");
  });

  test("the outfit split: parsed from fenced JSON, made on an outfit change, used per view, remade on a new outfit, made inside the pack when missing, none without a key", async () => {
    expect(parseSplit('Here you go:\n```json\n{"closeups":"bateau neckline","front":["a","b"],"back":" V-neck "}\n```', " x ")).toEqual({ from: "x", closeups: "bateau neckline", front: "a, b", back: "V-neck" });
    expect(parseSplit("no json", "x")).toBeNull();
    expect(parseSplit('{"closeups":"a","front":"b"}', "x")).toBeNull();

    const c = createCard(ws, { kind: "character", name: "splitter", picture: readFileSync(path.join(pics, "default.png")), fileName: "s.png" });
    const cardDir = cardRoot(ws, c);
    const split = () => currentVersion(readCardFile(cardDir)).outfit_split;
    // No key: the outfit is saved, no split, a plain message.
    updateDraft(ws, c.id, { outfit: "bateau neckline gown, V-neck with buttons on the back" });
    const none = await ensureSplit(ws, c.id, null);
    expect(none).toMatchObject({ made: false, usd: 0 });
    expect(none.message).toMatch(/Outfit saved\. It was not split.*as it is for every view/);
    expect(split()).toBeUndefined();
    expect(packEstimate(readCardFile(cardDir)).usd).toBeCloseTo(0.18);
    expect(packEstimate(readCardFile(cardDir)).text).toMatch(/splitting your outfit per view/);
    // With the stub fal: made once, stored with `from`.
    const fal = stubFal(pics);
    const sent: Record<string, unknown>[] = [];
    const submit = fal.queue.submit.bind(fal.queue);
    (fal.queue as { submit: unknown }).submit = (e: string, o: { input: Record<string, unknown> }) => (sent.push(o.input), submit(e as never, o as never));
    const r = await ensureSplit(ws, c.id, fal);
    expect(r).toMatchObject({ made: true, usd: 0.01, message: null });
    expect(split()).toMatchObject({ from: "bateau neckline gown, V-neck with buttons on the back", closeups: expect.stringContaining("neckline") });
    expect(packEstimate(readCardFile(cardDir)).usd).toBeCloseTo(0.17);
    expect((await ensureSplit(ws, c.id, fal)).made).toBe(false); // current: nothing to do
    // Paul corrects one part; `from` is kept.
    updateDraft(ws, c.id, { outfit_split: { back: "V-neck back, buttons down the spine" } });
    expect(split()).toMatchObject({ back: "V-neck back, buttons down the spine", from: "bateau neckline gown, V-neck with buttons on the back" });
    // The prompts use the matching part.
    sent.length = 0;
    await makePictures(ws, c.id, { fal, face: stubFace(), sleep: async () => {} }, { cap: 3 });
    expect(sent.filter((i) => /any-llm/.test(String(i.model ?? "")) && /Outfit text/.test(String(i.prompt))).length).toBe(0); // no second split
    const imgs = sent.filter((i) => Array.isArray(i.image_urls));
    const find = (re: RegExp) => String(imgs.find((i) => re.test(String(i.prompt)))!.prompt);
    expect(find(/close-up portrait of this person's face and the top/)).toMatch(/neckline and veil at the head/);
    expect(find(/close-up portrait of this person's face and the top/)).not.toMatch(/buttons/);
    expect(find(/three-quarter/)).toMatch(/Outfit \(only the part inside this head-and-shoulders frame.*neckline and veil/);
    expect(find(/from the front, standing/)).toMatch(/Outfit: front of the outfit.*Details that are only on the back \(V-neck back, buttons down the spine\) must NOT appear on the front/);
    expect(find(/seen from behind/)).toMatch(/Outfit: V-neck back, buttons down the spine\..*Details that are only on the front \(front of the outfit.*\) are not visible from behind/);
    // A new outfit: the old split is not used (stale), and Make pack makes a new one inside the job (counted in the cost).
    updateDraft(ws, c.id, { outfit: "short lace dress, pearl earrings" });
    expect(viewPrompt(VIEWS[0], "short lace dress, pearl earrings", split())).not.toMatch(/neckline and veil/);
    expect(viewPrompt(VIEWS[0], "short lace dress, pearl earrings", split())).toMatch(/Outfit \(only the part.*short lace dress/);
    sent.length = 0;
    const m = await makePictures(ws, c.id, { fal, face: stubFace(), sleep: async () => {} }, { cap: 3, only: ["body_front"] });
    expect(sent.some((i) => /Outfit text:\nshort lace dress/.test(String(i.prompt)))).toBe(true);
    expect(split()?.from).toBe("short lace dress, pearl earrings");
    expect(m.spentUsd).toBeCloseTo(0.05); // the split $0.01 + one body picture $0.04
    expect(String(sent.find((i) => Array.isArray(i.image_urls))!.prompt)).toMatch(/Outfit: front of the outfit \(from: short lace dress/);
    // makeSplit alone fails plainly on an unusable answer.
    const bad = stubFal(pics);
    (bad.queue as { result: unknown }).result = async (_e: string, o: { requestId: string }) => ({ data: { output: "sorry" }, requestId: o.requestId });
    await expect(makeSplit(bad, "x", { sleep: async () => {} })).rejects.toThrow(/not in the expected form/);
    updateDraft(ws, c.id, { outfit: "grey suit" });
    const failed = await ensureSplit(ws, c.id, bad, { sleep: async () => {} });
    expect(failed.made).toBe(false);
    expect(failed.message).toMatch(/^Outfit saved, but it could not be split.*as it is for every view/);
  });

  test("a face that is small in the picture is red 'Not a close-up' and is made again (frame height from the PNG header)", async () => {
    const t = DEFAULT_THRESHOLDS;
    expect([minFaceFor("closeup"), minFaceFor("three_quarter"), minFaceFor("body_front")]).toEqual([0.35, 0.3, null]);
    expect(classify("closeup", { score: 0.7, face_px: 36 }, t, 400)).toEqual({ light: "red", text: "Not a close-up: the face is 9% of the picture's height, needs 35%.", regenerate: true });
    expect(classify("closeup", { score: 0.7, face_px: 120 }, t, 400).text).toBe("Not a close-up: the face is 30% of the picture's height, needs 35%.");
    expect(classify("three_quarter", { score: 0.7, face_px: 128 }, t, 400).light).toBe("green");
    expect(classify("three_quarter", { score: 0.7, face_px: 100 }, t, 400).light).toBe("red");
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
    expect(item.tries[0].text).toMatch(/^Not a close-up: the face is 9%.*needs 35%/);
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
    expect(again.picked).toBe(3);
    expect(again.items.map((i) => i.chosen)).toEqual([1, 1, 1, 1]);
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(false);
    lockCard(ws, c.id);
    const locked = readReport(dir)!;
    delete locked.picked;
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(locked));
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(false);
  });

  test("prompts are gender-neutral; the face views keep the hairstyle of the reference", () => {
    const texts = [...VIEWS.map((v) => v.prompt), ...VIEWS.map((v) => viewPrompt(v, "red dress")), PACK_STYLE, DESCRIPTION_PROMPT, outfitSplitPrompt("red dress")];
    for (const t of texts) expect(t).not.toMatch(/\b(her|hers|she|woman|women)\b/i);
    for (const v of VIEWS) {
      const p = viewPrompt(v, "hair in a bun");
      if (v.face) {
        expect(p).toMatch(/The same hairstyle as in the reference picture: the same length, parting, volume and direction; do not tie it back or restyle it, unless the outfit text below says otherwise\./);
        expect(p.indexOf("The same hairstyle")).toBeLessThan(p.indexOf("hair in a bun"));
      } else expect(p).not.toMatch(/same hairstyle/);
    }
    expect(VIEWS.find((v) => v.id === "body_back")!.prompt).toMatch(/seen from behind/);
    expect(VIEWS.find((v) => v.id === "three_quarter")!.prompt).toMatch(/not viewed from behind/);
  });

  test("old tries without frame_h get the framing check once (picked 3); a locked version is untouched", async () => {
    const c = createCard(ws, { kind: "character", name: "legacy-frame", picture: readFileSync(path.join(pics, "default.png")), fileName: "lf.png" });
    const cardDir = cardRoot(ws, c);
    await makePictures(ws, c.id, { ...tools(), sleep: async () => {} }, { cap: 3 });
    const dir = versionDir(cardDir, 1);
    const rep = readReport(dir)!;
    const closeup = rep.items.find((i) => i.id === "closeup")!;
    expect(closeup.light).toBe("green");
    // A legacy try: no run, no frame_h, the face is small in a 300x400 picture (40 px = 10%).
    for (const i of rep.items) for (const t of i.tries) delete t.run;
    for (const t of closeup.tries) {
      delete t.frame_h;
      t.face_px = 40;
    }
    delete rep.picked;
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(rep));
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(true);
    const after = readReport(dir)!;
    const ci = after.items.find((i) => i.id === "closeup")!;
    expect(after.picked).toBe(3);
    expect(ci.tries[0].frame_h).toBe(400);
    expect(ci.tries[0].light).toBe("red");
    expect(ci.tries[0].text).toMatch(/^Not a close-up/);
    expect(ci.light).toBe("red");
    expect(after.items.find((i) => i.id === "three_quarter")!.tries[0].frame_h).toBe(400);
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(false);
    // Already re-picked once (picked = 2): runs again.
    after.picked = 2;
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(after));
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(true);
    expect(readReport(dir)!.picked).toBe(3);
    lockCard(ws, c.id);
    const locked = readReport(dir)!;
    locked.picked = 2;
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(locked));
    expect(repickLegacy(cardDir, readCardFile(cardDir))).toBe(false);
    expect(readReport(dir)!.picked).toBe(2);
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
