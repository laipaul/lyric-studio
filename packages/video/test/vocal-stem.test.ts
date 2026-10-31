// L1a: Suno's vocal stem (vocals.wav in the song folder) as the main guide for lyric timing. The voice
// source (stem lined up, else Demucs), cache keys by the stem's content and offset, re-alignment when the
// stem is added or replaced (hints and hand-set starts kept), the Assets tab slot and the Prepare to-do,
// the lyric-timing run, and: the song file is never touched, nothing from the stems reaches any output.
// The audio side (matching, offsets, line-up) is tested in services/audio/tests/test_vocal_stem.py.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRun, openWorkspace, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { songAssets, storeVocalStem } from "../src/node/assets";
import { timeLyrics } from "../src/node/lyric-timing";
import { workOnce } from "../src/node/run-worker";
import { songTodo } from "../src/node/song-stages";
import { DEMUCS, resolveVoiceSource, sourceFromCheck, stemCheckFile, voiceKey, voiceRecord, type StemCheck, type StemCheckRunner } from "../src/node/voice-source";
import { applyVocalGuard, ensureAlignment, findOrCreateSongProject, makeVideos, songFolderFiles, songPathsById, type AlignRunner, type FirstWordsRunner, type SongProject, type VoiceMapRunner } from "../src/node";
import { fakeAlign, LYRICS, makeClip, makeSong } from "./media-helpers";

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-stem-"));
let ws: Workspace;
let sp: SongProject;
let folder: string;
let songHashBefore: string;

// Stands in for services/audio vocal_stem: a stem made as "other-version" doesn't follow the song.
const checks: string[] = [];
const others = new Set<string>();
const stemCheck: StemCheckRunner = async (a) => {
  checks.push(a.stem);
  const other = others.has(sha(a.stem));
  const result: StemCheck = other
    ? { status: "rejected", offset_ms: null, message: "This vocal stem doesn't follow the song: probably another version of the song, or the song was edited in the middle. The app separates the vocals itself (Demucs) instead.", reason: "test", stem_hash: sha(a.stem), song_hash: sha(a.song) }
    : { status: "lined-up", offset_ms: 1800, message: "Vocal stem lined up: 1.8 s offset, from trimming the song's start.", reason: "test", stem_hash: sha(a.stem), song_hash: sha(a.song) };
  writeFileSync(a.out, JSON.stringify(result));
};

// The aligner: records which vocal track it was given; writes the voice into its report like pnpm align.
const aligned: { stem: string; hint?: string }[] = [];
const align: AlignRunner = async (a) => {
  aligned.push({ stem: a.stem, hint: a.hint });
  await fakeAlign(a);
  const report = JSON.parse(readFileSync(a.report, "utf8"));
  writeFileSync(a.report, JSON.stringify({ ...report, voice: a.stem === "none" ? { kind: "demucs" } : { kind: "stem" } }));
};
const maps: string[] = [];
const voiceMap: VoiceMapRunner = async (a) => {
  maps.push(a.stem);
  const db = Array.from({ length: 600 }, (_, k) => (k * 20 >= 1000 && k * 20 < 10_500 ? -14 : -100));
  writeFileSync(a.out, JSON.stringify({ version: 2, hop_ms: 20, db }));
};
const words: string[] = [];
const firstWords: FirstWordsRunner = async (a) => {
  words.push(a.stem);
  writeFileSync(a.out, JSON.stringify({ version: 1, windows: a.windows.map(([line, from, to]) => ({ line, from_ms: from, to_ms: to, words: [] })) }));
};

beforeAll(async () => {
  ws = openWorkspace(path.join(root, "workspace"));
  mkdirSync(path.join(root, "in"), { recursive: true });
  const song = path.join(root, "in", "These Empty Roads.wav");
  makeSong(song, 12);
  songHashBefore = sha(song);
  sp = await findOrCreateSongProject(ws, song);
  folder = songPathsById(ws, sp.project.id).root;
  writeFileSync(path.join(folder, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  writeFileSync(path.join(folder, "hints.lrc"), "[00:01.00]Verse one here\n");
  mkdirSync(path.join(folder, "clips"), { recursive: true });
  makeClip(path.join(folder, "clips", "a.mp4"), 4, "red");
  makeClip(path.join(folder, "clips", "b.mp4"), 4, "blue");
}, 120_000);

afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

const lyricsTxt = () => path.join(folder, "lyrics.txt");
const hints = () => path.join(folder, "hints.lrc");
// A stem: a short WAV of its own length (so each has its own content).
const lengths: Record<string, number> = { "stem-take-1": 10, "other-version": 9, "stem-take-2": 11, "stem-take-3": 8 };
const writeStem = (content: string) => {
  const file = path.join(root, "in", `${content}.wav`);
  if (!existsSync(file)) makeSong(file, lengths[content] ?? 7);
  if (content === "other-version") others.add(sha(file));
  return file;
};

describe("the voice source", () => {
  it("without vocals.wav: the vocals the app separates (Demucs), nothing checked", async () => {
    expect(await resolveVoiceSource(ws, sp, { check: stemCheck })).toEqual(DEMUCS);
    expect(checks).toEqual([]);
  });

  it("the first alignment (no stem yet) is made on Demucs", async () => {
    const log: string[] = [];
    const a = await ensureAlignment(ws, sp, { lyricsTxt: lyricsTxt(), hint: hints(), durationMs: 12_000, align, log: (m) => log.push(m) });
    expect(a.voice.kind).toBe("demucs");
    expect(aligned).toEqual([{ stem: "none", hint: expect.stringContaining("hints-") }]);
    expect(log).toContain("lyrics: voice: separated by the app");
    const guarded = await applyVocalGuard(ws, sp, a, { voiceMap, firstWords });
    expect(maps).toEqual(["none"]);
    // The Demucs voice map keeps its old name (nothing stored before L1a is redone).
    expect(guarded.guard!.voiceMap).toMatch(/\/voice-[0-9a-f]{12}\.v2\.json$/);
  });

  it("vocals.wav that follows the song: lined up, checked once per stem content", async () => {
    copyFileSync(writeStem("stem-take-1"), path.join(folder, "vocals.wav"));
    const v = await resolveVoiceSource(ws, sp, { check: stemCheck });
    expect(v).toMatchObject({ kind: "stem", label: "vocal stem, offset 1.8 s", offsetMs: 1800, message: "Vocal stem lined up: 1.8 s offset, from trimming the song's start." });
    expect(voiceKey(v)).toMatch(/^stem-[0-9a-f]{12}-1800ms$/);
    await resolveVoiceSource(ws, sp, { check: stemCheck });
    expect(checks.length).toBe(1); // cached
    // The record for the manifest: no paths (the stem is never part of an output).
    expect(voiceRecord(v)).toEqual({ kind: "stem", label: "vocal stem, offset 1.8 s", offset_ms: 1800, stem_sha256: v.stemHash, message: v.message });
  });

  it("a corrected speed difference is part of the label, the key and the record (only then)", () => {
    const base: StemCheck = { status: "lined-up", offset_ms: 660, message: "m", reason: "r", stem_hash: "ab".repeat(32), song_hash: "cd".repeat(32) };
    const plain = sourceFromCheck(base, "vocals.wav");
    expect(plain.label).toBe("vocal stem, offset 0.7 s");
    expect(voiceKey(plain)).toBe(`stem-${"ab".repeat(6)}-660ms`);
    expect(voiceRecord(plain)).not.toHaveProperty("speed");
    expect(voiceKey(sourceFromCheck({ ...base, speed: null }, "vocals.wav"))).toBe(voiceKey(plain));
    const fast = sourceFromCheck({ ...base, speed: 1.002 }, "vocals.wav");
    expect(fast).toMatchObject({ label: "vocal stem, offset 0.7 s, speed corrected", speed: 1.002 });
    expect(voiceKey(fast)).toBe(`stem-${"ab".repeat(6)}-660ms-x1.00200`);
    expect(voiceRecord(fast)).toMatchObject({ offset_ms: 660, speed: 1.002 });
    expect(stemCheckFile("/s", "c".repeat(20), "d".repeat(20))).toMatch(/stem-check-c{12}-d{12}\.v2\.json$/);
  });

  it("re-aligns on the stem (new cache key), keeps the hints, and the Demucs alignment stays stored", async () => {
    const log: string[] = [];
    const a = await ensureAlignment(ws, sp, { lyricsTxt: lyricsTxt(), hint: hints(), durationMs: 12_000, align, log: (m) => log.push(m), stemCheck });
    expect(a.voice.kind).toBe("stem");
    expect(aligned.at(-1)!.stem).toBe(path.join(folder, "vocals.wav"));
    expect(aligned.at(-1)!.hint).toBe(aligned[0].hint); // the same stored hints
    expect(log).toContain("lyrics: the vocal stem is new: the song is aligned again on it (taps in hints.lrc kept; starts set by hand before the stem are reset once, with Undo in the Lyrics tab).");
    expect(log.some((l) => l.startsWith("lyrics: voice: vocal stem, offset 1.8 s (vocals.wav)."))).toBe(true);
    const stored = readdirSync(path.dirname(a.lrcFile)).filter((f) => /^aligned-.*\.lrc$/.test(f));
    expect(stored.length).toBe(2);
    // The voice map and the recognised words are keyed by the stem too.
    const guarded = await applyVocalGuard(ws, sp, a, { voiceMap, firstWords });
    expect(maps.at(-1)).toBe(path.join(folder, "vocals.wav"));
    expect(guarded.guard!.voiceMap).toMatch(/\/voice-[0-9a-f]{12}-stem-[0-9a-f]{12}-1800ms\.v2\.json$/);
    expect(guarded.guard!.check.voice).toBe("vocal stem, offset 1.8 s");
    if (words.length) expect(words.at(-1)).toBe(path.join(folder, "vocals.wav"));
    // A second run reuses everything.
    const again = await ensureAlignment(ws, sp, { lyricsTxt: lyricsTxt(), hint: hints(), durationMs: 12_000, align, stemCheck });
    expect(again.lrcFile).toBe(a.lrcFile);
  });

  it("a stem that doesn't follow the song: Demucs, with the plain message, and the stored Demucs alignment is used", async () => {
    copyFileSync(writeStem("other-version"), path.join(folder, "vocals.wav"));
    const before = aligned.length;
    const log: string[] = [];
    const a = await ensureAlignment(ws, sp, { lyricsTxt: lyricsTxt(), hint: hints(), durationMs: 12_000, align, log: (m) => log.push(m), stemCheck });
    expect(a.voice).toMatchObject({ kind: "demucs", label: "separated by the app (the vocal stem doesn't follow the song)" });
    expect(aligned.length).toBe(before); // the Demucs alignment was stored: not aligned again
    expect(log.some((l) => l.includes("This vocal stem doesn't follow the song: probably another version of the song, or the song was edited in the middle."))).toBe(true);
  });
});

describe("the Assets tab and the Prepare to-do", () => {
  it("the song folder's vocal stems are never taken for the song", () => {
    const dir = path.join(root, "folder");
    mkdirSync(dir, { recursive: true });
    for (const f of ["These Empty Roads.wav", "vocals.wav", "backing-vocals.wav", "lyrics.txt"]) writeFileSync(path.join(dir, f), "x");
    expect(path.basename(songFolderFiles(dir).song)).toBe("These Empty Roads.wav");
  });

  it("adding the stem: the old one kept in .studio\\replaced\\, checked at once, lyric timing queued once; the song untouched", async () => {
    const songFile = sp.songFile;
    const before = sha(songFile);
    const r = await storeVocalStem(ws, sp.project.id, writeStem("stem-take-2"), "These Empty Roads (Lead Vocal).wav", { check: stemCheck });
    expect(r).toMatchObject({ stored: expect.stringMatching(/\/These Empty Roads \(Lead Vocal\)\.wav$/), status: "lined-up", offsetMs: 1800, retimed: true, message: "Vocal stem lined up: 1.8 s offset, from trimming the song's start." });
    expect(sha(path.join(folder, "These Empty Roads (Lead Vocal).wav"))).toBe(sha(writeStem("stem-take-2"))); // its own name
    const replaced = readdirSync(path.join(folder, ".studio", "replaced")).filter((f) => f.endsWith("-vocals.wav"));
    expect(replaced.length).toBe(1);
    expect(sha(path.join(folder, ".studio", "replaced", replaced[0]))).toBe(sha(writeStem("other-version")));
    await storeVocalStem(ws, sp.project.id, writeStem("stem-take-3"), "vocals.wav", { check: stemCheck });
    expect(readdirSync(path.join(folder, ".studio", "replaced")).some((f) => f.endsWith("-These Empty Roads (Lead Vocal).wav"))).toBe(true); // kept under its own name
    const queued = ws.db.select().from(makeRun).where(eq(makeRun.project_id, sp.project.id)).all().filter((x) => x.status === "queued");
    expect(queued.length).toBe(1); // one lyric-timing run waiting, not two
    expect(queued[0].label).toBe("Lyric timing · vocal stem");
    expect(sha(songFile)).toBe(before);
    await expect(storeVocalStem(ws, sp.project.id, writeStem("stem-take-1"), "vocals.mp3", { check: stemCheck })).rejects.toThrow("The vocal stem must be a WAV file");
  });

  it("the Assets tab shows which stem is used; Prepare suggests one only when there is none (never a blocker)", async () => {
    const assets = await songAssets(ws, sp.project.id);
    expect(assets.vocals).toMatchObject({ name: "vocals.wav", status: "lined-up", offsetMs: 1800 });
    expect((await songTodo(ws, sp.project.id)).find((t) => t.id === "vocals")).toBeUndefined();
    const stem = path.join(folder, "vocals.wav");
    const kept = readFileSync(stem);
    rmSync(stem);
    const todo = (await songTodo(ws, sp.project.id)).find((t) => t.id === "vocals")!;
    expect(todo).toMatchObject({ text: "Add the vocal stem for better lyric timing.", tab: "assets", blocking: false });
    writeFileSync(stem, kept);
  });

  it("the queued lyric-timing run aligns on the stem and says so", async () => {
    const run = await workOnce(ws, undefined, { align, voiceMap, firstWords });
    expect(run).toMatchObject({ status: "done", label: "Lyric timing · vocal stem" });
    expect(run!.message).toMatch(/^Lyric timing on the vocal stem, offset 1\.8 s: \d+ lines? to review · \d+ lines? low confidence · \d+ lines? moved to the vocals$/);
    expect(aligned.at(-1)!.stem).toBe(path.join(folder, "vocals.wav"));
  });

  it("timeLyrics on Demucs on purpose (the comparison) never touches the stem's alignment", async () => {
    const t = await timeLyrics(ws, sp.project.id, { voice: DEMUCS, align, voiceMap, firstWords, save: false });
    expect(t.voice.kind).toBe("demucs");
    expect(t.summary.startsWith("Lyric timing on the vocals separated by the app:")).toBe(true);
  });
});

describe("nothing from the stems in any output", () => {
  it("the planned videos (the same planner as the render) use the song as their audio, never a stem", async () => {
    const stems = [path.join(folder, "vocals.wav")];
    writeFileSync(path.join(folder, "backing-vocals.wav"), "backing");
    stems.push(path.join(folder, "backing-vocals.wav"));
    const songBefore = sha(sp.songFile);
    const stemBefore = stems.map(sha);
    const dry = await makeVideos({
      workspaceDir: ws.dir,
      song: sp.songFile,
      lyrics: lyricsTxt(),
      variations: 1,
      section: "0:01-0:08",
      dryRun: true,
      voiceMap,
      firstWords,
      align: async () => {
        throw new Error("a dry run never aligns");
      },
    });
    const props = dry.platforms[0].plan!.videos[0].props;
    const text = JSON.stringify(props);
    expect(props.audio?.src).toBeTruthy();
    expect(props.audio!.src).not.toMatch(/vocals|stems/i);
    expect(text).not.toMatch(/vocals\.wav|backing-vocals|cache\/stems|htdemucs|-suno-/);
    expect(sha(sp.songFile)).toBe(songBefore);
    expect(stems.map(sha)).toEqual(stemBefore); // the stems are only read too
    expect(existsSync(sp.songFile)).toBe(true);
    expect(songHashBefore).toBe(songBefore);
  }, 300_000);
});
