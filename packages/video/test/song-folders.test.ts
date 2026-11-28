// Step 6.2c-1: one folder per song (songs\<artist>\<title>\), the recipe (song.json) and its
// inheritance, "pnpm make <song folder>", renaming, and the Assets tab (drop clips, remove without
// deleting, replace files).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { clip, makeRun, openWorkspace, project, seedStylePresets, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyMigration,
  checkRecipe,
  folderName,
  importSongClips,
  LIBRARY_RECIPE,
  lockField,
  makeVideos,
  migrationText,
  planMigration,
  parseMakeArgs,
  readManifest,
  readMoves,
  readRecipe,
  removeSongClip,
  renameSongFolder,
  replaceAsset,
  resetField,
  resolveMoved,
  resolveRecipe,
  saveToSong,
  setSongClipOmit,
  setSongClipOrder,
  readClipEdits,
  setClipOmit,
  songAssets,
  songFolderFor,
  songPaths,
  songPathsById,
  unlockField,
  writeRecipe,
  type MakeOptions,
  type RenderOptions,
} from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-songs-"));
const wsDir = path.join(root, "workspace");
const inDir = path.join(root, "in");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;
const sample = path.join(root, "sample.mp4");
const renderer = async (o: RenderOptions) => {
  copyFileSync(sample, o.outFile);
  return o.outFile;
};
const run = (extra: Partial<MakeOptions> = {}) =>
  makeVideos({ workspaceDir: wsDir, song: path.join(inDir, "Hold On.wav"), lyrics: path.join(inDir, "lyrics.txt"), align: fakeAlign, frameCheck: false, renderer, platform: "win32", platforms: "reels", variations: 1, ...extra });

beforeAll(() => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(inDir, { recursive: true });
  makeSong(path.join(inDir, "Hold On.wav"), 20);
  writeFileSync(path.join(inDir, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  const wedding = path.join(wsDir, "collections", "wedding");
  mkdirSync(wedding, { recursive: true });
  makeClip(path.join(wedding, "01_rings.mp4"), 6, "blue");
  makeClip(path.join(wedding, "02_dance.mp4"), 6, "yellow");
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
});
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("folder names and layout", () => {
  it("readable, Windows-safe names: accents stay, forbidden characters become _, no trailing dots, no device names", () => {
    expect(folderName("Pômé")).toBe("Pômé");
    expect(folderName('Hold On: "Live" / Acoustic?')).toBe("Hold On_ _Live_ _ Acoustic_");
    expect(folderName("  Many   spaces...  ")).toBe("Many spaces");
    expect(folderName("con")).toBe("_con");
    expect(folderName("")).toBe("untitled");
    expect([...folderName("x".repeat(100))]).toHaveLength(60);
  });

  it("legacy songs keep projects\\<id>\\; a song folder holds song, lyrics, cover, hints, clips, exports, song.json and .studio", () => {
    const legacy = songPaths(ws, { id: "abc", folder: null, audio_path: "projects/abc/audio/x.wav", cover_path: null });
    expect([legacy.legacy, legacy.exportsRel, legacy.storeRel, legacy.recipe, legacy.clips]).toEqual([true, "projects/abc/exports", "projects/abc/lyrics", null, null]);
    const p = songPaths(ws, { id: "abc", folder: "songs/Life Lyrics/Hold On", audio_path: "songs/Life Lyrics/Hold On/song.wav", cover_path: null });
    const r = (f: string | null) => path.relative(wsDir, f!).split(path.sep).join("/");
    expect([r(p.audio), r(p.lyricsTxt), r(p.hints), r(p.clips), r(p.exports), r(p.recipe), p.storeRel, r(p.settings)]).toEqual([
      "songs/Life Lyrics/Hold On/song.wav",
      "songs/Life Lyrics/Hold On/lyrics.txt",
      "songs/Life Lyrics/Hold On/hints.lrc",
      "songs/Life Lyrics/Hold On/clips",
      "songs/Life Lyrics/Hold On/exports",
      "songs/Life Lyrics/Hold On/song.json",
      "songs/Life Lyrics/Hold On/.studio/lyrics",
      "songs/Life Lyrics/Hold On/.studio/settings.json",
    ]);
  });

  it("a name already used by another song (or a folder on disk) gets (2), (3), ...", () => {
    const other = ws.db.insert(project).values({ title: "Taken", artist: "Life Lyrics", folder: "songs/Life Lyrics/Taken" }).returning().get();
    expect(songFolderFor(ws, "Life Lyrics", "Taken", other.id)).toBe("songs/Life Lyrics/Taken"); // its own
    expect(songFolderFor(ws, "Life Lyrics", "Taken")).toBe("songs/Life Lyrics/Taken (2)");
    mkdirSync(path.join(wsDir, "songs", "Life Lyrics", "Taken (2)"), { recursive: true });
    writeFileSync(path.join(wsDir, "songs", "Life Lyrics", "Taken (2)", "mine.txt"), "x"); // an empty one would be free
    expect(songFolderFor(ws, "Life Lyrics", "Taken")).toBe("songs/Life Lyrics/Taken (3)");
    ws.db.delete(project).where(eq(project.id, other.id)).run();
    rmSync(path.join(wsDir, "songs", "Life Lyrics", "Taken (2)"), { recursive: true });
  });
});

describe("the recipe: library -> artist -> song -> run", () => {
  const artist = { verseEffect: "glide", hookEffect: "karaoke-highlight", verseFont: "Cormorant Garamond", hookFont: "Kaushan Script", accentColour: "#E8A3B5" };

  it("each setting comes from the nearest level that sets it", () => {
    const r = resolveRecipe({ library: LIBRARY_RECIPE, artist: { ...artist, accentColour: "#88AACC" }, song: { verseEffect: "soft-blur:subtle", collections: ["wedding"] }, run: { section: "0:11-1:10" } });
    expect(r.values).toMatchObject({ verseEffect: "soft-blur:subtle", hookEffect: "karaoke-highlight", accentColour: "#88AACC", collections: ["wedding"], section: "0:11-1:10", youtubeLayout: "cover" });
    expect(r.sources).toMatchObject({ verseEffect: "song", hookEffect: "artist", accentColour: "artist", collections: "song", section: "run", youtubeLayout: "library" });
    expect(r.ignored).toEqual([]);
  });

  it("a locked setting keeps the song's value: a brand change does not reach it, a run cannot change it (noted)", () => {
    const song = lockField({}, "verseEffect", "glide"); // locking an inherited value copies it into the song
    expect(song).toEqual({ verseEffect: "glide", locked: ["verseEffect"] });
    const r = resolveRecipe({ library: LIBRARY_RECIPE, artist: { ...artist, verseEffect: "typewriter" }, song, run: { verseEffect: "floating" } });
    expect([r.values.verseEffect, r.sources.verseEffect]).toEqual(["glide", "song"]);
    expect(r.ignored).toEqual([{ field: "verseEffect", run: "floating", kept: "glide" }]);
    expect(unlockField(song, "verseEffect")).toEqual({ verseEffect: "glide" });
  });

  it("save to song keeps the run's choices (not over a lock); reset goes back to inherited", () => {
    const song = { verseEffect: "glide", locked: ["verseEffect" as const] };
    const saved = saveToSong(song, { verseEffect: "floating", hookEffect: "word-reveal", variations: { reels: 2 } });
    expect(saved).toEqual({ verseEffect: "glide", hookEffect: "word-reveal", variations: { reels: 2 }, locked: ["verseEffect"] });
    expect(resetField(saved, "hookEffect")).toEqual({ verseEffect: "glide", variations: { reels: 2 }, locked: ["verseEffect"] });
    expect(resetField(saved, "verseEffect")).toEqual({ hookEffect: "word-reveal", variations: { reels: 2 } });
  });

  it("song.json is checked (every problem named) and written with a help line", () => {
    expect(checkRecipe({ accentColour: "pink", variations: { reels: 40 }, youtubeLayout: "grid", locked: ["ep"] }).problems).toEqual([
      'accentColour must look like "#E8A3B5"',
      'variations must look like { "reels": 3 } (1-24 videos)',
      "youtubeLayout must be cover, stills or clips",
      "ep is locked but has no value in song.json",
    ]);
    const file = path.join(root, "song.json");
    writeRecipe(file, { ep: "Night Songs", collections: ["wedding"], locked: ["ep"] });
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")))).toEqual(["_help", "collections", "ep", "locked"]);
    expect(readRecipe(file)).toEqual({ ep: "Night Songs", collections: ["wedding"], locked: ["ep"] });
    writeFileSync(file, "{ nope");
    expect(() => readRecipe(file)).toThrow(/song.json is not valid JSON/);
  });
});

describe("a song's folder in pnpm make", () => {
  let folder: string;
  let projectId: string;

  it("a new song gets songs\\<artist>\\<title>\\ with its song (own name), clips\\ and exports\\; --collection goes into song.json", async () => {
    const r = await run({ collection: "wedding" });
    const p = ws.db.select().from(project).get()!;
    projectId = p.id;
    expect(p.folder).toBe("songs/Life Lyrics/Hold On");
    folder = path.join(wsDir, "songs", "Life Lyrics", "Hold On");
    expect(readdirSync(folder).sort()).toEqual([".studio", "Hold On.wav", "clips", "exports", "song.json", "storyboards", "tracks.json"]); // the song keeps its own name; 2e-1: Make saves the shot plans; Part A (28 Nov 2026): the song's tracks
    expect(path.dirname(r.exportDir)).toBe(path.join(folder, "exports"));
    expect(readRecipe(path.join(folder, "song.json")).collections).toEqual(["wedding"]);
    expect(existsSync(path.join(wsDir, "projects", p.id))).toBe(false);
  });

  it("pnpm make <folder>: song, lyrics and hints from the folder; its own clips plus the shared collections; locks win", async () => {
    copyFileSync(path.join(inDir, "lyrics.txt"), path.join(folder, "lyrics.txt"));
    writeFileSync(path.join(folder, "hints.lrc"), "[00:01.00]Verse one here\n");
    makeClip(path.join(folder, "clips", "01_own.mp4"), 6, "red");
    copyFileSync(path.join(wsDir, "collections", "wedding", "02_dance.mp4"), path.join(folder, "clips", "02_same-as-dance.mp4")); // a duplicate
    writeRecipe(path.join(folder, "song.json"), { ...readRecipe(path.join(folder, "song.json")), verseEffect: "soft-blur:subtle", variations: { reels: 2 }, locked: ["verseEffect"] });

    const { options } = parseMakeArgs([folder, "--platforms", "reels", "--line-effect", "floating"], "/");
    expect([options.song, options.lyrics, options.hint, options.songFolder]).toEqual([path.join(folder, "Hold On.wav"), path.join(folder, "lyrics.txt"), path.join(folder, "hints.lrc"), folder]);
    expect(options.section).toBeUndefined(); // the recipe decides
    expect(() => parseMakeArgs([path.join(root, "nothing-here")], "/")).toThrow(/is not a song folder/);

    const logs: string[] = [];
    const r = await makeVideos({ ...options, workspaceDir: wsDir, align: fakeAlign, frameCheck: false, renderer, platform: "win32", log: (m) => logs.push(m) });
    expect(logs).toContain("song.json locks verseEffect: keeping soft-blur:subtle (this run asked for floating)");
    expect(logs).toContain("using collection wedding (remembered)");
    expect(logs.find((l) => l.startsWith("recipe: "))).toMatch(/verseEffect soft-blur:subtle \(song, locked\).*collections wedding \(song\)/);
    expect(r.variations).toHaveLength(2); // song.json variations
    const m = readManifest(r.variations[0].manifestFile);
    expect(m.props.lyricEffects!.verse).toEqual({ name: "soft-blur", intensity: "subtle" });
    expect(m.settings.collection).toMatchObject({ name: "song clips + wedding", clips: 3 }); // the duplicate used once
    expect(m.clips.map((c) => c.name).sort()).toEqual(expect.arrayContaining(["01_own.mp4"]));
    expect(r.warnings.some((w) => w.includes("song clips/02_same-as-dance.mp4") && w.includes("wedding/02_dance.mp4"))).toBe(true);
  });

  it("a new title renames the folder; database paths follow and old paths resolve through the move log", async () => {
    const before = ws.db.select().from(project).where(eq(project.id, projectId)).get()!;
    const r = await run({ title: "Hold On (Acoustic)" });
    const p = ws.db.select().from(project).where(eq(project.id, projectId)).get()!;
    expect(p.folder).toBe("songs/Life Lyrics/Hold On (Acoustic)");
    expect(p.audio_path).toBe("songs/Life Lyrics/Hold On (Acoustic)/Hold On.wav");
    expect(existsSync(folder)).toBe(false);
    expect(path.dirname(r.exportDir)).toBe(path.join(wsDir, "songs", "Life Lyrics", "Hold On (Acoustic)", "exports"));
    const clips = ws.db.select().from(clip).all().filter((c) => c.path.includes("01_own.mp4"));
    expect(clips.map((c) => c.path)).toEqual(["songs/Life Lyrics/Hold On (Acoustic)/clips/01_own.mp4"]);
    expect(resolveMoved(readMoves(wsDir), before.audio_path!)).toBe(p.audio_path);
    folder = path.join(wsDir, "songs", "Life Lyrics", "Hold On (Acoustic)");
  });

  it("not while the song is being rendered by another process", () => {
    ws.db.update(project).set({ title: "Other Name" }).where(eq(project.id, projectId)).run();
    const busy = ws.db.insert(makeRun).values({ project_id: projectId, status: "running", label: "x", options_json: {}, pid: process.ppid }).returning().get();
    try {
      expect(() => renameSongFolder(ws, projectId)).toThrow(/is being rendered right now/);
      expect(renameSongFolder(ws, projectId, { selfPid: process.ppid })).toBe("songs/Life Lyrics/Other Name"); // that run itself may
      ws.db.update(project).set({ title: "Hold On (Acoustic)" }).where(eq(project.id, projectId)).run();
      renameSongFolder(ws, projectId, { selfPid: process.ppid });
    } finally {
      ws.db.delete(makeRun).where(eq(makeRun.id, busy.id)).run();
    }
    expect(existsSync(folder)).toBe(true);
  });
});

describe("folders made by hand, collections kept elsewhere", () => {
  it("an empty folder made in advance is not 'taken'; a move replaces it, a folder with files never", () => {
    const pre = path.join(wsDir, "songs", "Life Lyrics", "Made By Hand");
    mkdirSync(path.join(pre, "clips"), { recursive: true });
    expect(songFolderFor(ws, "Life Lyrics", "Made By Hand")).toBe("songs/Life Lyrics/Made By Hand");
    writeFileSync(path.join(pre, "notes.txt"), "mine");
    expect(songFolderFor(ws, "Life Lyrics", "Made By Hand")).toBe("songs/Life Lyrics/Made By Hand (2)");
    rmSync(pre, { recursive: true });
  });

  it("songs:migrate renames a song folder left with (2) once the name is free; a folder with files is only named", async () => {
    const base = path.join(wsDir, "songs", "Life Lyrics", "Love Is A Good Thing");
    mkdirSync(path.join(base, "exports"), { recursive: true }); // empty, made by hand
    const two = "songs/Life Lyrics/Love Is A Good Thing (2)";
    mkdirSync(path.join(wsDir, two, "exports"), { recursive: true });
    writeFileSync(path.join(wsDir, two, "song.mp3"), "x");
    const p = ws.db.insert(project).values({ title: "Love Is A Good Thing", artist: "Life Lyrics", folder: two, audio_path: `${two}/song.mp3` }).returning().get();
    const plan = planMigration(ws);
    expect(plan.renames).toEqual([{ from: two, to: "songs/Life Lyrics/Love Is A Good Thing", what: '"Love Is A Good Thing"' }]);
    expect(migrationText(plan)).toContain('Rename "Love Is A Good Thing": songs\\Life Lyrics\\Love Is A Good Thing (2)\\  ->  songs\\Life Lyrics\\Love Is A Good Thing\\');
    const r = await applyMigration(ws);
    expect(r.renames).toBe(1);
    expect(ws.db.select().from(project).where(eq(project.id, p.id)).get()).toMatchObject({ folder: "songs/Life Lyrics/Love Is A Good Thing", audio_path: "songs/Life Lyrics/Love Is A Good Thing/song.mp3" });
    expect(existsSync(path.join(base, "song.mp3"))).toBe(true);
    expect(existsSync(path.join(wsDir, two))).toBe(false);

    // A folder with files that no song owns is never touched: the song keeps (2) and the dry run says why.
    const other = "songs/Life Lyrics/Kept (2)";
    mkdirSync(path.join(wsDir, other), { recursive: true });
    mkdirSync(path.join(wsDir, "songs", "Life Lyrics", "Kept"), { recursive: true });
    writeFileSync(path.join(wsDir, "songs", "Life Lyrics", "Kept", "mine.txt"), "x");
    const q = ws.db.insert(project).values({ title: "Kept", artist: "Life Lyrics", folder: other }).returning().get();
    const again = planMigration(ws);
    expect(again.renames).toEqual([]);
    expect(again.notes[0]).toMatch(/Kept\\ was not made by Lyric Studio and has files in it/);
    for (const id of [p.id, q.id]) ws.db.delete(project).where(eq(project.id, id)).run();
  });

  it("a collection kept outside the workspace (--collection-path) is found again on later runs", async () => {
    const far = path.join(root, "far-away", "wedding2");
    mkdirSync(far, { recursive: true });
    makeClip(path.join(far, "01_far.mp4"), 6, "green");
    await run({ collection: "wedding2", collectionPath: far });
    const logs: string[] = [];
    const r = await run({ log: (m) => logs.push(m) });
    expect(logs).toContain("using collection wedding2 (remembered)");
    expect(readManifest(r.variations[0].manifestFile).clips.map((c) => c.name)).toContain("01_far.mp4");
    await run({ collection: "wedding" }); // back to the shared collection for the next tests
  });
});

describe("the Assets tab", () => {
  const projectId = () => ws.db.select().from(project).get()!.id;

  it("lists the song's files and clips with thumbnail, orientation, duration, size and duplicates", async () => {
    const a = await songAssets(ws, projectId());
    expect(a.folder).toBe("songs/Life Lyrics/Hold On (Acoustic)");
    expect(a.song?.name).toBe("Hold On.wav");
    expect(a.lyrics?.lines).toBe(LYRICS.length);
    expect(a.hints?.stamps).toBe(1);
    expect(a.clips.map((c) => [c.name, c.kind, c.orientation, c.width, c.height, c.duplicateOf])).toEqual([
      ["01_own.mp4", "video", "vertical", 216, 384, null],
      ["02_same-as-dance.mp4", "video", "vertical", 216, 384, null],
    ]);
    expect(a.clips[0].durationMs).toBe(6000);
    expect(a.clips.every((c) => c.thumb && existsSync(path.join(wsDir, c.thumb)))).toBe(true);
    expect(a.usable).toEqual({ vertical: 2, horizontal: 0 });
  });

  it("dropped clips are copied in with a free name; the same content again and non-videos are named, not added", async () => {
    const drop = path.join(root, "drop");
    mkdirSync(drop, { recursive: true });
    makeClip(path.join(drop, "01_own.mp4"), 3, "green"); // same name, new content
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=640x360", "-frames:v", "1", path.join(drop, "wide.jpg"));
    writeFileSync(path.join(drop, "notes.txt"), "x");
    const r = await importSongClips(ws, projectId(), [
      { file: path.join(drop, "01_own.mp4"), name: "01_own.mp4" },
      { file: path.join(drop, "wide.jpg"), name: "wide.jpg" },
      { file: path.join(folder(), "clips", "01_own.mp4"), name: "copy.mp4" },
      { file: path.join(drop, "notes.txt"), name: "notes.txt" },
    ]);
    expect(r.added).toEqual(["01_own-2.mp4", "wide.jpg"]);
    expect(r.duplicates).toEqual([{ name: "copy.mp4", sameAs: "01_own.mp4" }]);
    expect(r.skipped.map((s) => s.name)).toEqual(["notes.txt"]);
    const a = await songAssets(ws, projectId());
    expect(a.clips.find((c) => c.name === "wide.jpg")).toMatchObject({ kind: "photo", orientation: "horizontal", durationMs: 0 });
    expect(a.usable).toEqual({ vertical: 3, horizontal: 1 });
  });

  it("remove moves the clip to clips\\_removed\\ (never deleted) and out of the database", async () => {
    const moved = await removeSongClip(ws, projectId(), "01_own-2.mp4");
    expect(moved).toBe("songs/Life Lyrics/Hold On (Acoustic)/clips/_removed/01_own-2.mp4");
    expect(existsSync(path.join(wsDir, moved))).toBe(true);
    expect(existsSync(path.join(folder(), "clips", "01_own-2.mp4"))).toBe(false);
    expect(ws.db.select().from(clip).all().some((c) => c.path.endsWith("/clips/01_own-2.mp4"))).toBe(false);
    const a = await songAssets(ws, projectId());
    expect(a.removed).toEqual(["01_own-2.mp4"]);
    expect(a.clips.map((c) => c.name)).not.toContain("01_own-2.mp4");
    await expect(removeSongClip(ws, projectId(), "../song.wav")).rejects.toThrow(/No clip/);
  });

  it("the clip order: Assets shows it, drag sets it (clips.json), new clips go at the end by name, Remove takes a clip out", async () => {
    const names = async () => (await songAssets(ws, projectId())).clips.map((c) => c.name);
    const now = await names();
    const reversed = [...now].reverse();
    expect(setSongClipOrder(ws, projectId(), reversed)).toEqual(reversed);
    expect(await names()).toEqual(reversed);
    expect(readClipEdits(folder()).order.filter((n) => now.includes(n))).toEqual(reversed);
    expect(() => setSongClipOrder(ws, projectId(), ["nope.mp4"])).toThrow(/Not in this song's clips/);
    const drop = path.join(root, "drop-order");
    mkdirSync(drop, { recursive: true });
    makeClip(path.join(drop, "b.mp4"), 2, "red");
    makeClip(path.join(drop, "a.mp4"), 2, "white");
    await importSongClips(ws, projectId(), [{ file: path.join(drop, "b.mp4"), name: "zz_b.mp4" }, { file: path.join(drop, "a.mp4"), name: "zz_a.mp4" }]);
    expect(await names()).toEqual([...reversed, "zz_a.mp4", "zz_b.mp4"]);
    await removeSongClip(ws, projectId(), "zz_a.mp4");
    expect(await names()).toEqual([...reversed, "zz_b.mp4"]);
    expect(readClipEdits(folder()).order).not.toContain("zz_a.mp4");
    await removeSongClip(ws, projectId(), "zz_b.mp4");
    setSongClipOrder(ws, projectId(), now); // back as it was for the next tests
  });

  it("Use / Omit: an omitted clip keeps its place, Make never shows it; every clip omitted says so", async () => {
    const own = (await songAssets(ws, projectId())).clips.map((c) => c.name);
    expect(setSongClipOmit(ws, projectId(), own[0], true)).toBe(true);
    const a = await songAssets(ws, projectId());
    expect(a.clips.map((c) => [c.name, c.omit])).toEqual(own.map((n, i) => [n, i === 0]));
    const dry = await run({ dryRun: true, variations: 2 });
    const plan = dry.platforms[0].plan!;
    const omitted = plan.clips.find((c) => c.name === own[0])!;
    expect(omitted.omit).toBe(true);
    for (const v of plan.videos) expect(v.props.shots.some((s) => s.src === omitted.path)).toBe(false);
    expect(plan.videos.every((v) => v.spec.order === "story")).toBe(true); // no shuffle: every video follows the order
    // Every clip omitted (the song's and the collection's): a plain message.
    const all = plan.clips.map((c) => c.name);
    const root = folder();
    for (const n of all) setClipOmit(root, n, true);
    await expect(run({ dryRun: true })).rejects.toThrow(/every clip is set to Omit/);
    for (const n of all) setClipOmit(root, n, false);
    expect(setSongClipOmit(ws, projectId(), own[0], false)).toBe(false);
    expect(() => setSongClipOmit(ws, projectId(), "nope.mp4", true)).toThrow(/No clip nope.mp4/);
  }, 300_000);

  it("replacing lyrics, cover or hints keeps the old file in .studio\\replaced\\", async () => {
    const txt = path.join(root, "new-lyrics.txt");
    writeFileSync(txt, "Only one line\n");
    await replaceAsset(ws, projectId(), "lyrics", txt, "new-lyrics.txt");
    expect(readFileSync(path.join(folder(), "new-lyrics.txt"), "utf8")).toBe("Only one line\n"); // under its own name
    expect(existsSync(path.join(folder(), "lyrics.txt"))).toBe(false); // the old one moved to .studio\replaced\
    expect(songPathsById(ws, projectId()).lyricsTxt).toBe(path.join(folder(), "new-lyrics.txt"));
    const taps = path.join(root, "taps.lrc");
    writeFileSync(taps, "[00:02.00]Only one line\n");
    await replaceAsset(ws, projectId(), "hints", taps, "taps.lrc");
    expect(readFileSync(path.join(folder(), "hints.lrc"), "utf8")).toContain("00:02.00");
    const replaced = readdirSync(path.join(folder(), ".studio", "replaced"));
    expect(replaced.some((f) => f.endsWith("-lyrics.txt"))).toBe(true);
    expect(replaced.some((f) => f.endsWith("-hints.lrc"))).toBe(true);
    await expect(replaceAsset(ws, projectId(), "cover", txt, "cover.gif")).rejects.toThrow(/The cover must be a JPG, PNG or WEBP/);
  });

  const folder = () => songPathsById(ws, projectId()).root;
});
