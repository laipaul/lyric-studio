// Step 6.2c-1: "pnpm songs:migrate" moves the songs made before song folders (projects\<id>\) into
// songs\<artist>\<title>\ and collections from clips\<name>\ to collections\<name>\: a dry run
// changes nothing, --apply keeps the database consistent and old manifests re-render identically,
// --undo puts everything back.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { cachedFileHash } from "../src/node/collection";
import { clip, createProject, ffmpegBin, openWorkspace, project, seedStylePresets, videoMark, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyMigration,
  makeVideos,
  migrationStatus,
  migrationText,
  planMigration,
  readManifest,
  readRecipe,
  rerender,
  setVideoMark,
  storeCover,
  storeLyricsTxt,
  undoMigration,
  type MakeResult,
} from "../src/node";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-migrate-"));
const wsDir = path.join(root, "workspace");
const inDir = path.join(root, "in");
const previousWorkspace = process.env.WORKSPACE_DIR;
let ws: Workspace;
let projectId: string;
let made: MakeResult;
let manifestRel: string; // the old manifest, workspace-relative, before the migration

// Every file of the workspace (except the database and caches) with its size.
const tree = () => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(wsDir, full).split(path.sep).join("/");
      if (/^(studio\.db|cache|thumbs)/.test(rel)) continue;
      if (e.isDirectory()) walk(full);
      else out.push(`${rel} ${statSync(full).size}`);
    }
  };
  walk(wsDir);
  return out.sort();
};

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(inDir, { recursive: true });
  makeSong(path.join(inDir, "song.wav"), 12);
  writeFileSync(path.join(inDir, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=400x400", "-frames:v", "1", path.join(inDir, "cover.png"));
  // The old layout: clips\wedding\ and projects\<id>\ (as made before Step 6.2c).
  const old = path.join(wsDir, "clips", "wedding");
  mkdirSync(old, { recursive: true });
  makeClip(path.join(old, "01_rings.mp4"), 3, "blue");
  makeClip(path.join(old, "02_dance.mp4"), 4, "yellow");
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
  const p = await createProject(ws, { title: "Old Song", artist: "Pômé", audioFile: path.join(inDir, "song.wav") });
  ws.db.update(project).set({ audio_hash: await cachedFileHash(ws, path.join(inDir, "song.wav")) }).where(eq(project.id, p.id)).run();
  projectId = p.id;
  storeLyricsTxt(ws, projectId, path.join(inDir, "lyrics.txt"));
  storeCover(ws, projectId, path.join(inDir, "cover.png"));
  made = await makeVideos({
    workspaceDir: wsDir,
    song: path.join(inDir, "song.wav"),
    lyrics: path.join(inDir, "lyrics.txt"),
    hint: (writeFileSync(path.join(inDir, "taps.lrc"), "[00:01.00]Verse one here\n"), path.join(inDir, "taps.lrc")),
    collection: "wedding",
    ep: "Night Songs",
    platforms: "reels",
    variations: 1,
    section: "0:02-0:06",
    align: fakeAlign,
  });
  manifestRel = path.relative(wsDir, made.variations[0].manifestFile).split(path.sep).join("/");
  setVideoMark(ws, projectId, manifestRel, { favourite: true });
}, 600_000);
afterAll(() => {
  ws?.close();
  if (previousWorkspace === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previousWorkspace;
  rmSync(root, { recursive: true, force: true });
});

describe("pnpm songs:migrate", () => {
  it("the song really is in the old layout", () => {
    expect(manifestRel).toMatch(new RegExp(`^projects/${projectId}/exports/[^/]+/reels/v1\\.manifest\\.json$`));
    expect(ws.db.select().from(clip).all().map((c) => c.path).sort()).toEqual(["clips/wedding/01_rings.mp4", "clips/wedding/02_dance.mp4"]);
    expect(migrationStatus(ws)).toEqual({ songs: 1, collections: 1 });
  });

  it("the dry run shows every move and changes nothing", () => {
    const before = tree();
    const plan = planMigration(ws);
    const text = migrationText(plan).join("\n");
    expect(text).toContain("Collection: clips\\wedding\\  ->  collections\\wedding\\");
    expect(text).toContain(`Song "Old Song" (Pômé): projects\\${projectId}\\  ->  songs\\Pômé\\Old Song\\`);
    expect(text).toContain("audio\\song.wav  ->  song.wav  (the song)");
    expect(text).toContain("audio\\cover.png  ->  cover.png  (the cover)");
    expect(text).toContain("exports  ->  exports  (the videos)");
    expect(text).toContain("lyrics  ->  .studio\\lyrics");
    expect(text).toContain("new: hints.lrc");
    expect(plan.problems).toEqual([]);
    expect(tree()).toEqual(before);
  });

  it("--apply moves the files, keeps the database consistent and writes song.json; a backup is made first", async () => {
    const r = await applyMigration(ws);
    expect([r.songs, r.collections]).toEqual([1, 1]);
    expect(readdirSync(r.backupDir).sort()).toEqual(["journal.json", "projects", "studio.db"]);
    const song = path.join(wsDir, "songs", "Pômé", "Old Song");
    expect(readdirSync(song).sort()).toEqual([".studio", "clips", "cover.png", "exports", "hints.lrc", "lyrics.txt", "song.json", "song.wav"]);
    expect(readFileSync(path.join(song, "lyrics.txt"), "utf8")).toBe(`${LYRICS.join("\n")}\n`);
    expect(readFileSync(path.join(song, "hints.lrc"), "utf8")).toBe("[00:01.00]Verse one here\n");
    expect(readRecipe(path.join(song, "song.json"))).toEqual({ collections: ["wedding"], ep: "Night Songs" });
    expect(existsSync(path.join(wsDir, "projects"))).toBe(false);
    expect(existsSync(path.join(wsDir, "clips"))).toBe(false);
    expect(existsSync(path.join(wsDir, "collections", "wedding", "01_rings.mp4"))).toBe(true);

    const p = ws.db.select().from(project).where(eq(project.id, projectId)).get()!;
    expect([p.folder, p.audio_path, p.cover_path]).toEqual(["songs/Pômé/Old Song", "songs/Pômé/Old Song/song.wav", "songs/Pômé/Old Song/cover.png"]);
    expect(ws.db.select().from(clip).all().map((c) => c.path).sort()).toEqual(["collections/wedding/01_rings.mp4", "collections/wedding/02_dance.mp4"]);
    const mark = ws.db.select().from(videoMark).get()!;
    expect(mark.video).toBe(manifestRel.replace(`projects/${projectId}/exports`, "songs/Pômé/Old Song/exports"));
    expect(existsSync(path.join(wsDir, mark.video))).toBe(true);
    expect(migrationStatus(ws)).toEqual({ songs: 0, collections: 0 });
    expect(migrationText(planMigration(ws))[0]).toMatch(/^Nothing to migrate/);
  });

  it("an old manifest (paths unchanged inside) still re-renders, frame for frame", async () => {
    const manifestFile = path.join(wsDir, ...manifestRel.replace(`projects/${projectId}/exports`, "songs/Pômé/Old Song/exports").split("/"));
    expect(readManifest(manifestFile).song.file).toMatch(new RegExp(`^projects/${projectId}/audio/`)); // never edited
    const again = await rerender(manifestFile, { workspaceDir: wsDir });
    const sampled = (file: string) =>
      execFileSync(ffmpegBin(), ["-v", "error", "-i", file, "-map", "0:v", "-vf", "select=not(mod(n\\,20))", "-fps_mode", "passthrough", "-f", "framemd5", "-"], { encoding: "utf8" })
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(",").pop()!.trim());
    const original = sampled(path.join(path.dirname(manifestFile), "v1.mp4"));
    expect(new Set(original).size).toBeGreaterThan(1);
    expect(sampled(again.out)).toEqual(original);
    rmSync(again.out);
  }, 300_000);

  it("the next pnpm make uses the song folder and the remembered collection", async () => {
    const logs: string[] = [];
    const r = await makeVideos({
      workspaceDir: wsDir, song: path.join(inDir, "song.wav"), lyrics: path.join(inDir, "lyrics.txt"), platforms: "reels", variations: 1, section: "0:02-0:06",
      align: fakeAlign, frameCheck: false, renderer: async (o) => (writeFileSync(o.outFile, "mp4"), o.outFile), log: (m) => logs.push(m),
    });
    expect(path.dirname(r.exportDir)).toBe(path.join(wsDir, "songs", "Pômé", "Old Song", "exports"));
    expect(logs).toContain("using collection wedding (remembered)");
    expect(logs.some((l) => l.startsWith("lyrics: using the stored alignment"))).toBe(true); // nothing re-aligned
    rmSync(r.exportDir, { recursive: true });
  });

  it("--undo puts the files and the database back as before", () => {
    ws.close();
    const r = undoMigration(wsDir);
    expect(r.steps).toBeGreaterThan(3);
    ws = openWorkspace(wsDir);
    const p = ws.db.select().from(project).where(eq(project.id, projectId)).get()!;
    expect([p.folder, p.audio_path]).toEqual([null, `projects/${projectId}/audio/song.wav`]);
    expect(existsSync(path.join(wsDir, ...p.audio_path!.split("/")))).toBe(true);
    expect(existsSync(path.join(wsDir, ...manifestRel.split("/")))).toBe(true);
    expect(existsSync(path.join(wsDir, "clips", "wedding", "01_rings.mp4"))).toBe(true);
    expect(existsSync(path.join(wsDir, "songs", "Pômé"))).toBe(false);
    expect(ws.db.select().from(clip).all().map((c) => c.path).sort()).toEqual(["clips/wedding/01_rings.mp4", "clips/wedding/02_dance.mp4"]);
    expect(ws.db.select().from(videoMark).get()!.video).toBe(manifestRel);
    expect(migrationStatus(ws)).toEqual({ songs: 1, collections: 1 });
    expect(() => undoMigration(wsDir)).toThrow(/Nothing to undo/);
  });
});
