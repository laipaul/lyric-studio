// G1 Prepare → Production: the cast linked from the shared library (never copied), the song's own or the EP's shared
// story bible (an earlier text kept in Replaced files, with a Restore), the Song brief (lyrics with times, sizes, cast,
// bible, the shot list format) and reading a pasted answer (a shot list, also inside a ```json block, or a bible).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { card as cardTable, openWorkspace, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, songPathsById } from "../src/node";
import { createCard } from "../src/node/characters/cards";
import { epBibleFile, productionData, readPasted, readProduction, saveBible, setBibleSource, setCast, songBrief, type TimedLine } from "../src/node/production";
import { readRecipe, writeRecipe } from "../src/node/recipe";
import { restoreReplacedFile, songReplacedFiles } from "../src/node/replaced-files";
import { checkSongShotList } from "../src/node/shotlist";
import { LYRICS, ffmpeg, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-production-"));
const wsDir = path.join(root, "workspace");
let ws: Workspace;
let id: string;
let other: string;
let songRoot: string;
const cards: Record<string, string> = {};
const previousWorkspace = process.env.WORKSPACE_DIR;

const timed: TimedLine[] = LYRICS.map((t, i) => ({ number: i + 1, text: t.replace(/^\*\s*/, ""), isHook: t.startsWith("*"), startMs: 6000 + i * 3000, endMs: 8000 + i * 3000 }));

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  for (const [title, out] of [["Production Song", "a"], ["Other EP Song", "b"]] as const) {
    const song = path.join(root, `${title}.wav`);
    makeSong(song, out === "a" ? 4 : 5); // another length: another song (the same sound would be the same song)
    const pid = (await findOrCreateSongProject(ws, song)).project.id;
    if (out === "a") id = pid;
    else other = pid;
  }
  const paths = songPathsById(ws, id);
  songRoot = paths.root;
  writeFileSync(paths.lyricsTxt, `${LYRICS.join("\n")}\n`);
  const pic = path.join(root, "p.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=60x80", "-frames:v", "1", pic);
  for (const [kind, name] of [["character", "Bride No 2"], ["character", "Bridegroom"], ["scene", "Beach path"]] as const)
    cards[name] = createCard(ws, { kind, name, picture: readFileSync(pic), fileName: "p.png" }).id;
  ws.db.update(cardTable).set({ status: "locked" }).where(eq(cardTable.name, "Bride No 2")).run();
});
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("the cast", () => {
  it("links cards from the shared library by id, in the order chosen; the card folders are not copied", () => {
    expect(productionData(ws, id).cast).toEqual([]);
    expect(setCast(ws, id, [cards["Bride No 2"], cards["Beach path"], cards["Bride No 2"]])).toEqual([cards["Bride No 2"], cards["Beach path"]]);
    const d = productionData(ws, id);
    expect(d.cast.map((c) => c.name)).toEqual(["Bride No 2", "Beach path"]);
    expect(d.cast[0]).toMatchObject({ kind: "character", locked: true });
    expect(d.library.map((c) => c.name)).toEqual(["Beach path", "Bride No 2", "Bridegroom"]);
    expect(readProduction(songRoot).cast).toEqual([cards["Bride No 2"], cards["Beach path"]]);
    expect(existsSync(path.join(songRoot, "production", "characters"))).toBe(false);
  });
  it("refuses a card that is not in the library", () => {
    expect(() => setCast(ws, id, ["nope"])).toThrow(/no longer in the library/);
  });
  it("a renamed card shows its new name in every song (linked, not copied)", () => {
    ws.db.update(cardTable).set({ name: "Bride Two" }).where(eq(cardTable.id, cards["Bride No 2"])).run();
    expect(productionData(ws, id).cast[0].name).toBe("Bride Two");
    ws.db.update(cardTable).set({ name: "Bride No 2" }).where(eq(cardTable.id, cards["Bride No 2"])).run();
  });
});

describe("the story bible", () => {
  it("the song's own: saved in production\\bible.md; the earlier text goes to Replaced files and can be restored", async () => {
    expect(saveBible(ws, id, "First bible.")).toEqual({ source: "song", changed: true });
    expect(saveBible(ws, id, "First bible.\n")).toEqual({ source: "song", changed: false });
    saveBible(ws, id, "Second bible.");
    expect(readFileSync(path.join(songRoot, "production", "bible.md"), "utf8")).toBe("Second bible.\n");
    const kept = songReplacedFiles(ws, id).find((f) => f.role === "bible");
    expect(kept?.original).toBe("bible.md");
    await restoreReplacedFile(ws, id, kept!.file);
    expect(productionData(ws, id).bible.text).toBe("First bible.\n");
  });
  it("the EP's: needs an EP; shared by the EP's songs that choose it", () => {
    expect(() => setBibleSource(ws, id, "ep")).toThrow(/no EP yet/);
    for (const s of [id, other]) {
      const file = songPathsById(ws, s).recipe ?? path.join(songPathsById(ws, s).root, "song.json");
      writeRecipe(file, { ...readRecipe(existsSync(file) ? file : null), ep: "Wedding Day" });
    }
    setBibleSource(ws, id, "ep");
    saveBible(ws, id, "The EP's world.");
    expect(readFileSync(epBibleFile(ws, "Wedding Day"), "utf8")).toBe("The EP's world.\n");
    setBibleSource(ws, other, "ep");
    expect(productionData(ws, other).bible).toMatchObject({ source: "ep", text: "The EP's world.\n", songs: ["Production Song"] });
    setBibleSource(ws, id, "song");
    expect(productionData(ws, id).bible.text).toBe("First bible.\n"); // its own text was kept
  });
});

describe("the Song brief", () => {
  it("has the timed lyrics, the instrumental parts, the sizes, the cast with descriptions, the bible and the format", () => {
    mkdirSync(path.join(songRoot, "production"), { recursive: true });
    const b = songBrief(ws, id, timed);
    expect(b).toMatch(/^# Song brief: Production Song/);
    expect(b).toContain("- (instrumental 0:00.0–0:06.0)");
    expect(b).toContain("**1.** 0:06.0–0:08.0 · Verse one here");
    expect(b).toContain("Hold on to me _(hook)_");
    expect(b).toContain("9:16 (Reels, TikTok, Shorts, Spotify Canvas) and 16:9 (YouTube)");
    expect(b).toContain("- **Bride No 2** (character)");
    expect(b).toContain("- **Beach path** (scene, not locked yet)");
    expect(b).toContain('"characters": ["Bride No 2"], "scene": "Beach path"');
    expect(b).toContain("First bible.");
    expect(b).toContain("No sound in the clips");
  });
  it("without timing: the lines in order, said so", () => {
    expect(songBrief(ws, id, null)).toContain("(The lines are not timed yet: use the order of the lines.)");
  });
  it("never reads the Storyboard's story idea (the user's own)", () => {
    expect(readFileSync(path.join(__dirname, "../src/node/production.ts"), "utf8")).not.toMatch(/readStoryIdea|clip-notes/);
  });
});

describe("a pasted answer", () => {
  const list = { slots: [{ id: "s01", order: 1, shows: "She walks to the sea", characters: ["Bride No 2"], scene: "Beach path", shot: "wide", line: 1 }] };
  it("a shot list: plain JSON, inside a ```json block with words around it, or a bare list of slots", () => {
    expect(readPasted(JSON.stringify(list))).toMatchObject({ kind: "shotlist", slots: 1 });
    const fenced = readPasted(`Here is your shot list:\n\n\`\`\`json\n${JSON.stringify(list, null, 2)}\n\`\`\`\nEnjoy!`);
    expect(fenced).toMatchObject({ kind: "shotlist", slots: 1 });
    expect(readPasted(JSON.stringify(list.slots))).toMatchObject({ kind: "shotlist", slots: 1 });
    if (fenced.kind === "shotlist") expect(checkSongShotList(ws, id, fenced.json).ok).toBe(true);
  });
  it("other text is a bible; nothing is empty", () => {
    expect(readPasted("# Wedding Day bible\n\nThe world: a coastal town { not json }")).toMatchObject({ kind: "bible" });
    expect(readPasted("   ")).toEqual({ kind: "empty" });
  });
});
