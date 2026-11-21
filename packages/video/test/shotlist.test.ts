// C2 Shot list import: the check in plain words (errors stop the import, warnings do not), the slots' places in the
// story line, re-import by id (new / changed / taken out), the previous shot list kept with a Restore, the story line
// showing the slots with their cards and lyric line, and Make's order untouched by them.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { card as cardTable, openWorkspace, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, readClipEdits, songPathsById } from "../src/node";
import { folderClips, songClipsCollection } from "../src/node/assets";
import { createCard } from "../src/node/characters/cards";
import { inClipOrder } from "../src/node/clip-edits";
import { restoreReplacedFile, songReplacedFiles } from "../src/node/replaced-files";
import { checkShotList, closest, importShotList, placeSlots, readShotList, removeSlots, slotKey, type CheckContext } from "../src/node/shotlist";
import { setStoryOrder, songStory } from "../src/node/story-line";
import { LYRICS, ffmpeg, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-shotlist-"));
const wsDir = path.join(root, "workspace");
let ws: Workspace;
let id: string;
let songRoot: string;
const previousWorkspace = process.env.WORKSPACE_DIR;

const ctx: CheckContext = {
  cards: [
    { name: "Bride No 2", kind: "character", status: "locked" },
    { name: "Bridegroom", kind: "character", status: "draft" },
    { name: "Beach path", kind: "scene", status: "locked" },
  ],
  lines: LYRICS.map((text, i) => ({ number: i + 1, text })),
  previous: [],
};
const good = {
  slots: [
    { id: "s01", order: 1, shows: "She walks along the path toward the sea", characters: ["bride no 2"], scene: "Beach Path", shot: "wide", line: 1, tag: "intro" },
    { id: "s02", order: 3, shows: "He waits, nervous smile", characters: ["Bridegroom"], scene: "Beach path", shot: "close up", line: 3, outfit: "jacket open", animate: "Kling" },
  ],
};

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "Shot List Song.wav");
  makeSong(song, 6);
  id = (await findOrCreateSongProject(ws, song)).project.id;
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  mkdirSync(paths.clips!, { recursive: true });
  for (const [n, c] of [["01_a.mp4", "red"], ["02_b.mp4", "blue"], ["03_c.mp4", "green"]] as const) makeClip(path.join(paths.clips!, n), 1, c);
  const pic = path.join(root, "p.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=60x80", "-frames:v", "1", pic);
  for (const [kind, name] of [["character", "Bride No 2"], ["character", "Bridegroom"], ["scene", "Beach path"]] as const) createCard(ws, { kind, name, picture: readFileSync(pic), fileName: "p.png" });
  ws.db.update(cardTable).set({ status: "locked" }).where(eq(cardTable.name, "Bride No 2")).run();
});
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("the check", () => {
  it("a good shot list: names saved as the cards spell them, shot types read kindly, warnings for unlocked cards", () => {
    const c = checkShotList(JSON.stringify(good), ctx);
    expect(c.ok).toBe(true);
    expect(c.slots[0]).toMatchObject({ id: "s01", characters: ["Bride No 2"], scene: "Beach path", shot: "wide", line: 1, tag: "intro" });
    expect(c.slots[1]).toMatchObject({ shot: "close-up", outfit: "jacket open", animate: "kling" });
    expect(c.problems).toEqual([{ slot: "s02", level: "warn", text: expect.stringMatching(/"Bridegroom" is not locked yet/) }]);
    expect(c.changes.added).toEqual(["s01", "s02"]);
  });

  it("errors in plain words, slot by slot, with did-you-mean", () => {
    const bad = {
      slots: [
        { id: "s01", shows: "x", characters: ["Brde No 2"], shot: "wide" },
        { id: "s01", shows: "", characters: ["Bride No 2"], shot: "aerial", line: 40, colour: "red" },
        { shows: "y", scene: "Moon", shot: "detail" },
      ],
    };
    const c = checkShotList(bad, ctx);
    expect(c.ok).toBe(false);
    const t = c.problems.map((p) => `${p.level} ${p.slot}: ${p.text}`);
    expect(t).toContainEqual(expect.stringMatching(/^error s01: no character called "Brde No 2" \(did you mean Bride No 2\?\)/));
    expect(t).toContainEqual(expect.stringMatching(/^error s01: the id "s01" is used twice/));
    expect(t).toContainEqual(expect.stringMatching(/^error s01: say in one sentence what the slot shows/));
    expect(t).toContainEqual(expect.stringMatching(/"shot" must be one of close-up, medium, wide, detail, motion \(not "aerial"\)/));
    expect(t).toContainEqual(expect.stringMatching(/there is no line 40 \(the lyrics have 6 lines\)/));
    expect(t).toContainEqual(expect.stringMatching(/^warn s01: "colour" is not a shot list field/));
    expect(t).toContainEqual(expect.stringMatching(/^error #3: give the slot an "id"/));
    expect(t).toContainEqual(expect.stringMatching(/^error #3: no scene card called "Moon"/));
    expect(checkShotList("{ not json", ctx).problems[0].text).toMatch(/not valid JSON/);
    expect(checkShotList({ shots: [] }, ctx).problems[0].text).toMatch(/needs a list of slots/);
  });

  it("two slots on one line are flagged; closest() finds near names only", () => {
    const c = checkShotList({ slots: [{ id: "a", shows: "x", characters: ["Bride No 2"], shot: "wide", line: 2 }, { id: "b", shows: "y", scene: "Beach path", shot: "detail", line: 2 }] }, ctx);
    expect(c.problems.some((p) => p.slot === "b" && /line 2 also belongs to a/.test(p.text))).toBe(true);
    expect(closest("Groom", ["Bride No 2", "Bridegroom"])).toBe("Bridegroom");
    expect(closest("Zebra", ["Bride No 2", "Bridegroom"])).toBeNull();
  });

  it("placeSlots: each slot at its place in the line (1 = first), past the end = the end", () => {
    expect(placeSlots(["a", "slot:old", "b", "c"], [{ id: "x", order: 1 } as never, { id: "y", order: 3 } as never, { id: "z", order: 99 } as never])).toEqual(["slot:x", "a", "slot:y", "b", "c", "slot:z"]);
  });
});

describe("import into the song", () => {
  it("shotlist.json and the slots' places; the story line shows them with cards and line; Make's clip order is untouched", async () => {
    const own = (await folderClips(ws, songPathsById(ws, id).clips!, songClipsCollection(id))).clips;
    expect(inClipOrder(readClipEdits(songRoot), own.map((c) => c.name))).toEqual(["01_a.mp4", "02_b.mp4", "03_c.mp4"]);
    await importShotList(ws, id, JSON.stringify(good), "C:\\shots\\wedding.json");
    expect(readShotList(ws, id)).toMatchObject({ source: "wedding.json", slots: [{ id: "s01" }, { id: "s02" }] });
    const story = await songStory(ws, id, own);
    expect(story.items.map((i) => i.key)).toEqual([slotKey("s01"), "01_a.mp4", slotKey("s02"), "02_b.mp4", "03_c.mp4"]);
    const s1 = story.items[0].slot!;
    expect(s1).toMatchObject({ shows: "She walks along the path toward the sea", lineText: "Verse one here", animateWith: "kling", animateIsDefault: true });
    expect(s1.cast[0]).toMatchObject({ name: "Bride No 2", locked: true, thumb: "reference.png" });
    expect(s1.place).toMatchObject({ name: "Beach path", locked: false });
    expect(story.items[2].slot).toMatchObject({ animateWith: "kling", animateIsDefault: false, cast: [{ name: "Bridegroom", locked: false }] });
    // Make ranks only real clips: the slot keys change nothing.
    expect(inClipOrder(readClipEdits(songRoot), own.map((c) => c.name))).toEqual(["01_a.mp4", "02_b.mp4", "03_c.mp4"]);
  });

  it("dragging a slot in the story line is saved like a clip", async () => {
    const own = (await folderClips(ws, songPathsById(ws, id).clips!, songClipsCollection(id))).clips;
    await setStoryOrder(ws, id, ["01_a.mp4", slotKey("s01"), slotKey("s02"), "02_b.mp4", "03_c.mp4"]);
    expect((await songStory(ws, id, own)).items.map((i) => i.key)).toEqual(["01_a.mp4", slotKey("s01"), slotKey("s02"), "02_b.mp4", "03_c.mp4"]);
  });

  it("re-import by id: new, changed and taken out; the previous shot list kept; Restore brings it back", async () => {
    const next = { slots: [{ ...good.slots[0], shows: "She runs along the path" }, { id: "s03", order: 5, shows: "Rings on the sand", scene: "Beach path", shot: "detail" }] };
    const c = await importShotList(ws, id, next, "wedding v2.json");
    expect(c.changes).toEqual({ added: ["s03"], updated: ["s01"], removed: ["s02"], unchanged: [] });
    expect(readClipEdits(songRoot).order.filter((e) => e.startsWith("slot:"))).toEqual([slotKey("s01"), slotKey("s03")]);
    const kept = songReplacedFiles(ws, id).filter((f) => f.role === "shotlist");
    expect(kept).toHaveLength(1);
    expect(kept[0].original).toBe("shotlist.json");
    await restoreReplacedFile(ws, id, kept[0].file);
    expect(readShotList(ws, id)!.slots.map((s) => s.id)).toEqual(["s01", "s02"]);
    expect(songReplacedFiles(ws, id).filter((f) => f.role === "shotlist")).toHaveLength(2); // the v2 list is kept too
  });

  it("an import with errors changes nothing", async () => {
    const before = readFileSync(path.join(songRoot, "shotlist.json"), "utf8");
    await expect(importShotList(ws, id, { slots: [{ id: "x", shows: "y", characters: ["Nobody"], shot: "wide" }] })).rejects.toThrow(/cannot be imported yet: x: no character called "Nobody"/);
    expect(readFileSync(path.join(songRoot, "shotlist.json"), "utf8")).toBe(before);
    expect(existsSync(path.join(songRoot, "shotlist.json"))).toBe(true);
  });

  it("Remove a planned slot, or all of them: they leave the story line, the shot list is kept, Restore brings them back", async () => {
    const own = (await folderClips(ws, songPathsById(ws, id).clips!, songClipsCollection(id))).clips;
    const keptBefore = songReplacedFiles(ws, id).filter((f) => f.role === "shotlist").length;
    expect(removeSlots(ws, id, ["s02"])).toBe(1);
    expect(readShotList(ws, id)!.slots.map((s) => s.id)).toEqual(["s01"]);
    expect((await songStory(ws, id, own)).items.filter((i) => i.slot).map((i) => i.key)).toEqual([slotKey("s01")]);
    expect(() => removeSlots(ws, id, ["nope"])).toThrow(/not in this song's Storyboard/);
    expect(removeSlots(ws, id, null)).toBe(1);
    expect(readShotList(ws, id)).toBeNull();
    expect((await songStory(ws, id, own)).items.some((i) => i.slot)).toBe(false);
    expect(inClipOrder(readClipEdits(songRoot), own.map((c) => c.name))).toEqual(["01_a.mp4", "02_b.mp4", "03_c.mp4"]); // the clips stay
    const kept = songReplacedFiles(ws, id).filter((f) => f.role === "shotlist");
    expect(kept).toHaveLength(keptBefore + 2);
    const onlyS01 = kept.find((f) => readFileSync(path.join(songRoot, ".studio", "replaced", f.file), "utf8").includes('"s01"') && !readFileSync(path.join(songRoot, ".studio", "replaced", f.file), "utf8").includes('"s02"'))!;
    await restoreReplacedFile(ws, id, onlyS01.file); // the list as it was before Remove all
    expect(readShotList(ws, id)!.slots.map((s) => s.id)).toEqual(["s01"]);
    expect(removeSlots(ws, id, null)).toBe(1);
    expect(removeSlots(ws, id, null)).toBe(0); // nothing left
  });
});
