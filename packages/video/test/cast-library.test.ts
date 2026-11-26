// Nextgen sprint step 1 (26 Nov 2026): the Characters library as a cast across every song: face prints per face
// reference (recomputed when a picture changes), the group-photo rule on reference pictures only, notes, Remove /
// Restore, the Storyboard's cast chips (card ids, display only) and the "Copy character for Claude" block.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject, makeVideos, readClipEdits, readRecipe, songPathsById, writeRecipe, type RenderOptions } from "../src/node";
import { songAssets, setSongClipCast } from "../src/node/assets";
import {
  cardRoot, cardTags, characterBlock, checkCardPicture, createCard, getCard, listCards, listRemovedCards, makePictures, readFacePrints, removeCard, restoreCard, setCardNotes, strictFaces, updateFacePrints,
} from "../src/node/characters";
import { stubFace, stubFal } from "../src/node/characters/stub";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-cast-"));
const wsDir = path.join(root, "workspace");
const pics = path.join(root, "pics");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;

beforeAll(() => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(pics, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=600x800", "-frames:v", "1", path.join(pics, "default.png"));
  ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=600x800", "-frames:v", "1", path.join(pics, "other.png"));
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
}, 60_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("the reference check: more than one face", () => {
  const check = (faces: number, ratio: number) => ({ file: "x", measures: { faces, second_face_ratio: ratio }, verdict: "Usable with fix" as const, reasons: [{ level: "fix" as const, text: "2 faces in the picture; the largest one is used.", check: "faces" }], fixes: [] });
  it("a second face at least a quarter the main one's size: Not suitable, in plain words", () => {
    const r = strictFaces(check(2, 0.3));
    expect(r.verdict).toBe("Not suitable");
    expect(r.reasons[0]).toMatchObject({ level: "bad", check: "faces" });
    expect(r.reasons[0].text).toMatch(/^More than one face \(2 in the picture\)/);
    expect(r.reasons.filter((x) => x.check === "faces")).toHaveLength(1);
  });
  it("a small face far in the background stays a fix; one face is untouched", () => {
    expect(strictFaces(check(2, 0.1)).verdict).toBe("Usable with fix");
    const one = { ...check(1, 0), verdict: "Ready" as const };
    expect(strictFaces(one)).toBe(one);
  });
});

describe("a character across songs", () => {
  let id: string;
  it("face prints: one per face reference, with the engine; a replaced picture is redone, the others kept", async () => {
    const c = createCard(ws, { kind: "character", name: "Jennifer", picture: readFileSync(path.join(pics, "default.png")), fileName: "jennifer.png" });
    id = c.id;
    await checkCardPicture(ws, id, stubFace());
    const r = cardRoot(ws, getCard(ws, id));
    let prints = readFacePrints(r)!;
    expect(prints.engine).toEqual({ detector: "stub", recognizer: "stub", version: 1 });
    expect(Object.keys(prints.prints)).toEqual(["reference"]);
    expect(prints.prints.reference!.vector).toHaveLength(128);
    // The pack: its close-up and 3/4 face get their prints.
    await makePictures(ws, id, { fal: stubFal(pics), face: stubFace(), sleep: async () => {} }, { cap: 3 });
    await updateFacePrints(ws, id, stubFace());
    prints = readFacePrints(r)!;
    expect(Object.keys(prints.prints).sort()).toEqual(["closeup", "reference", "three_quarter"]);
    const closeup = prints.prints.closeup!;
    // The reference replaced: only its print changes.
    const file = path.join(r, JSON.parse(readFileSync(path.join(r, "card.json"), "utf8")).reference);
    copyFileSync(path.join(pics, "other.png"), file);
    await updateFacePrints(ws, id, stubFace());
    const after = readFacePrints(r)!;
    expect(after.prints.reference!.sha256).not.toBe(prints.prints.reference!.sha256);
    expect(after.prints.reference!.vector).not.toEqual(prints.prints.reference!.vector);
    expect(after.prints.closeup).toEqual(closeup);
  });

  it("the block for Claude: the Look (Notes) first, then the wardrobe; only the pictures that exist, then Missing; warnings when empty", () => {
    // Without Notes: copied all the same, with the warning.
    const bare = characterBlock(ws, id);
    expect(bare.warnings).toContain("No description yet; add Notes for better prompts");
    expect(setCardNotes(ws, id, "  late 20s, warm and shy, black hair in a low bun  ")).toBe("late 20s, warm and shy, black hair in a low bun");
    const { block, warnings } = characterBlock(ws, id);
    expect(warnings).not.toContain("No description yet; add Notes for better prompts");
    const lines = block.trimEnd().split("\n");
    expect(lines[0]).toBe("CHARACTER LOCK: Jennifer");
    expect(lines[2]).toBe("Look (face, hair, age range, vibe):");
    expect(lines[3]).toBe("late 20s, warm and shy, black hair in a low bun");
    expect(block.indexOf("Look (face")).toBeLessThan(block.indexOf("Wardrobe (looks):"));
    expect(block).toMatch(/Wardrobe \(looks\):\n- Main look/);
    expect(block).toMatch(/\nReference pictures: reference picture, face close-up, 3\/4 face, full body front, full body back\n/);
    expect(block).toMatch(/\nMissing: teeth close-up\n/);
    expect(block).not.toMatch(/✓/);
    expect(lines.at(-1)).toBe("Attach the reference pictures listed above with this block.");
    // A look without an outfit description: copied with "(no outfit description yet)" and a warning naming the look.
    expect(block).toMatch(/- Main look \(draft\): \(no outfit description yet\)/);
    expect(warnings).toContain('The look "Main look" has no outfit description yet; add it in the Wardrobe for better prompts');
  });

  it("tagged on clips of two songs by its id; renamed, removed (greyed) and restored, the tags follow; the video is unchanged", async () => {
    const songs: string[] = [];
    for (const title of ["Song One", "Song Two"]) {
      const song = path.join(root, `${title}.wav`);
      makeSong(song, 8);
      const sid = (await findOrCreateSongProject(ws, song)).project.id;
      const p = songPathsById(ws, sid);
      writeFileSync(p.lyricsTxt, `${LYRICS.join("\n")}\n`);
      mkdirSync(p.clips!, { recursive: true });
      for (const [i, c] of ["blue", "red", "green"].entries()) makeClip(path.join(p.clips!, `0${i + 1}_${c}.mp4`), 3, c);
      writeRecipe(p.recipe!, { ...readRecipe(p.recipe!), platforms: ["reels"], section: "0:00-0:08", variations: { reels: 1 } });
      songs.push(sid);
    }
    // The video before any tag.
    const sample = path.join(root, "s.mp4");
    const still = path.join(root, "s.jpg");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=1", "-pix_fmt", "yuv420p", sample);
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", still);
    const props: string[] = [];
    const make = async (sid: string) => {
      const p = songPathsById(ws, sid);
      await makeVideos({
        workspaceDir: wsDir, song: p.audio!, lyrics: p.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, platform: "win32",
        renderer: async (o: RenderOptions) => (props.push(JSON.stringify(o.props)), copyFileSync(sample, o.outFile), o.outFile),
        thumbnailRenderer: async (o) => (copyFileSync(still, o.outFile), o.outFile),
      });
    };
    await make(songs[0]);
    // Three clips tagged in song one, one in song two: saved by id in clips.json.
    for (const n of ["01_blue.mp4", "02_red.mp4", "03_green.mp4"]) expect(setSongClipCast(ws, songs[0], n, [id])).toEqual([id]);
    expect(setSongClipCast(ws, songs[1], "02_red.mp4", [id])).toEqual([id]);
    expect(readClipEdits(songPathsById(ws, songs[0]).root).clips["01_blue.mp4"].cast).toEqual([id]);
    expect((await songAssets(ws, songs[1])).clips.find((c) => c.name === "02_red.mp4")?.cast).toEqual([id]);
    expect(() => setSongClipCast(ws, songs[0], "01_blue.mp4", ["nobody"])).toThrow(/not in your library/);
    // Display only: the same video with the tags.
    await make(songs[0]);
    expect(props).toHaveLength(2);
    expect(props[1]).toBe(props[0]);

    // Removed (Card clean-up's Remove card): out of the library, its tags greyed (removed: true, read from
    // characters\_removed\), the tags kept; restored: the same id, everything back.
    const removed = removeCard(ws, id);
    expect(removed.folder).toMatch(/^characters\/_removed\/Jennifer /);
    expect(listCards(ws).some((c) => c.id === id)).toBe(false);
    expect(listRemovedCards(ws).map((c) => c.name)).toEqual(["Jennifer"]);
    expect(cardTags(ws).find((t) => t.id === id)).toMatchObject({ name: "Jennifer", removed: true });
    expect(readClipEdits(songPathsById(ws, songs[0]).root).clips["02_red.mp4"].cast).toEqual([id]);
    const back = restoreCard(ws, removed.folder);
    expect(back.id).toBe(id);
    expect(existsSync(path.join(wsDir, "characters", "Jennifer", "face.json"))).toBe(true);
    expect(cardTags(ws).find((t) => t.id === id)).toMatchObject({ removed: false });
    expect(listCards(ws).some((c) => c.id === id)).toBe(true);
  }, 300_000);
});
