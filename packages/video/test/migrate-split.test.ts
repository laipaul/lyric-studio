// A song split over two folders by an interrupted first-version migration (seen on the PC: "Love Is A
// Good Thing" had its song, cover and .studio\lyrics in songs\Life Lyrics\Love Is A Good Thing\ and its
// exports and an empty song.json in "...(2)\"): pnpm songs:migrate finds it, --apply merges it into the
// plain name, carries the settings over from the migration backup, rebuilds lyrics.txt / hints.lrc,
// keeps every run and mark, and pnpm make reuses the stored alignment. Also: an interrupted migration
// (and an interrupted adoption of a new song) is finished by the next run, never split.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, createProject, openWorkspace, project, seedStylePresets, videoMark, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cachedFileHash } from "../src/node/collection";
import {
  applyMigration,
  findOrCreateSongProject,
  makeVideos,
  migrationStatus,
  migrationText,
  moveEntry,
  planMigration,
  readRecipe,
  relocatePaths,
  setVideoMark,
  songRuns,
  storeLyricsTxt,
  type MakeOptions,
  type RenderOptions,
} from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-split-"));
const wsDir = path.join(root, "workspace");
const inDir = path.join(root, "in");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;
const sample = path.join(root, "sample.mp4");
const renderer = async (o: RenderOptions) => {
  writeFileSync(o.outFile, readFileSync(sample));
  return o.outFile;
};
const plain = "songs/Life Lyrics/Love Is A Good Thing";
const two = `${plain} (2)`;

// A song made before 6.2c: projects\<id>\ with three runs (one mark each), stored hints, settings.
async function legacySong(file: string, title: string, runs: number, seconds: number): Promise<string> {
  makeSong(file, seconds); // a different length = a different song (songs are found by their content)
  const p = await createProject(ws, { title, audioFile: file });
  ws.db.update(project).set({ audio_hash: await cachedFileHash(ws, file) }).where(eq(project.id, p.id)).run();
  storeLyricsTxt(ws, p.id, path.join(inDir, "lyrics.txt"));
  const opts: MakeOptions = { workspaceDir: wsDir, song: file, lyrics: path.join(inDir, "lyrics.txt"), collection: "wedding", platforms: "reels", variations: 1, align: fakeAlign, frameCheck: false, renderer, platform: "win32", hint: path.join(inDir, "taps.lrc") };
  for (let i = 0; i < runs; i++) {
    const r = await makeVideos({ ...opts, now: new Date(2026, 9, 24 + i, 22, 48) });
    setVideoMark(ws, p.id, path.relative(wsDir, r.variations[0].manifestFile).split(path.sep).join("/"), { favourite: true, status: i === 0 ? "approved" : "generated" });
  }
  return p.id;
}

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(inDir, { recursive: true });
  writeFileSync(path.join(inDir, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  writeFileSync(path.join(inDir, "taps.lrc"), "[00:01.00]Verse one here\n");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=2", "-pix_fmt", "yuv420p", sample);
  const wedding = path.join(wsDir, "clips", "wedding");
  mkdirSync(wedding, { recursive: true });
  makeClip(path.join(wedding, "01_rings.mp4"), 6, "blue");
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
}, 300_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("a song split over two folders", () => {
  let id: string;

  it("recreates the state the first version of the migration left on the PC", async () => {
    id = await legacySong(path.join(inDir, "Love Is A Good Thing.wav"), "Love Is A Good Thing", 3, 16);
    const from = `projects/${id}`;
    // Its settings.json is only in the backup of the run that stopped (11:33 on the PC).
    const backup = path.join(wsDir, "migrations", "2026-10-26_113300", "projects", id);
    mkdirSync(backup, { recursive: true });
    writeFileSync(path.join(backup, "settings.json"), readFileSync(absPath(ws, `${from}/settings.json`)));
    writeFileSync(path.join(wsDir, "migrations", "2026-10-26_113300", "journal.json"), JSON.stringify({ version: 1, started_at: "2026-10-26T10:33:00Z", finished_at: null, undone_at: null, had_moves_file: false, steps: [] }));
    // 1st run (stopped before the exports): song, cover-less, .studio\lyrics into the plain folder.
    const audio = ws.db.select().from(project).where(eq(project.id, id)).get()!.audio_path!;
    for (const [a, b] of [[audio, `${plain}/song.wav`], [`${from}/lyrics`, `${plain}/.studio/lyrics`]]) {
      moveEntry(absPath(ws, a), absPath(ws, b));
      relocatePaths(ws, a, b);
    }
    mkdirSync(absPath(ws, `${plain}/clips`), { recursive: true });
    // 2nd run: the rest into "(2)", which became the song's folder (settings.json was gone by then).
    moveEntry(absPath(ws, `${from}/exports`), absPath(ws, `${two}/exports`));
    relocatePaths(ws, `${from}/exports`, `${two}/exports`);
    rmSync(absPath(ws, `${from}/settings.json`));
    mkdirSync(absPath(ws, `${two}/clips`), { recursive: true });
    writeFileSync(absPath(ws, `${two}/song.json`), JSON.stringify({ _help: "x" }));
    ws.db.update(project).set({ folder: two }).where(eq(project.id, id)).run();
    rmSync(absPath(ws, from), { recursive: true, force: true });
    expect(songRuns(ws, id).length).toBe(3);
  });

  it("the dry run finds it, shows the whole merge, the repairs and why song.json is empty; nothing changes", () => {
    const before = JSON.stringify([readdirSync(absPath(ws, plain)), readdirSync(absPath(ws, two))]);
    expect(migrationStatus(ws)).toEqual({ songs: 0, collections: 1, tidy: 1 }); // the banner shows it
    const plan = planMigration(ws);
    expect(plan.merges.map((m) => [m.title, m.from, m.to, m.runs, m.marks])).toEqual([["Love Is A Good Thing", two, plain, 3, 3]]);
    const text = migrationText(plan).join("\n");
    expect(text).toContain(`Split song "Love Is A Good Thing": songs\\Life Lyrics\\Love Is A Good Thing (2)\\ is merged into songs\\Life Lyrics\\Love Is A Good Thing\\ (3 export runs, 3 marks follow)`);
    expect(text).toContain("    exports  ->  exports");
    expect(text).toContain("    song.json  ->  song.json");
    expect(text).toMatch(/Repair "Love Is A Good Thing": lyrics.txt from the lyrics of its newest video \(lyrics-[0-9a-f]{12}\.txt\)/);
    expect(text).toMatch(/Repair "Love Is A Good Thing": hints.lrc from its stored hints/);
    expect(text).toContain('Repair "Love Is A Good Thing": song.json gets collections from migrations\\2026-10-26_113300\\projects\\');
    expect(text).toContain("filled by --apply from migrations\\2026-10-26_113300");
    expect(text).not.toContain("was not made by Lyric Studio");
    expect(JSON.stringify([readdirSync(absPath(ws, plain)), readdirSync(absPath(ws, two))])).toBe(before);
  });

  it("--apply merges into the plain name: one folder with everything, all runs with their marks", async () => {
    const r = await applyMigration(ws);
    expect([r.merges, r.repairs]).toEqual([1, 3]);
    expect(existsSync(absPath(ws, two))).toBe(false);
    expect(readdirSync(absPath(ws, plain)).sort()).toEqual([".studio", "clips", "exports", "hints.lrc", "lyrics.txt", "song.json", "song.wav"]);
    expect(readFileSync(absPath(ws, `${plain}/lyrics.txt`), "utf8")).toBe(`${LYRICS.join("\n")}\n`);
    expect(readRecipe(absPath(ws, `${plain}/song.json`))).toEqual({ collections: ["wedding"] });
    const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
    expect([p.folder, p.audio_path]).toEqual([plain, `${plain}/song.wav`]);
    const runs = songRuns(ws, id);
    expect(runs).toHaveLength(3);
    const videos = runs.flatMap((x) => x.platforms.flatMap((pl) => pl.videos));
    expect(videos.map((v) => v.mark.favourite)).toEqual([true, true, true]);
    expect(videos.filter((v) => v.mark.status === "approved")).toHaveLength(1);
    for (const m of ws.db.select().from(videoMark).all()) expect(existsSync(absPath(ws, m.video))).toBe(true);
    expect(planMigration(ws).merges).toEqual([]);
    expect(migrationStatus(ws).tidy).toBe(0);
  });

  it("pnpm make on the merged folder reuses the stored alignment", async () => {
    const logs: string[] = [];
    const r = await makeVideos({ workspaceDir: wsDir, song: absPath(ws, `${plain}/song.wav`), lyrics: absPath(ws, `${plain}/lyrics.txt`), hint: absPath(ws, `${plain}/hints.lrc`), platforms: "reels", variations: 1, align: async () => { throw new Error("must not align"); }, frameCheck: false, renderer, platform: "win32", log: (m) => logs.push(m) });
    expect(logs.some((l) => l.startsWith("lyrics: using the stored alignment"))).toBe(true);
    expect(logs).toContain("using collection wedding (remembered)");
    rmSync(r.exportDir, { recursive: true });
  });
});

describe("an interrupted run is finished, never split", () => {
  it("a migration stopped half-way: the next --apply finishes the same song folder", async () => {
    const id = await legacySong(path.join(inDir, "Halfway.wav"), "Halfway", 1, 17);
    let moves = 0;
    await expect(applyMigration(ws, { failAfter: (s) => s.op === "move" && ++moves === 2 })).rejects.toThrow(/The migration stopped.*no song is split/s);
    expect(ws.db.select().from(project).where(eq(project.id, id)).get()!.folder).toBeNull(); // not named yet
    expect(existsSync(absPath(ws, "songs/Life Lyrics/Halfway"))).toBe(false); // nothing half-built under its name
    const plan = planMigration(ws);
    expect(plan.songs.map((s) => [s.title, s.to, s.resumed])).toEqual([["Halfway", "songs/Life Lyrics/Halfway", true]]);
    await applyMigration(ws);
    const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
    expect(p.folder).toBe("songs/Life Lyrics/Halfway");
    expect(readdirSync(absPath(ws, p.folder!)).sort()).toEqual([".studio", "clips", "exports", "hints.lrc", "lyrics.txt", "song.json", "song.wav"]);
    expect(readdirSync(absPath(ws, "songs/Life Lyrics")).filter((d) => d.startsWith("Halfway"))).toEqual(["Halfway"]);
    expect(readdirSync(absPath(ws, "songs")).filter((d) => d.startsWith("."))).toEqual([]);
    expect(songRuns(ws, id)).toHaveLength(1);
  });

  it("a new song whose adoption stopped half-way is finished the next time it is used", async () => {
    const file = path.join(inDir, "New One.wav");
    makeSong(file, 12);
    const sp = await findOrCreateSongProject(ws, file);
    // Put it back into the half-way state: song file in songs\.adding-<id>\, no folder named yet.
    const stage = `songs/.adding-${sp.project.id}`;
    moveEntry(absPath(ws, sp.project.folder!), absPath(ws, stage));
    ws.db.update(project).set({ folder: null, audio_path: `${stage}/New One.wav` }).where(eq(project.id, sp.project.id)).run();
    const again = await findOrCreateSongProject(ws, file);
    expect(again.project.folder).toBe("songs/Life Lyrics/New One");
    expect(existsSync(absPath(ws, "songs/Life Lyrics/New One/New One.wav"))).toBe(true); // its own name
    expect(existsSync(absPath(ws, stage))).toBe(false);
  });
});
