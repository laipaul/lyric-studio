// Card clean-up (26 Nov 2026): ✕ puts a pack picture aside (Restore swaps it back), Replace picture keeps the old one
// (Restore), Remove card moves the folder to _removed (Restore with the same id); the extra views take your own picture.
// Nothing is ever deleted.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { card as cardTable, openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
  asidePictures, cardRoot, createCard, getCard, listCards, listRemovedCards, lockCard, putAsideView, readCardFile, readReport, removeCard, replaceReference, restoreCard, restoreReference, restoreView, slotFromName, updateDraft, useOwnPictures, versionDir,
} from "../src/node/characters";
import { stubFace } from "../src/node/characters/stub";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-cleanup-"));
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

const packOf = async (name: string) => {
  const c = createCard(ws, { kind: "character", name, picture: readFileSync(path.join(pics, "default.png")), fileName: "ref.png" });
  const files = [pic("Aiko 1 close-up face.png", "pink"), pic("Aiko 2 three-quarter face.png", "orange"), pic("Aiko 3 side profile.png", "purple"), pic("Aiko 4 full body front.png", "beige"), pic("Aiko 5 full body back.png", "gray")];
  const r = await useOwnPictures(ws, c.id, stubFace(), files.map((f) => own(f)));
  return { c, r, dir: versionDir(cardRoot(ws, getCard(ws, c.id)), 1) };
};

test("the extra views by their names; Add my pack takes five (side profile included)", async () => {
  expect(slotFromName("Aiko 3 side profile.png", "character")).toBe("profile");
  expect(slotFromName("Aiko full body with face.png", "character")).toBe("body_full");
  expect(slotFromName("aiko smile teeth.png", "character")).toBe("closeup_teeth");
  expect(slotFromName("Aiko 1 close-up face.png", "character")).toBe("closeup");
  expect(slotFromName("Aiko 4 full body front.png", "character")).toBe("body_front");
  const { r, dir } = await packOf("aiko");
  expect(r.placed.map((p) => p.slot)).toEqual(["closeup", "three_quarter", "profile", "body_front", "body_back"]);
  expect(existsSync(path.join(dir, "profile.png"))).toBe(true);
});

test("✕ puts a picture aside (kept), Restore brings it back; a picture now there is put aside in its turn", async () => {
  const { c, dir } = await packOf("aside");
  const before = readFileSync(path.join(dir, "body_front.png"));
  putAsideView(ws, c.id, "body_front");
  expect(existsSync(path.join(dir, "body_front.png"))).toBe(false);
  const file = readCardFile(cardRoot(ws, getCard(ws, c.id)));
  const aside = asidePictures(cardRoot(ws, getCard(ws, c.id)), file);
  expect(aside).toHaveLength(1);
  expect(readFileSync(path.join(cardRoot(ws, getCard(ws, c.id)), aside[0].rel))).toEqual(before);
  expect(readReport(dir)!.items.find((i) => i.id === "body_front")!.chosen).toBeNull();
  // A new picture in the place, then Restore: the old one is back, the new one is put aside.
  await useOwnPictures(ws, c.id, stubFace(), [own(pic("new front.png", "blue"), "body_front")]);
  restoreView(ws, c.id, aside[0].file);
  expect(readFileSync(path.join(dir, "body_front.png"))).toEqual(before);
  expect(asidePictures(cardRoot(ws, getCard(ws, c.id)), readCardFile(cardRoot(ws, getCard(ws, c.id)))).map((a) => a.id)).toEqual(["body_front"]);
  expect(() => putAsideView(ws, c.id, "body_full")).toThrow(/no Full body with face picture/i);
});

test("a locked card keeps its pack; its extra views can still be put aside and take your picture", async () => {
  const { c } = await packOf("locked one");
  updateDraft(ws, c.id, { description: "A woman." });
  lockCard(ws, c.id);
  expect(() => putAsideView(ws, c.id, "closeup")).toThrow(/locked/);
  putAsideView(ws, c.id, "profile");
  await expect(useOwnPictures(ws, c.id, stubFace(), [own(path.join(pics, "Aiko 1 close-up face.png"))])).rejects.toThrow(/locked/);
  const r = await useOwnPictures(ws, c.id, stubFace(), [own(path.join(pics, "Aiko 3 side profile.png"))]);
  expect(r.placed[0].slot).toBe("profile");
});

test("Replace picture keeps the old one; Restore swaps them back", async () => {
  const { c } = await packOf("replace");
  const r0 = cardRoot(ws, getCard(ws, c.id));
  const old = readFileSync(path.join(r0, "reference.png"));
  const f = replaceReference(ws, c.id, readFileSync(pic("new face.jpg", "red")), "new face.jpg");
  expect(f.reference).toBe("reference.jpg");
  expect(f.check).toBeUndefined();
  const kept = (f as { replaced?: { at: string; folder: string }[] }).replaced!;
  expect(readFileSync(path.join(r0, kept[0].folder, "reference.png"))).toEqual(old);
  const back = restoreReference(ws, c.id, kept[0].at);
  expect(back.reference).toBe("reference.png");
  expect(readFileSync(path.join(r0, "reference.png"))).toEqual(old);
  expect((back as { replaced?: unknown[] }).replaced).toHaveLength(1); // the newer one is kept in its turn
});

test("Remove card: the folder goes to characters\\_removed (kept), off the list; Restore with the same id", async () => {
  const { c } = await packOf("wedding singer");
  const r = removeCard(ws, c.id);
  expect(r.folder).toMatch(/^characters\/_removed\/wedding singer /);
  expect(existsSync(path.join(ws.dir, "characters", "wedding singer"))).toBe(false);
  expect(readdirSync(path.join(ws.dir, r.folder))).toContain("v1");
  expect(listCards(ws).some((x) => x.name === "wedding singer")).toBe(false);
  expect(listRemovedCards(ws).map((x) => x.name)).toContain("wedding singer");
  // The name is free meanwhile; Restore is refused while it is taken.
  const other = createCard(ws, { kind: "character", name: "wedding singer", picture: readFileSync(path.join(pics, "default.png")), fileName: "x.png" });
  expect(() => restoreCard(ws, r.folder)).toThrow(/already a character called "wedding singer"/);
  removeCard(ws, other.id);
  const back = restoreCard(ws, r.folder);
  expect(back.id).toBe(c.id);
  expect(ws.db.select().from(cardTable).all().filter((x) => x.name === "wedding singer")).toHaveLength(1);
  expect(existsSync(path.join(ws.dir, "characters", "wedding singer", "card.json"))).toBe(true);
  expect(listRemovedCards(ws).filter((x) => x.name === "wedding singer")).toHaveLength(1); // the other one, still kept
  expect(() => restoreCard(ws, "../songs")).toThrow(/not there/);
});
