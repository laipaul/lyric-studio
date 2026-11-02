// Stability pass (1 Nov 2026): no quiet choices made for the user, and nothing of a song replaced
// without being kept. A deleted song's music is never brought back as a "new" song; another song's music
// never goes into this song; a missing lyrics file is said instead of an older copy being used; a run from
// Lyric Studio never changes the song's collection; every replaced file is listed and can be restored.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, openWorkspace, project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, generateOptions, projectLyricsTxt, readRecipe, rememberCollection, removeSong, replaceAsset, restoreReplacedFile, songPathsById, songReplacedFiles } from "../src/node";
import { planMigration } from "../src/node/migrate";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-stability-"));
const inDir = path.join(root, "in");
let ws: Workspace;
const tone = (name: string, hz: number) => {
  const f = path.join(inDir, name);
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=2`, f]);
  return f;
};
const picture = (name: string, colour: string) => {
  const f = path.join(inDir, name);
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${colour}:s=32x32`, "-frames:v", "1", f]);
  return f;
};
const text = (name: string, content: string) => {
  const f = path.join(inDir, name);
  writeFileSync(f, content);
  return f;
};

beforeAll(() => {
  mkdirSync(inDir, { recursive: true });
  ws = openWorkspace(path.join(root, "workspace"));
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("no song is ever taken over", () => {
  it("a deleted song's file is not made into a new song (Restore is named instead)", async () => {
    const wav = tone("Gone Song.wav", 250);
    const r = await createSong(ws, { song: wav, lyrics: text("gone.txt", "Gone away\n") });
    removeSong(ws, r.id);
    await expect(createSong(ws, { song: wav, lyrics: text("other.txt", "Other words\n"), title: "Brand New" })).rejects.toThrow(/belongs to "Gone Song", which is in Deleted songs.*Nothing was changed/s);
    const p = ws.db.select().from(project).where(eq(project.id, r.id)).get()!;
    expect(p.title).toBe("Gone Song"); // not renamed, still deleted
    expect(p.folder?.startsWith("songs/_removed")).toBe(true);
  });

  it("Replace song refuses another song's music", async () => {
    const a = await createSong(ws, { song: tone("First.wav", 300), lyrics: text("a.txt", "Line a\n") });
    const b = await createSong(ws, { song: tone("Second.wav", 400), lyrics: text("b.txt", "Line b\n") });
    await expect(replaceAsset(ws, b.id, "song", path.join(inDir, "First.wav"), "First.wav")).rejects.toThrow(/song file of "First".*Nothing was changed/s);
    const pb = ws.db.select().from(project).where(eq(project.id, b.id)).get()!;
    expect(path.basename(pb.audio_path!)).toBe("Second.wav");
    expect(a.id).not.toBe(b.id);
  });
});

describe("Replaced files: listed with what they were, and Restore", () => {
  it("replacing the song, lyrics and cover keeps each one; Restore brings it back and keeps the current one", async () => {
    const r = await createSong(ws, { song: tone("Keep Me.wav", 500), lyrics: text("Keep lyrics.txt", "First words\n"), cover: picture("cover.jpg", "red") });
    const paths = () => songPathsById(ws, r.id);
    await replaceAsset(ws, r.id, "song", tone("Keep Me (v2).wav", 510), "Keep Me (v2).wav");
    await replaceAsset(ws, r.id, "lyrics", text("Keep lyrics v2.txt", "Second words\n"), "Keep lyrics v2.txt");
    await replaceAsset(ws, r.id, "cover", picture("blue.png", "blue"), "blue.png");
    const list = songReplacedFiles(ws, r.id);
    expect(list.map((f) => [f.original, f.role]).sort()).toEqual([
      ["Keep Me.wav", "song"],
      ["cover.jpg", "cover"],
      ["lyrics.txt", "lyrics"],
    ]);

    // The song back: the v2 file goes to Replaced files; the identical kept copy is not kept twice.
    const song = list.find((f) => f.role === "song")!;
    await restoreReplacedFile(ws, r.id, song.file);
    expect(path.basename(paths().audio!)).toBe("Keep Me.wav");
    const after = songReplacedFiles(ws, r.id);
    expect(after.some((f) => f.file === song.file)).toBe(false);
    expect(after.find((f) => f.original === "Keep Me (v2).wav")?.role).toBe("song");

    // The lyrics back (the text of the earlier version; the current one is kept).
    await restoreReplacedFile(ws, r.id, list.find((f) => f.role === "lyrics")!.file);
    expect(readFileSync(paths().lyricsTxt, "utf8")).toContain("First words");
    expect(songReplacedFiles(ws, r.id).some((f) => f.role === "lyrics" && readFileSync(path.join(paths().root, ".studio", "replaced", f.file), "utf8").includes("Second words"))).toBe(true);

    // The cover back.
    await restoreReplacedFile(ws, r.id, list.find((f) => f.role === "cover")!.file);
    const p = ws.db.select().from(project).where(eq(project.id, r.id)).get()!;
    expect(path.basename(p.cover_path!)).toBe("cover.jpg");
    expect(songReplacedFiles(ws, r.id).some((f) => f.original === "cover.png" && f.role === "cover")).toBe(true);
  });

  it("files kept before the list existed: the role is read from the name where it is clear, else no Restore", async () => {
    const r = await createSong(ws, { song: tone("Old Kept.wav", 520), lyrics: text("old.txt", "Old words\n") });
    const dir = path.join(songPathsById(ws, r.id).root, ".studio", "replaced");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "2026-10-20T10-00-00-hints.lrc"), "[00:01.00]Old words\n");
    writeFileSync(path.join(dir, "2026-10-20T10-00-01-Mystery.wav"), "x");
    const list = songReplacedFiles(ws, r.id);
    expect(list.find((f) => f.original === "hints.lrc")?.role).toBe("hints");
    expect(list.find((f) => f.original === "Mystery.wav")?.role).toBeNull();
    await expect(restoreReplacedFile(ws, r.id, "2026-10-20T10-00-01-Mystery.wav")).rejects.toThrow(/not clear what Mystery.wav was/);
  });
});

describe("no quiet fallbacks", () => {
  it("a missing lyrics file is said in plain words; no older copy is used", async () => {
    const r = await createSong(ws, { song: tone("No Words.wav", 600), lyrics: text("nowords.txt", "Some words\n") });
    const lyrics = projectLyricsTxt(ws, r.id)!;
    // An older copy left by an alignment must not be picked up.
    const store = songPathsById(ws, r.id).store;
    mkdirSync(store, { recursive: true });
    writeFileSync(path.join(store, "lyrics-0123456789ab.txt"), "Old copy\n");
    renameSync(lyrics, `${lyrics}.away`);
    expect(projectLyricsTxt(ws, r.id)).toBeNull();
    expect(() => generateOptions(ws, r.id, { platforms: ["reels"] })).toThrow(/no lyrics file in its song folder.*Prepare → Assets/s);
    renameSync(`${lyrics}.away`, lyrics);
  });

  it("a collection only remembered from an old run is written into song.json by Tidy, where Shape shows it", async () => {
    const r = await createSong(ws, { song: tone("Remembered.wav", 700), lyrics: text("rem.txt", "Words\n") });
    const recipeFile = songPathsById(ws, r.id).recipe!;
    expect(readRecipe(recipeFile).collections).toBeUndefined();
    rememberCollection(ws, r.id, { name: "wedding" });
    const plan = planMigration(ws);
    const repair = plan.repairs.find((x) => x.projectId === r.id);
    expect(repair).toMatchObject({ kind: "recipe", recipe: { collections: ["wedding"] } });
  });
});

// Keep the folder listing helper used (a sanity check that the song folders exist).
it("song folders are made", () => {
  expect(readdirSync(path.join(ws.dir, "songs")).length).toBeGreaterThan(0);
  expect(existsSync(path.join(ws.dir, "songs"))).toBe(true);
});
