// The Wardrobe (21 Nov 2026): one face, many looks. The pack is the main look (nothing moved); a further look has its
// own outfit and full body views (and, if asked, a close-up in it), made by the app (stand-in fal: no network) or from
// the user's own pictures, locked on its own; the face pack and the version are never touched.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
  addLook, cardRoot, createCard, enqueueCardJob, getCard, getLook, listCards, listLooks, lookDir, lookEstimate, lookOutfit, lookProblems, makePictures, readCardFile, readReport, setLookLocked, updateDraft, updateLook, useOwnPictures, versionDir,
} from "../src/node/characters";
import { stubFace, stubFal } from "../src/node/characters/stub";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-looks-"));
const pics = path.join(root, "pics");
let ws: Workspace;
const png = (name: string, colour: string) => {
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${colour}:s=300x400`, "-frames:v", "1", path.join(pics, name)]);
  return path.join(pics, name);
};
const deps = () => ({ fal: stubFal(pics), face: stubFace(), sleep: async () => {} });

beforeAll(() => {
  mkdirSync(pics, { recursive: true });
  for (const [n, c] of [["default", "white"], ["closeup", "pink"], ["three_quarter", "orange"], ["body_front", "beige"], ["body_back", "gray"]] as const) png(`${n}.png`, c);
  ws = openWorkspace(path.join(root, "workspace"));
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

test("the pack is the main look; a new look is made in its own folder, the version untouched", async () => {
  const c = createCard(ws, { kind: "character", name: "bride", picture: readFileSync(path.join(pics, "default.png")), fileName: "bride.png" });
  updateDraft(ws, c.id, { outfit: "white gown" });
  await makePictures(ws, c.id, deps(), { cap: 3 });
  const cardDir = cardRoot(ws, getCard(ws, c.id));
  const vdir = versionDir(cardDir, 1);
  const versionTries = readReport(vdir)!.items.reduce((n, i) => n + i.tries.length, 0);

  expect(listLooks(cardDir, readCardFile(cardDir)).map((l) => [l.id, l.name, l.views.filter((v) => v.file).length])).toEqual([["main", "Main look", 4]]);
  expect(listCards(ws).find((x) => x.id === c.id)!.looks).toEqual([]); // no chips until there is a second look

  const coat = addLook(ws, c.id, { name: "Travel coat", outfit: "camel wool coat over a cream dress" });
  expect(coat).toMatchObject({ id: "travel-coat", status: "draft", closeup: false, model: "seedream" });
  expect(() => addLook(ws, c.id, { name: "travel coat" })).toThrow(/already a look called/);
  expect(() => addLook(ws, c.id, { name: "Main look" })).toThrow(/already a look called/);
  expect(lookEstimate(coat).text).toMatch(/^2 pictures with Seedream 4\.5.*splitting the outfit/);
  expect(lookProblems(cardDir, coat)).toEqual(["Not made yet: Full body, front, Full body, back. Make the look, or add your own pictures."]);

  const r = await makePictures(ws, c.id, deps(), { cap: 3, look: coat.id });
  expect(r.made).toBe(2);
  const ldir = lookDir(cardDir, coat.id);
  expect(["body_front.png", "body_back.png", "body_front_t1_full.png"].every((f) => existsSync(path.join(ldir, f)))).toBe(true);
  expect(existsSync(path.join(ldir, "closeup.png"))).toBe(false);
  expect(readReport(vdir)!.items.reduce((n, i) => n + i.tries.length, 0)).toBe(versionTries); // the pack is untouched
  const file = readCardFile(cardDir);
  expect(getLook(file, coat.id).outfit_split?.from).toBe("camel wool coat over a cream dress"); // split for the look
  expect(file.versions[0].outfit).toBe("white gown");
  expect(listCards(ws).find((x) => x.id === c.id)!.looks).toEqual(["Main look", "Travel coat"]);
  expect(lookOutfit(file, coat.id)).toEqual({ id: coat.id, name: "Travel coat", outfit: "camel wool coat over a cream dress" });
  expect(lookOutfit(file, null)).toEqual({ id: "main", name: "Main look", outfit: "white gown" });

  // With a close-up in the look: only that view is made when asked.
  updateLook(ws, c.id, coat.id, { closeup: true });
  await makePictures(ws, c.id, deps(), { cap: 3, look: coat.id, only: ["closeup"] });
  expect(readReport(ldir)!.items.find((i) => i.id === "closeup")!.light).toBe("green"); // face-checked against the card's picture

  // Lock on its own; locked = no changes, no Make; "Change this look" makes it a draft again (everything kept).
  setLookLocked(ws, c.id, coat.id, true);
  expect(() => updateLook(ws, c.id, coat.id, { outfit: "x" })).toThrow(/locked/);
  expect(() => enqueueCardJob(ws, c.id, "pack", { look: coat.id })).toThrow(/locked/);
  await expect(makePictures(ws, c.id, deps(), { cap: 3, look: coat.id })).rejects.toThrow(/locked/);
  updateLook(ws, c.id, coat.id, { name: "Travel coat (autumn)" }); // a new name is always allowed
  setLookLocked(ws, c.id, coat.id, false);
  expect(readdirSync(ldir).filter((f) => /_t\d+\.png$/.test(f)).length).toBeGreaterThanOrEqual(3);
  updateLook(ws, c.id, "main", { name: "Wedding gown" });
  expect(listLooks(cardDir, readCardFile(cardDir)).map((l) => l.name)).toEqual(["Wedding gown", "Travel coat (autumn)"]);
});

test("a look from your own pictures: free, sorted into the look's places, then locked", async () => {
  const c = createCard(ws, { kind: "character", name: "singer", picture: readFileSync(path.join(pics, "default.png")), fileName: "s.png" });
  const dress = addLook(ws, c.id, { name: "Evening dress" });
  const r = await useOwnPictures(ws, c.id, stubFace(), [png("evening front.png", "red"), png("evening back.png", "maroon")].map((f) => ({ name: path.basename(f), bytes: readFileSync(f) })), dress.id);
  expect(r.placed.map((p) => p.slot)).toEqual(["body_front", "body_back"]);
  const cardDir = cardRoot(ws, getCard(ws, c.id));
  expect(readReport(versionDir(cardDir, 1))).toBeNull(); // the pack is not touched
  await expect(useOwnPictures(ws, c.id, stubFace(), ["a", "b", "c"].map((n) => ({ name: `${n}.png`, bytes: readFileSync(path.join(pics, "default.png")) })), dress.id)).rejects.toThrow(/"Evening dress" has 2 pictures/);
  expect(setLookLocked(ws, c.id, dress.id, true).looks![0].status).toBe("locked");
});
