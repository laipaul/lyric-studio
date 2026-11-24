// Creation → Production (C3 Part 1, 22 Nov 2026): the shot list's items in story order and grouped by section; a
// Creation picture belongs to an item; "Use this take" fills the item in its place in the story line and on its lyric
// line; a second take replaces the first there (Omit, never deleted); a re-import keeps filled items filled; "Remove all
// planned slots" takes out the empty ones only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { card as cardTable, openWorkspace, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, readClipEdits, readRecipe, songPathsById } from "../src/node";
import { addPictures, picturesView, removePicture, restorePicture } from "../src/node/animate";
import { createCard } from "../src/node/characters/cards";
import { placeByName, productionView, sectionsOfShots, setPictureShot, shotForFileName, useForShot, withLineStarts } from "../src/node/shot-production";
import { midjourneyLink } from "../src/node/animate";
import { importShotList, readShotList, removeSlots, setShotLook, setShotScene, slotKey } from "../src/node/shotlist";
import { productionData, setCast } from "../src/node/production";
import { shotLooks } from "../src/node/shot-looks";
import { addLook, LOOKS_DIR } from "../src/node/characters/looks";
import { cardRoot, listCards } from "../src/node/characters/cards";
import { songStory } from "../src/node/story-line";
import { shotListScript } from "../src/node/shot-script";
import { referencePrompt, shotReferences, startShotReferences } from "../src/node/shot-references";
import { runTakes } from "../src/node/animate";
import { isWholeStory } from "../src/node/make";
import { folderClips, songClipsCollection } from "../src/node/assets";
import { LYRICS, ffmpeg, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-shot-production-"));
const wsDir = path.join(root, "workspace");
let ws: Workspace;
let id: string;
let songRoot: string;
const previousWorkspace = process.env.WORKSPACE_DIR;

const list = {
  slots: [
    { id: "s01", order: 1, shows: "The empty chapel in morning light", characters: [], scene: null, shot: "wide" },
    { id: "s02", order: 2, shows: "She walks in on her father's arm", characters: ["Bride"], scene: null, shot: "medium", line: 1 },
    { id: "s03", order: 3, shows: "Close on her smile", characters: ["Bride"], scene: null, shot: "close-up", line: 3 },
    { id: "s04", order: 4, shows: "Petals in the light", characters: [], scene: null, shot: "detail" },
  ],
};

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "Production Song.wav");
  makeSong(song, 6);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  makeClip(path.join(paths.clips!, "01_own.mp4"), 1, "red");
  const pic = path.join(root, "p.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=60x80", "-frames:v", "1", pic);
  createCard(ws, { kind: "character", name: "Bride", picture: readFileSync(pic), fileName: "p.png" });
  ws.db.update(cardTable).set({ status: "locked" }).where(eq(cardTable.name, "Bride")).run();
  await importShotList(ws, id, list, "shots.json");
  // Three Creation items: two short videos (used as they are) and a picture.
  for (const [n, c] of [["walk-in.mp4", "blue"], ["walk-in v2.mp4", "green"]] as const) makeClip(path.join(root, n), 1, c);
  await addPictures(ws, id, [
    { file: path.join(root, "walk-in.mp4"), name: "walk-in.mp4" },
    { file: path.join(root, "walk-in v2.mp4"), name: "walk-in v2.mp4" },
    { file: pic, name: "smile.png" },
  ]);
}, 120_000);
afterAll(() => {
  ws?.close();
  process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("sections of shots", () => {
  it("a shot without a line follows the shot before it; before any line: Intro; after the last line: Ending", () => {
    const named = [
      { line: 1, kind: "verse" as const, name: "Verse 1", lastLine: 2 },
      { line: 3, kind: "chorus" as const, name: "Chorus", lastLine: 4 },
    ];
    expect(sectionsOfShots([{ line: null }, { line: 1 }, { line: null }, { line: 3 }, { line: 4 }, { line: null }], named, 4)).toEqual(["Intro", "Verse 1", "Verse 1", "Chorus", "Chorus", "Ending"]);
  });
});

describe("withLineStarts (Compare plays the song from the shot's line)", () => {
  it("a shot on a timed line gets its start; a music-only shot or an untimed line gets null", () => {
    const view = { sections: [], shots: [{ line: 1 }, { line: null }, { line: 4 }] } as unknown as Parameters<typeof withLineStarts>[0];
    expect(withLineStarts(view, [{ number: 1, startMs: 15100 }, { number: 4, startMs: null }]).shots.map((s) => s.lineStartMs)).toEqual([15100, null, null]);
  });
});

describe("file names (23 Nov 2026): Open in Midjourney, and bulk drop by shot", () => {
  it("a Midjourney download links to its job and image", () => {
    expect(midjourneyLink("lifelyrics_Ultra-realistic_bridal_5813efa3-57ba-409f-8aa1-09b60e1b9c83_1.mp4")).toBe("https://www.midjourney.com/jobs/5813efa3-57ba-409f-8aa1-09b60e1b9c83?index=1");
    expect(midjourneyLink("x_5813EFA3-57BA-409F-8AA1-09B60E1B9C83.png")).toBe("https://www.midjourney.com/jobs/5813efa3-57ba-409f-8aa1-09b60e1b9c83");
    expect(midjourneyLink("x_5813efa3-57ba-409f-8aa1-09b60e1b9c83_0 (2).png")).toBe("https://www.midjourney.com/jobs/5813efa3-57ba-409f-8aa1-09b60e1b9c83?index=0");
    expect(midjourneyLink("Shot1Chapel.png")).toBeNull();
  });
  it("a file named after its shot: s05, S05_, s5, shot 5, Shot1Chapel; others stay loose", () => {
    const shots = Array.from({ length: 12 }, (_, i) => ({ id: `s${String(i + 1).padStart(2, "0")}`, number: i + 1 }));
    expect(["s05 bride veil.png", "S05_bride.png", "s5.png", "shot 5 veil.jpg", "Shot-05.mp4", "Shot1Chapel.png", "s12.png"].map((n) => shotForFileName(n, shots))).toEqual(["s05", "s05", "s05", "s05", "s05", "s01", "s12"]);
    expect(["sunset.png", "summer2024.png", "lifelyrics_x.png", "s99.png", "shots.png", "s051.png"].map((n) => shotForFileName(n, shots))).toEqual([null, null, null, null, null, null]);
  });
});

describe("Creation → Production", () => {
  it("lists the shot list's items in order, numbered, with their line text and no pictures yet", () => {
    const v = productionView(ws, id);
    expect(v.shots.map((s) => [s.number, s.id, s.line, s.filled])).toEqual([[1, "s01", null, null], [2, "s02", 1, null], [3, "s03", 3, null], [4, "s04", null, null]]);
    expect(v.shots[1].lineText).toBe(LYRICS[0]);
    expect(v.shots[0].section).toBe("Intro");
    expect(v.shots.every((s) => s.pictures.length === 0)).toBe(true);
  });

  it("a picture belongs to a shot (and can be taken off it); an unknown shot is refused", async () => {
    setPictureShot(ws, id, "walk-in.mp4", "s02");
    setPictureShot(ws, id, "smile.png", "s03");
    expect(productionView(ws, id).shots.map((s) => s.pictures)).toEqual([[], ["walk-in.mp4"], ["smile.png"], []]);
    expect((await picturesView(ws, id)).pictures.find((p) => p.file === "walk-in.mp4")?.slot).toBe("s02");
    expect(() => setPictureShot(ws, id, "walk-in.mp4", "s99")).toThrow(/not in this song's shot list/);
    setPictureShot(ws, id, "smile.png", null);
    expect(productionView(ws, id).shots[2].pictures).toEqual([]);
  });

  it("Use this take fills the item: in the slot's place in the story line and on its lyric line", async () => {
    const used = await useForShot(ws, id, { file: "walk-in.mp4", slot: "s02" });
    expect(used).toMatchObject({ shot: 2, line: 1, replaced: null, note: null });
    const order = readClipEdits(songRoot).order;
    expect(order).not.toContain(slotKey("s02"));
    expect(order.indexOf(used.clip)).toBe(order.indexOf(slotKey("s01")) + 1); // right after shot 1, where shot 2 was
    expect(readRecipe(songPathsById(ws, id).recipe!).anchors).toEqual([{ line: 1, clip: used.clip }]);
    expect(productionView(ws, id).shots[1].filled).toBe(used.clip);
    expect(readShotList(ws, id)?.filled).toEqual({ s02: used.clip });
    // The Storyboard card keeps the shot's story (23 Nov 2026: "once I move the shot it loses the story line").
    const own = (await folderClips(ws, songPathsById(ws, id).clips!, songClipsCollection(id))).clips;
    const card = (await songStory(ws, id, own)).items.find((x) => x.key === used.clip);
    expect([card?.shot?.id, card?.shot?.number, card?.shot?.shows, card?.shot?.line]).toEqual(["s02", 2, "She walks in on her father's arm", 1]);
  });

  it("another take for the same item replaces the first there (set to Omit, kept)", async () => {
    const first = readShotList(ws, id)!.filled!.s02;
    const second = await useForShot(ws, id, { file: "walk-in v2.mp4", slot: "s02" });
    expect(second.replaced).toBe(first);
    const edits = readClipEdits(songRoot);
    expect(edits.order.indexOf(second.clip)).toBe(edits.order.indexOf(slotKey("s01")) + 1);
    expect(Object.entries(edits.clips).find(([c]) => c.toLowerCase() === first.toLowerCase())?.[1].omit).toBe(true);
    expect(readRecipe(songPathsById(ws, id).recipe!).anchors).toEqual([{ line: 1, clip: second.clip }]);
  });

  it("Use picture for shot: a still picture fills its shot as a photo, in its place and on its line", async () => {
    setPictureShot(ws, id, "smile.png", "s03");
    const used = await useForShot(ws, id, { file: "smile.png", slot: "s03" });
    expect(used).toMatchObject({ shot: 3, line: 3 });
    const order = readClipEdits(songRoot).order;
    expect(order).not.toContain(slotKey("s03"));
    expect(order.indexOf(used.clip)).toBe(order.indexOf(readShotList(ws, id)!.filled!.s02) + 1);
    expect((readRecipe(songPathsById(ws, id).recipe!).anchors ?? []).find((a) => a.line === 3)?.clip).toBe(used.clip);
  });

  it("a re-import keeps filled items filled; Remove all planned slots takes out the empty ones only", async () => {
    const clip = readShotList(ws, id)!.filled!.s02;
    const photo = readShotList(ws, id)!.filled!.s03;
    await importShotList(ws, id, list, "shots.json");
    expect(readShotList(ws, id)?.filled).toEqual({ s02: clip, s03: photo });
    const order = readClipEdits(songRoot).order;
    expect(order).not.toContain(slotKey("s02"));
    expect(order.filter((e) => e.startsWith("slot:"))).toEqual(["slot:s01", "slot:s04"]);
    expect(removeSlots(ws, id, null)).toBe(2);
    expect(readShotList(ws, id)?.slots.map((s) => s.id)).toEqual(["s02", "s03"]);
    expect(readClipEdits(songRoot).order).toContain(clip);
  });

  it("✕ Put aside: the picture leaves Creation (file to pictures\\_removed\\), Restore brings it back with its shot", async () => {
    setPictureShot(ws, id, "walk-in.mp4", "s02");
    removePicture(ws, id, "walk-in.mp4");
    let v = await picturesView(ws, id);
    expect(v.pictures.map((p) => p.file)).not.toContain("walk-in.mp4");
    expect(v.removedPictures.map((r) => [r.file, r.slot])).toEqual([["walk-in.mp4", "s02"]]);
    expect(existsSync(path.join(songRoot, "pictures", "_removed", "walk-in.mp4"))).toBe(true);
    expect(productionView(ws, id).shots.find((x) => x.id === "s02")?.pictures).not.toContain("walk-in.mp4");
    restorePicture(ws, id, "walk-in.mp4");
    v = await picturesView(ws, id);
    expect(v.pictures.find((p) => p.file === "walk-in.mp4")?.slot).toBe("s02");
    expect(v.removedPictures).toEqual([]);
    expect(() => restorePicture(ws, id, "walk-in.mp4")).toThrow(/not among the pictures put aside/);
  });

  it("the look each person wears in a shot: named by the shot, else the song's; its outfit, picture and problems", async () => {
    const bride = listCards(ws).find((c) => c.name === "Bride")!;
    const autumn = addLook(ws, bride.id, { name: "Autumn City", outfit: "A long camel wool coat over a cream turtleneck." });
    const root = cardRoot(ws, bride);
    mkdirSync(path.join(root, LOOKS_DIR, autumn.id), { recursive: true });
    writeFileSync(path.join(root, LOOKS_DIR, autumn.id, "closeup.png"), readFileSync(path.join(songRoot, "pictures", "smile.png")));
    const worn = shotLooks(ws, id);
    const plain = worn({ characters: ["Bride"] })[0];
    expect([plain.look, plain.fromShot, plain.looks]).toEqual(["Main look", false, ["Main look", "Autumn City"]]);
    const inAutumn = worn({ characters: ["bride"], looks: { BRIDE: "autumn city" } })[0];
    expect([inAutumn.look, inAutumn.fromShot, inAutumn.outfit, inAutumn.picture]).toEqual(["Autumn City", true, "A long camel wool coat over a cream turtleneck.", `${LOOKS_DIR}/${autumn.id}/closeup.png`]);
    expect(inAutumn.problem).toMatch(/not locked yet/);
    expect(worn({ characters: ["Bride"], looks: { Bride: "Gala" } })[0].problem).toMatch(/no look "Gala"/);

    // Chosen in Production for shot 2: its prompt and reference picture follow; a re-import keeps it.
    setShotLook(ws, id, "s02", "Bride", "Autumn City");
    const shot2 = productionView(ws, id).shots.find((x) => x.id === "s02")!;
    expect(shot2.people[0].look).toBe("Autumn City");
    expect(shot2.prompt).toContain("wearing a long camel wool coat over a cream turtleneck");
    expect(shot2.refs[0].file).toBe(`${LOOKS_DIR}/${autumn.id}/closeup.png`);
    await importShotList(ws, id, list, "shots.json");
    expect(readShotList(ws, id)?.slots.find((x) => x.id === "s02")?.looks).toEqual({ Bride: "Autumn City" });
    // A look chosen for the shot wins over the shot's own outfit text (that text is for people without such a look).
    expect(shotLooks(ws, id)({ characters: ["Bride"], looks: { Bride: "Autumn City" } })[0].fromShot).toBe(true);
    setShotLook(ws, id, "s02", "Bride", null);
    expect(readShotList(ws, id)?.slots.find((x) => x.id === "s02")?.looks).toBeUndefined();
    expect(() => setShotLook(ws, id, "s02", "Groom", "Main look")).toThrow(/not in this shot/);
  });

  it("a shot list can name the looks: checked against the wardrobe, saved as the card spells them", async () => {
    const check = await importShotList(ws, id, { slots: [{ ...list.slots[1], looks: { bride: "AUTUMN CITY" } }, { ...list.slots[2], looks: { Bride: "Gala", Nobody: "x" } }] }, "shots.json");
    expect(readShotList(ws, id)?.slots.find((x) => x.id === "s02")?.looks).toEqual({ Bride: "Autumn City" });
    expect(check.problems.map((p) => p.text).join(" | ")).toMatch(/no look "Gala".*\| .*Nobody, who is not among/);
  });

  it("placeByName: the files just added named after a shot belong to it", async () => {
    const pic = path.join(root, "s03-new.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=0x334455:s=60x80", "-frames:v", "1", pic);
    makeClip(path.join(root, "mj.mp4"), 1, "purple");
    await addPictures(ws, id, [{ file: pic, name: "s03 close on her.png" }, { file: path.join(root, "mj.mp4"), name: "chapel_5813efa3-57ba-409f-8aa1-09b60e1b9c83_2.mp4" }]);
    expect(placeByName(ws, id, ["s03 close on her.png", "chapel_5813efa3-57ba-409f-8aa1-09b60e1b9c83_2.mp4"])).toEqual({ "s03 close on her.png": 2 }); // slot s03 is the 2nd shot of the list imported just before (s02, s03)
    const v = await picturesView(ws, id);
    expect(v.pictures.find((p) => p.file === "s03 close on her.png")?.slot).toBe("s03");
    expect(v.pictures.find((p) => p.file.startsWith("chapel_"))?.mjLink).toBe("https://www.midjourney.com/jobs/5813efa3-57ba-409f-8aa1-09b60e1b9c83?index=2");
  });

  it("only a Mini film is the whole story (its two films); a shot list alone, Cut to the song, Add singing and instrumentals are not", () => {
    const recipe = readRecipe(songPathsById(ws, id).recipe!);
    expect(isWholeStory({ ...recipe, songStyle: "film" }, false)).toBe(true);
    expect(isWholeStory({ ...recipe, songStyle: undefined }, false)).toBe(false);
    expect(isWholeStory({ ...recipe, songStyle: "singing" }, false)).toBe(false);
    expect(isWholeStory({ ...recipe, songStyle: "cut" }, false)).toBe(false);
    expect(isWholeStory({ ...recipe, songStyle: "film" }, true)).toBe(false);
  });

  it("Make with references: the shot's people (in this shot's look) and place go to reference-to-video; the takes come back on the shot", async () => {
    const shot = productionView(ws, id).shots.find((x) => x.id === "s03")!;
    const refs = shotReferences(ws, shot);
    expect(refs.map((r) => r.name)).toEqual([`Bride · ${shot.people[0].look}`]);
    const prompt = referencePrompt(shot, refs);
    expect(prompt).toMatch(/^@Image 1 is Bride's face reference sheet: the same face, hair and makeup from different angles, as in their ".+" look\. Keep each person's face, hair and outfit exactly as in their sheets/);
    // An outfit sheet: named as such, cropped at the neck.
    const withOutfit = referencePrompt(shot, [refs[0], { name: `${refs[0].name} (outfit)`, file: refs[0].file, who: "Bride", role: "outfit", panels: ["front", "back"] }]);
    expect(withOutfit).toMatch(/@Image 2 is Bride's outfit reference sheet \(".+"\) \(left to right: front, back\), cropped at the neck: wear exactly this/);
    expect(prompt).not.toMatch(/--ar|--style|--no/);
    // A shot that is not in the list (the earlier tests left s02 and s03): said in plain words, nothing recorded.
    expect(() => startShotReferences(ws, id, { slot: "s01" }, { LYRIC_GENERATE_STUB: "1" })).toThrow(/not in this song's shot list/);
    // Above the cap: refused, nothing sent.
    expect(() => startShotReferences(ws, id, { slot: "s03", seconds: 30, takes: 6, capUsd: 1 }, { LYRIC_GENERATE_STUB: "1" })).toThrow(/above your cap/);

    const started = startShotReferences(ws, id, { slot: "s03", shape: "16:9", seconds: 4.2, takes: 2 }, { LYRIC_GENERATE_STUB: "1" });
    expect(started.file).toBe("s03 references 16x9.png");
    expect(started.takes.map((t) => [t.kind, t.aspect, t.seconds, t.status])).toEqual([["references", "16:9", 5, "running"], ["references", "16:9", 5, "running"]]);
    expect(started.takes[0].refFiles?.[0]).toMatch(/^characters\//);
    await runTakes(() => openWorkspace(wsDir), id, started.file, started.takes.map((t) => t.n), { env: { LYRIC_GENERATE_STUB: "1" }, sleep: async () => {} });
    const v = await picturesView(ws, id, { LYRIC_GENERATE_STUB: "1" });
    const item = v.pictures.find((p) => p.file === started.file)!;
    expect(item.slot).toBe("s03");
    expect(item.source).toBe("Character references");
    expect(item.takes.map((t) => [t.status, t.refNames])).toEqual([["done", refs.map((r) => r.name)], ["done", refs.map((r) => r.name)]]);
    expect(item.takes[0].prompt).toBe(prompt);

    // With a camera guide (a video of the shot): sent as @Video 1, its name kept on the take; not a video: refused.
    const guided = startShotReferences(ws, id, { slot: "s03", guide: "walk-in.mp4", takes: 1 }, { LYRIC_GENERATE_STUB: "1" });
    expect(guided.guide).toBe("walk-in.mp4");
    // Sent blurred (no face to copy): its own file next to the takes.
    expect(guided.takes[0].guideFile).toMatch(/pictures\/takes\/walk-in \(camera guide v1\)\.mp4$/);
    expect(existsSync(path.join(wsDir, guided.takes[0].guideFile!))).toBe(true);
    expect(guided.takes[0].prompt).toContain("@Video 1 is a deliberately blurred guide for the camera only");
    expect(() => startShotReferences(ws, id, { slot: "s03", guide: "smile.png" }, { LYRIC_GENERATE_STUB: "1" })).toThrow(/not one of this song's videos/);
    expect(() => startShotReferences(ws, id, { slot: "s03", guide: "../song.json" }, { LYRIC_GENERATE_STUB: "1" })).toThrow(/not one of this song's videos/);
    await runTakes(() => openWorkspace(wsDir), id, guided.file, guided.takes.map((t) => t.n), { env: { LYRIC_GENERATE_STUB: "1" }, sleep: async () => {} });
    const after = (await picturesView(ws, id, { LYRIC_GENERATE_STUB: "1" })).pictures.find((p) => p.file === guided.file)!;
    expect(after.takes.at(-1)?.status).toBe("done");
  });

  it("the Place of a shot (24 Nov 2026): a scene card of the cast, for a shot or its section; it goes with the shot and survives a re-import", async () => {
    const pic = path.join(root, "p.png");
    const chapel = createCard(ws, { kind: "scene", name: "Chapel", picture: readFileSync(pic), fileName: "chapel.png" });
    setCast(ws, id, [...productionData(ws, id).cast.filter((c) => !("missing" in c && c.missing)).map((c) => c.id), chapel.id]);
    expect(productionView(ws, id).places).toEqual(["Chapel"]);
    expect(setShotScene(ws, id, ["s02", "s03"], "chapel")).toBe(2);
    const shot = productionView(ws, id).shots.find((x) => x.id === "s03")!;
    expect(shot.scene).toBe("Chapel");
    expect(shot.refs.map((r) => r.name)).toContain("Chapel");
    expect(shotReferences(ws, shot).map((r) => r.role)).toContain("place");
    expect(referencePrompt(shot, shotReferences(ws, shot))).toMatch(/@Image \d is the place "Chapel"/);
    // A re-import that names no place keeps the one chosen here.
    const current = readShotList(ws, id)!;
    await importShotList(ws, id, { slots: current.slots.map((x) => ({ ...x, scene: null })) }, "shots.json");
    expect(readShotList(ws, id)?.slots.find((x) => x.id === "s03")?.scene).toBe("Chapel");
    expect(setShotScene(ws, id, "s03", null)).toBe(1);
    expect(readShotList(ws, id)?.slots.find((x) => x.id === "s03")?.scene).toBeNull();
    expect(() => setShotScene(ws, id, "s03", "Beach")).toThrow(/not one of your scene cards/);
    expect(() => setShotScene(ws, id, "s99", "Chapel")).toThrow(/not in this song's shot list/);
  });

  it("the shot list as a readable script (for a platform that takes a script): cast and looks, places, shots by section; never JSON", async () => {
    const script = await shotListScript(ws, id);
    expect(script).toMatch(/^# Production Song: shot list\n/);
    expect(script).toContain("## Cast");
    expect(script).toMatch(/### Bride\n/);
    expect(script).toMatch(/- Look ".+": /);
    expect(script).toContain("## Places");
    expect(script).toContain("- **Chapel**");
    expect(script).toContain("## Shots");
    expect(script).toMatch(/\*\*Shot 1\*\* · medium/);
    expect(script).toContain("Close on her smile");
    expect(script).toMatch(/People: Bride \(.+\)/);
    expect(script).toMatch(/Lyric: ".+"/);
    expect(script).not.toMatch(/"slots"|"order":|\{ "id"/);
  });

  it("reference sheets (25 Nov 2026): per person a face sheet (close-up, 3/4, teeth) and an outfit sheet (front, back), each one picture", async () => {
    const bride = listCards(ws).find((c) => c.name === "Bride")!;
    const root = cardRoot(ws, bride);
    const versionDir = path.join(root, path.dirname(bride.thumbnail));
    const look = readShotList(ws, id)!.slots.find((x) => x.id === "s03")!;
    // Shot 3 in the Autumn City look (its close-up exists): add the card's 3/4 face and teeth close-up, and the look's front and back.
    setShotLook(ws, id, "s03", "Bride", "Autumn City");
    const autumn = productionView(ws, id).shots.find((x) => x.id === "s03")!.people[0].lookId;
    const color = (c: string, f: string) => ffmpeg("-f", "lavfi", "-i", `color=c=${c}:s=300x400`, "-frames:v", "1", f);
    color("blue", path.join(versionDir, "three_quarter.png"));
    color("green", path.join(versionDir, "closeup_teeth.png"));
    color("red", path.join(root, LOOKS_DIR, autumn, "body_front.png"));
    color("yellow", path.join(root, LOOKS_DIR, autumn, "body_back.png"));
    const shot = productionView(ws, id).shots.find((x) => x.id === look.id)!;
    const refs = shotReferences(ws, shot);
    expect(refs.map((r) => [r.role, r.panels])).toEqual([["face", ["close-up", "3/4", "smiling, teeth visible"]], ["outfit", ["front", "back"]]]);
    for (const r of refs) expect(r.file).toMatch(/cache[\\/]refsheets[\\/][0-9a-f]+\.png$/);
    const size = (f: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).trim();
    expect(size(refs[0].file)).toBe(`${Math.round(1024 * 0.75) * 3},1024`); // three 3:4 panels, 1024 high
    expect(referencePrompt(shot, refs)).toMatch(/@Image 1 is Bride's face reference sheet \(left to right: close-up, 3\/4, smiling, teeth visible\)/);
    expect(referencePrompt(shot, refs)).toMatch(/@Image 2 is Bride's outfit reference sheet \("Autumn City"\) \(left to right: front, back\)/);
  });
});
