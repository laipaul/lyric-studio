// Characters tidy-up (26 Nov 2026): Edit → new version keeps songs on the version they used until the user answers;
// the card's thumbnail is its own picture (or a chosen cover) until a version is locked; face words in an outfit are
// found and moved to Notes; the Reel singing target follows the Reel's own shot plan.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describesClothes, outfitWarning, sortCardText } from "../src/card-text";
import { lockForSongs, setSongCardVersion, songsUsingCard, switchSongs } from "../src/node/card-versions";
import { cardRoot, createCard, getCard, listCards, newVersion, readCardFile, setCover, tidyCardTexts, updateDraft, VIEWS, writeCardFile } from "../src/node/characters";
import { parseSplit } from "../src/node/characters/split";
import { findOrCreateSongProject, songPathsById } from "../src/node";
import { reelRange } from "../src/node/lipsync";
import { productionData, readProduction, setCast } from "../src/node/production";
import { shotLooks } from "../src/node/shot-looks";
import { ffmpeg, makeSong } from "./media-helpers";

const FACE_TEXT = "Late 20s woman with warm hazel eyes, soft freckles and long dark wavy hair. Natural makeup, gentle smile.";

describe("face words and clothing words (card-text.ts)", () => {
  it("an outfit that is a face description: warned, in plain words", () => {
    expect(describesClothes(FACE_TEXT)).toBe(false);
    expect(outfitWarning(FACE_TEXT)).toMatch(/^Outfit describes a face, not clothes/);
    expect(outfitWarning("floor-length white A-line gown, long sheer veil")).toBeNull();
    expect(outfitWarning("")).toBeNull();
  });
  it("sorts sentences and clauses: clothes stay, face and hair go", () => {
    const r = sortCardText("Long dark wavy hair and hazel eyes. White lace gown with long sleeves, a sweetheart neckline and a cathedral veil. Soft natural makeup.");
    expect(r.clothes).toBe("White lace gown with long sleeves, a sweetheart neckline and a cathedral veil.");
    expect(r.face).toBe("Long dark wavy hair and hazel eyes. Soft natural makeup.");
    const mixed = sortCardText("She has long blonde hair, wears a navy wool coat and ankle boots");
    expect(mixed.face).toBe("She has long blonde hair.");
    expect(mixed.clothes).toMatch(/navy wool coat/);
    expect(sortCardText(FACE_TEXT).clothes).toBe("");
  });
  it("the outfit split keeps clothes only, even when the model describes the face", () => {
    const s = parseSplit(JSON.stringify({ closeups: FACE_TEXT, front: "White gown, satin belt.", back: "Low back with buttons." }), "White gown");
    expect(s).toMatchObject({ closeups: "", front: "White gown, satin belt.", back: "Low back with buttons." });
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-tidy-"));
const wsDir = path.join(root, "workspace");
const pics = path.join(root, "pics");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;

beforeAll(() => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(pics, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=600x800", "-frames:v", "1", path.join(pics, "white.png"));
  ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=600x800", "-frames:v", "1", path.join(pics, "gray.png"));
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
}, 60_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

// A made pack for the card's current version (the views as plain pictures) and a description, ready to lock.
function fillPack(id: string, picture: string) {
  const r = cardRoot(ws, getCard(ws, id));
  const f = readCardFile(r);
  const dir = path.join(r, `v${f.versions[f.versions.length - 1].n}`);
  mkdirSync(dir, { recursive: true });
  for (const v of VIEWS) copyFileSync(path.join(pics, picture), path.join(dir, `${v.id}.png`));
  updateDraft(ws, id, { description: "A bride." });
}

describe("Edit → new version, songs keep their version until the user answers", () => {
  let id: string;
  let songA: string;
  let songB: string;
  it("the thumbnail: the user's own picture (or a cover) until locked, then the locked close-up", async () => {
    id = createCard(ws, { kind: "character", name: "Bride", picture: readFileSync(path.join(pics, "white.png")), fileName: "bride.png" }).id;
    fillPack(id, "white.png");
    let c = listCards(ws).find((x) => x.id === id)!;
    expect(c.thumbnail).toBe(readCardFile(cardRoot(ws, getCard(ws, id))).reference); // a draft pack never stands for the card
    expect(c.picture).toBe("v1/closeup.png"); // songs still get the draft's close-up (nothing locked yet)
    setCover(ws, id, "v1/body_front.png");
    expect(listCards(ws).find((x) => x.id === id)!.thumbnail).toBe("v1/body_front.png");
    expect(() => setCover(ws, id, "../secret.png")).toThrow(/own pictures/);
    for (const [n, t] of ["Song A", "Song B"].entries()) {
      const song = path.join(root, `${t}.wav`);
      makeSong(song, 4 + n);
      const sid = (await findOrCreateSongProject(ws, song)).project.id;
      setCast(ws, sid, [id]);
      if (n === 0) songA = sid;
      else songB = sid;
    }
    expect(lockForSongs(ws, id)).toBeNull(); // the first lock: nothing to ask
    c = listCards(ws).find((x) => x.id === id)!;
    expect(c.thumbnail).toBe("v1/closeup.png");
    expect(songsUsingCard(ws, id).map((s) => s.version)).toEqual([1, 1]);
  }, 60_000);

  it("v2 draft: copied from v1, songs keep v1's pictures; locking keeps them on v1 and asks", () => {
    newVersion(ws, id);
    const r = cardRoot(ws, getCard(ws, id));
    expect(readFileSync(path.join(r, "v2", "closeup.png"))).toEqual(readFileSync(path.join(r, "v1", "closeup.png")));
    fillPack(id, "gray.png"); // v2's pictures change
    const c = listCards(ws).find((x) => x.id === id)!;
    expect([c.picture, c.thumbnail, c.draft]).toEqual(["v1/closeup.png", "v1/closeup.png", 2]); // the draft reaches no song
    expect(shotLooks(ws, songA)({ characters: ["Bride"] })[0]).toMatchObject({ picture: "v1/closeup.png", viewDir: "v1" });
    const ask = lockForSongs(ws, id)!;
    expect(ask).toMatchObject({ from: 1, to: 2, name: "Bride" });
    expect(ask.songs.map((s) => s.id).sort()).toEqual([songA, songB].sort());
    // Until answered: both songs still on v1.
    expect(readProduction(songPathsById(ws, songA).root).versions).toEqual({ [id]: 1 });
    const castA = productionData(ws, songA).cast[0] as { thumbnail: string; version: number | null; pinned: boolean };
    expect(castA).toMatchObject({ thumbnail: "v1/closeup.png", version: 1, pinned: true });
    // Paul switches Song A only; Song B stays on v1.
    expect(switchSongs(ws, id, [songA])).toBe(1);
    expect(readProduction(songPathsById(ws, songA).root).versions).toEqual({});
    expect(shotLooks(ws, songA)({ characters: ["Bride"] })[0]).toMatchObject({ picture: "v2/closeup.png", viewDir: "v2" });
    expect(shotLooks(ws, songB)({ characters: ["Bride"] })[0]).toMatchObject({ picture: "v1/closeup.png", viewDir: "v1" });
    expect(songsUsingCard(ws, id).map((s) => [s.title, s.version])).toEqual([["Song A", 2], ["Song B", 1]]);
    // Later, from the card page: Song B to the version in use.
    setSongCardVersion(ws, songB, id, null);
    expect(readProduction(songPathsById(ws, songB).root).versions).toEqual({});
    expect(() => setSongCardVersion(ws, songB, id, 7)).toThrow(/not a locked version/);
    // v1 was never touched.
    expect(readCardFile(r).versions.map((v) => v.status)).toEqual(["locked", "locked"]);
  });
});

describe("Tidy texts", () => {
  it("face words leave the Outfit and its three parts for the Notes; clothes stay; a locked version is left alone", () => {
    const id = createCard(ws, { kind: "character", name: "SomeoneToLove-Character-Female", picture: readFileSync(path.join(pics, "white.png")), fileName: "f.png" }).id;
    const outfit = `${FACE_TEXT} Cream knit sweater and blue jeans.`;
    const r = cardRoot(ws, getCard(ws, id));
    const f = readCardFile(r);
    f.versions[0].outfit = outfit;
    f.versions[0].outfit_split = { from: outfit, closeups: FACE_TEXT, front: `${FACE_TEXT} Cream knit sweater, blue jeans.`, back: FACE_TEXT };
    f.notes = "Warm and shy.";
    writeCardFile(r, f);
    const res = tidyCardTexts(ws, id);
    expect(res.moved).toBe(1);
    const after = readCardFile(r);
    const v = after.versions[0];
    expect(v.outfit).toBe("Cream knit sweater and blue jeans.");
    expect(v.outfit_split).toMatchObject({ from: v.outfit, closeups: "", front: "Cream knit sweater, blue jeans.", back: "" });
    expect(after.notes).toContain("Warm and shy.");
    expect(after.notes).toContain("hazel eyes");
    expect(tidyCardTexts(ws, id).moved).toBe(0); // nothing left to move
  });
});

describe("the Reel singing target: the Reel's own part", () => {
  it("reads the saved Reels shot plan's range (else TikTok's, else none)", () => {
    const song = path.join(root, "reel-song");
    mkdirSync(path.join(song, "storyboards"), { recursive: true });
    expect(reelRange(song)).toBeNull();
    const plan = (start: number, end: number) => ({ schemaVersion: 1, shots: [], output: { range: { mode: "auto", startMs: start, endMs: end, reason: "", locked: [] } } });
    writeFileSync(path.join(song, "storyboards", "tiktok-1.json"), JSON.stringify(plan(10_000, 70_000)));
    expect(reelRange(song)).toMatchObject({ startMs: 10_000, endMs: 70_000, platform: "TikTok" });
    writeFileSync(path.join(song, "storyboards", "reels-1.json"), JSON.stringify(plan(42_000, 101_500)));
    expect(reelRange(song)).toEqual({ startMs: 42_000, endMs: 101_500, platform: "Reel" });
  });
});
