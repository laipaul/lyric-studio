// "Use my own picture" / "Add my pack" (21 Nov 2026): pictures made elsewhere go into the pack's places, free, with the
// same face checks (stand-ins here) and the neck crop; sorted by file name, else by the face check, else the first free
// place; "Move to" swaps; the description can be drafted for about $0.01 (stand-in fal).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { cardRoot, createCard, currentVersion, draftDescription, getCard, lockProblems, moveOwnPicture, readCardFile, readReport, slotFromFace, slotFromName, useOwnPictures, versionDir } from "../src/node/characters";
import { stubFace, stubFal } from "../src/node/characters/stub";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-own-"));
const pics = path.join(root, "pics");
let ws: Workspace;
const pic = (name: string, colour: string) => {
  const f = path.join(pics, name);
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${colour}:s=300x400`, "-frames:v", "1", f]);
  return f;
};
const own = (f: string, slot?: string) => ({ name: path.basename(f), bytes: readFileSync(f), slot });

beforeAll(() => {
  mkdirSync(pics, { recursive: true });
  pic("default.png", "white");
  ws = openWorkspace(path.join(root, "workspace"));
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("where a picture goes", () => {
  test("by its file name", () => {
    expect(slotFromName("Bride closeup.png", "character")).toBe("closeup");
    expect(slotFromName("bride close-up.png", "character")).toBe("closeup");
    expect(slotFromName("bride 3-4 face.png", "character")).toBe("three_quarter");
    expect(slotFromName("three quarter.jpg", "character")).toBe("three_quarter");
    expect(slotFromName("full body front.png", "character")).toBe("body_front");
    expect(slotFromName("full body back.png", "character")).toBe("body_back");
    expect(slotFromName("Gemini_Generated_Image_k3j4l2m5n6o7.png", "character")).toBeNull();
    expect(slotFromName("Gemini_Generated_Image_34ab.png", "character")).toBeNull();
    expect(slotFromName("room from the left.png", "scene")).toBe("wide_left");
  });
  test("by the face check when the name says nothing", () => {
    expect(slotFromFace({ score: null, face_px: 0 }, 1000)).toBe("body_back");
    expect(slotFromFace({ score: 0.6, face_px: 100, yaw: 0 }, 1000)).toBe("body_front");
    expect(slotFromFace({ score: 0.6, face_px: 400, yaw: 35 }, 1000)).toBe("three_quarter");
    expect(slotFromFace({ score: 0.6, face_px: 500, yaw: 3 }, 1000)).toBe("closeup");
  });
});

test("Add my pack: four named pictures in their places, checked, body views cropped, free; then Move to and the description", async () => {
  const c = createCard(ws, { kind: "character", name: "gemini bride", picture: readFileSync(path.join(pics, "default.png")), fileName: "bride.png" });
  const files = [pic("bride closeup.png", "pink"), pic("bride 3-4 face.jpg", "orange"), pic("full body front.png", "beige"), pic("full body back.png", "gray")];
  const before = files.map((f) => readFileSync(f));
  const r = await useOwnPictures(ws, c.id, stubFace(), files.map((f) => own(f)));
  expect(r.placed.map((p) => [p.slot, p.by])).toEqual([
    ["closeup", "name"],
    ["three_quarter", "name"],
    ["body_front", "name"],
    ["body_back", "name"],
  ]);
  expect(r.summary).toMatch(/Free, nothing sent online/);
  const root = cardRoot(ws, getCard(ws, c.id));
  const dir = versionDir(root, 1);
  for (const id of ["closeup", "three_quarter", "body_front", "body_back"]) expect(existsSync(path.join(dir, `${id}.png`))).toBe(true);
  expect(existsSync(path.join(dir, "body_front_t1_full.png"))).toBe(true); // the picture as given, before the neck crop
  const report = readReport(dir)!;
  expect(report.spent_usd).toBe(0);
  expect(report.items.find((i) => i.id === "closeup")!.light).toBe("green");
  expect(report.items.find((i) => i.id === "closeup")!.text).toMatch(/^Your picture \(bride closeup\.png\)/);
  expect(files.every((f, k) => readFileSync(f).equals(before[k]))).toBe(true); // the user's files are only read
  expect(readFileSync(path.join(dir, "three_quarter.png")).subarray(1, 4).toString()).toBe("PNG"); // the JPEG became a PNG
  expect(lockProblems(root, readCardFile(root))).toEqual(["Write (or keep) the description first: it is locked with the pictures."]);

  // Move to: the close-up and the 3/4 swap places.
  const closeupBytes = readFileSync(path.join(dir, "closeup.png"));
  const m = await moveOwnPicture(ws, c.id, stubFace(), "closeup", "three_quarter");
  expect(m.placed.map((p) => p.slot).sort()).toEqual(["closeup", "three_quarter"]);
  expect(readFileSync(path.join(dir, "three_quarter.png")).equals(closeupBytes)).toBe(true);
  await expect(moveOwnPicture(ws, c.id, stubFace(), "closeup", "closeup")).rejects.toThrow(/already there/);

  // The description, drafted for about $0.01.
  const d = await draftDescription(ws, c.id, stubFal(pics));
  expect(d.usd).toBe(0.01);
  expect(currentVersion(readCardFile(root)).description).toMatch(/A woman/);
  expect(lockProblems(root, readCardFile(root))).toEqual([]);
  await expect(draftDescription(ws, c.id, stubFal(pics))).rejects.toThrow(/already a description/);
});

test("nameless Gemini pictures all get a place of their own; one picture to a chosen place; too many refused", async () => {
  const c = createCard(ws, { kind: "character", name: "nameless", picture: readFileSync(path.join(pics, "default.png")), fileName: "n.png" });
  const files = ["a1", "b2", "c3", "d4"].map((x, k) => pic(`Gemini_Generated_Image_${x}.png`, ["red", "green", "blue", "yellow"][k]));
  const r = await useOwnPictures(ws, c.id, stubFace(), files.map((f) => own(f)));
  expect(new Set(r.placed.map((p) => p.slot)).size).toBe(4);
  expect(r.placed[0]).toMatchObject({ slot: "closeup", by: "face" });
  const one = await useOwnPictures(ws, c.id, stubFace(), [own(files[0], "body_back")]);
  expect(one.placed).toMatchObject([{ slot: "body_back", by: "you" }]);
  const dir = versionDir(cardRoot(ws, getCard(ws, c.id)), 1);
  expect(readReport(dir)!.items.find((i) => i.id === "body_back")!.tries.length).toBe(2); // the earlier one is kept as a try
  await expect(useOwnPictures(ws, c.id, stubFace(), [...files, files[0]].map((f) => own(f)))).rejects.toThrow(/No place left for Gemini_Generated_Image_a1\.png.*pack has 4 places/);
  const eight = Array.from({ length: 8 }, (_, k) => own(files[k % 4]));
  await expect(useOwnPictures(ws, c.id, stubFace(), eight)).rejects.toThrow(/A character has 7 places/);
  await expect(useOwnPictures(ws, c.id, stubFace(), [{ name: "notes.txt", bytes: Buffer.from("x") }])).rejects.toThrow(/not a picture/);
});
