// Original file names (31 Oct 2026): the song, lyrics, vocal stem and backing vocals keep the names the
// user gave them; the roles are linked in <song folder>\.studio\files.json; files put into the folder by
// hand are recognised (or asked about once); songs made before (song.wav, lyrics.txt, vocals.wav) keep
// working with nothing renamed; the song file is never changed. And the stem timing as the base: hand-set
// starts made before the stem are reset once (kept in .studio\replaced\, Undo brings them back).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRun, openWorkspace, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignSongFile, replaceAsset, songAssets, storeVocalStem } from "../src/node/assets";
import { readLinks } from "../src/node/file-links";
import { readHandRecord, resetAllHandTimes, resetHandTimesMadeBeforeStem, undoHandReset } from "../src/node/hand-reset";
import { createSong } from "../src/node/library";
import { recognizeSongFiles } from "../src/node/song-files";
import { resolveVoiceSource, type StemCheck, type StemCheckRunner, type VoiceSource } from "../src/node/voice-source";
import { findOrCreateSongProject, songFolderFiles, songPathsById } from "../src/node";
import { parseHandTimes } from "../src/hand-times";
import { LYRICS, makeSong } from "./media-helpers";

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const root = mkdtempSync(path.join(os.tmpdir(), "lyric-files-"));
const inbox = path.join(root, "in");
let ws: Workspace;

// Stands in for services/audio vocal_stem: a stem whose content is in `others` doesn't follow the song.
const others = new Set<string>();
const checked: string[] = [];
const check: StemCheckRunner = async (a) => {
  checked.push(path.basename(a.stem));
  const ok = !others.has(sha(a.stem));
  const result: StemCheck = { status: ok ? "lined-up" : "rejected", offset_ms: ok ? 0 : null, message: ok ? "Vocal stem lined up: it starts with the song (no offset)." : "This vocal stem doesn't follow the song.", reason: "test", stem_hash: sha(a.stem), song_hash: sha(a.song) };
  writeFileSync(a.out, JSON.stringify(result));
};

const inFile = (name: string, seconds?: number) => {
  const f = path.join(inbox, name);
  if (seconds) makeSong(f, seconds);
  return f;
};
const text = (name: string, content = `${LYRICS.join("\n")}\n`) => {
  const f = path.join(inbox, name);
  writeFileSync(f, content);
  return f;
};
const listReplaced = (folder: string) => (existsSync(path.join(folder, ".studio", "replaced")) ? readdirSync(path.join(folder, ".studio", "replaced")) : []);

beforeAll(() => {
  ws = openWorkspace(path.join(root, "workspace"));
  mkdirSync(inbox, { recursive: true });
}, 60_000);

afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("uploads keep their own names", () => {
  let id: string;
  let folder: string;
  let songHash: string;

  it("+ New song: the song and the lyrics keep their names, linked in .studio\\files.json", async () => {
    const song = inFile("These Empty Roads (Master).wav", 12);
    songHash = sha(song);
    const lyrics = text("lyrics-upload.txt");
    const r = await createSong(ws, { song, lyrics, lyricsName: "TER lyrics v3.txt", title: "These Empty Roads" });
    id = r.id;
    const paths = songPathsById(ws, id);
    folder = paths.root;
    expect(path.basename(paths.audio!)).toBe("These Empty Roads (Master).wav");
    expect(path.basename(paths.lyricsTxt)).toBe("TER lyrics v3.txt");
    expect(existsSync(path.join(folder, "song.wav"))).toBe(false);
    expect(existsSync(path.join(folder, "lyrics.txt"))).toBe(false);
    expect(readLinks(folder)).toMatchObject({ song: "These Empty Roads (Master).wav", lyrics: "TER lyrics v3.txt" });
    expect(sha(paths.audio!)).toBe(songHash); // the song file is only ever copied
  }, 60_000);

  it("the vocal stem and the backing vocals keep their names; the stem is used for the timing", async () => {
    const r = await storeVocalStem(ws, id, inFile("upload-1.wav", 12), "These Empty Roads (Lead Vocal).wav", { check, queue: false });
    expect(r.status).toBe("lined-up");
    expect(r.stored.endsWith("/These Empty Roads (Lead Vocal).wav")).toBe(true);
    await replaceAsset(ws, id, "backingVocals", inFile("upload-2.wav", 11), "These Empty Roads (Backing Vocals).wav");
    const paths = songPathsById(ws, id);
    expect(path.basename(paths.vocals!)).toBe("These Empty Roads (Lead Vocal).wav");
    expect(path.basename(paths.backingVocals!)).toBe("These Empty Roads (Backing Vocals).wav");
    const p = ws.db.select().from(projectTable).where(eq(projectTable.id, id)).get()!;
    const voice = await resolveVoiceSource(ws, { project: p, songHash: p.audio_hash!, songFile: paths.audio! }, { check });
    expect(voice.kind).toBe("stem");
    expect(path.basename(voice.stemFile!)).toBe("These Empty Roads (Lead Vocal).wav");
    const assets = await songAssets(ws, id, { check, queue: false });
    expect(assets.vocals?.name).toBe("These Empty Roads (Lead Vocal).wav");
    expect(assets.backingVocals?.endsWith("These Empty Roads (Backing Vocals).wav")).toBe(true);
    expect(assets.lyrics?.file.endsWith("TER lyrics v3.txt")).toBe(true);
    expect(assets.unassigned).toEqual([]);
    expect(sha(paths.audio!)).toBe(songHash);
  }, 60_000);

  it("Replace keeps the new file's name and moves the old one to .studio\\replaced\\ under its own name", async () => {
    await replaceAsset(ws, id, "lyrics", text("tmp-1.txt", "Verse one here\nThrough the night\n"), "TER lyrics v4.txt");
    await replaceAsset(ws, id, "song", inFile("tmp-2.wav", 12), "These Empty Roads (Master v2).wav");
    await storeVocalStem(ws, id, inFile("tmp-3.wav", 10), "TER Lead Vocal take 2.wav", { check, queue: false });
    const paths = songPathsById(ws, id);
    expect(path.basename(paths.lyricsTxt)).toBe("TER lyrics v4.txt");
    expect(path.basename(paths.audio!)).toBe("These Empty Roads (Master v2).wav");
    expect(path.basename(paths.vocals!)).toBe("TER Lead Vocal take 2.wav");
    const kept = listReplaced(folder);
    for (const name of ["TER lyrics v3.txt", "These Empty Roads (Master).wav", "These Empty Roads (Lead Vocal).wav"]) expect(kept.some((f) => f.endsWith(`-${name}`))).toBe(true);
    // the old song is moved, never changed
    expect(sha(path.join(folder, ".studio", "replaced", kept.find((f) => f.endsWith("-These Empty Roads (Master).wav"))!))).toBe(songHash);
    expect(readdirSync(folder).filter((f) => /\.(wav|txt)$/.test(f)).sort()).toEqual(["TER Lead Vocal take 2.wav", "TER lyrics v4.txt", "These Empty Roads (Backing Vocals).wav", "These Empty Roads (Master v2).wav"]);
  }, 60_000);

  it("a new file with the name of another file of the folder never overwrites it", async () => {
    await replaceAsset(ws, id, "lyrics", text("tmp-4.txt"), "These Empty Roads (Master v2).wav.txt");
    await storeVocalStem(ws, id, inFile("tmp-5.wav", 9), "These Empty Roads (Backing Vocals).wav", { check, queue: false });
    const paths = songPathsById(ws, id);
    expect(path.basename(paths.vocals!)).toBe("These Empty Roads (Backing Vocals)-2.wav");
    expect(path.basename(paths.backingVocals!)).toBe("These Empty Roads (Backing Vocals).wav");
  }, 60_000);

  it("a stem without its extension (\"Love Is A Good Thing Lead Vocal\") is taken when it is a WAV; .wav is added", async () => {
    const bare = path.join(inbox, "no-ext");
    makeSong(`${bare}.wav`, 8);
    renameSync(`${bare}.wav`, bare);
    const r = await storeVocalStem(ws, id, bare, "Love Is A Good Thing Lead Vocal", { check, queue: false });
    expect(r.stored.endsWith("/Love Is A Good Thing Lead Vocal.wav")).toBe(true);
    writeFileSync(path.join(inbox, "not-audio"), "hello");
    await expect(storeVocalStem(ws, id, path.join(inbox, "not-audio"), "Some Lead Vocal", { check, queue: false })).rejects.toThrow("The vocal stem must be a WAV file");
  }, 60_000);

  it("pnpm make \"<song folder>\" uses the same links", () => {
    const files = songFolderFiles(folder);
    expect(path.basename(files.song)).toBe("These Empty Roads (Master v2).wav");
    expect(path.basename(files.lyrics)).toBe("These Empty Roads (Master v2).wav.txt");
  });
});

describe("files put into the song folder by hand", () => {
  let id: string;
  let folder: string;
  let song: string;

  beforeAll(async () => {
    const sp = await findOrCreateSongProject(ws, inFile("Midnight Drive.wav", 8));
    id = sp.project.id;
    folder = songPathsById(ws, id).root;
    song = songPathsById(ws, id).audio!;
  }, 60_000);

  it("a new song keeps its own name (no song.wav)", () => {
    expect(path.basename(song)).toBe("Midnight Drive.wav");
    expect(readLinks(folder).song).toBe("Midnight Drive.wav");
  });

  it("the only .txt is the lyrics; stems are told apart by their names; a copy of the song is not used", async () => {
    writeFileSync(path.join(folder, "Midnight Drive - words.txt"), `${LYRICS.join("\n")}\n`);
    makeSong(path.join(folder, "Midnight Drive (Backing Vocals).wav"), 7);
    makeSong(path.join(folder, "Midnight Drive (Lead Vocal).wav"), 6);
    copyFileSync(song, path.join(folder, "Midnight Drive copy.wav"));
    const r = await recognizeSongFiles(ws, id, { check, queue: false });
    expect(r.linked).toEqual(
      expect.arrayContaining([
        { name: "Midnight Drive - words.txt", role: "lyrics" },
        { name: "Midnight Drive (Backing Vocals).wav", role: "backingVocals" },
        { name: "Midnight Drive (Lead Vocal).wav", role: "vocals" },
      ]),
    );
    expect(r.copies).toEqual(["Midnight Drive copy.wav"]);
    expect(r.unassigned).toEqual([]);
    const paths = songPathsById(ws, id);
    expect(path.basename(paths.lyricsTxt)).toBe("Midnight Drive - words.txt");
    expect(path.basename(paths.vocals!)).toBe("Midnight Drive (Lead Vocal).wav");
    expect(existsSync(path.join(folder, "Midnight Drive copy.wav"))).toBe(true); // nothing moved or renamed
  }, 60_000);

  it("an unclear file is asked about once; Not used is remembered", async () => {
    makeSong(path.join(folder, "take 7.wav"), 5);
    writeFileSync(path.join(folder, "notes.txt"), "call the label\n");
    let assets = await songAssets(ws, id, { check, queue: false });
    expect(assets.unassigned).toEqual(
      expect.arrayContaining([
        { name: "take 7.wav", kind: "audio", guess: null },
        { name: "notes.txt", kind: "text", guess: null },
      ]),
    );
    await assignSongFile(ws, id, "notes.txt", "notUsed");
    await assignSongFile(ws, id, "take 7.wav", "notUsed");
    assets = await songAssets(ws, id, { check, queue: false });
    expect(assets.unassigned).toEqual([]);
    expect(existsSync(path.join(folder, "notes.txt"))).toBe(true);
  }, 60_000);

  it("\"What is this file?\" → Vocal stem: the file keeps its name and place, the old stem goes to .studio\\replaced\\", async () => {
    makeSong(path.join(folder, "MD vox final.wav"), 5.5);
    const assets = await songAssets(ws, id, { check, queue: false });
    expect(assets.unassigned).toEqual([{ name: "MD vox final.wav", kind: "audio", guess: "vocals" }]); // a stem is there already: asked
    await assignSongFile(ws, id, "MD vox final.wav", "vocals", { check, queue: false });
    expect(path.basename(songPathsById(ws, id).vocals!)).toBe("MD vox final.wav");
    expect(existsSync(path.join(folder, "MD vox final.wav"))).toBe(true);
    expect(listReplaced(folder).some((f) => f.endsWith("-Midnight Drive (Lead Vocal).wav"))).toBe(true);
  }, 60_000);

  it("a WAV without its extension dropped by hand is recognised too (and keeps its name)", async () => {
    makeSong(path.join(folder, "tmp.wav"), 4.5);
    renameSync(path.join(folder, "tmp.wav"), path.join(folder, "Midnight Drive Backing"));
    rmSync(path.join(folder, "Midnight Drive (Backing Vocals).wav")); // the backing vocals are gone (moved away by hand)
    const r = await recognizeSongFiles(ws, id, { check, queue: false });
    expect(r.linked).toContainEqual({ name: "Midnight Drive Backing", role: "backingVocals" });
    expect(path.basename(songPathsById(ws, id).backingVocals!)).toBe("Midnight Drive Backing");
  }, 60_000);

  it("the song renamed in Explorer is found again by its content", async () => {
    const before = sha(song);
    renameSync(song, path.join(folder, "Midnight Drive FINAL.wav"));
    await recognizeSongFiles(ws, id, { check, queue: false });
    const paths = songPathsById(ws, id);
    expect(path.basename(paths.audio!)).toBe("Midnight Drive FINAL.wav");
    expect(readLinks(folder).song).toBe("Midnight Drive FINAL.wav");
    expect(sha(paths.audio!)).toBe(before);
  }, 60_000);
});

describe("a stem with a name that says nothing", () => {
  it("is the vocal stem when it lines up on the song, and the lyric timing is queued again", async () => {
    const sp = await findOrCreateSongProject(ws, inFile("Harbour Lights.wav", 9));
    const folder = songPathsById(ws, sp.project.id).root;
    writeFileSync(path.join(folder, "Harbour Lights.txt"), `${LYRICS.join("\n")}\n`);
    makeSong(path.join(folder, "track 3.wav"), 4);
    makeSong(path.join(folder, "track 4.wav"), 3);
    others.add(sha(path.join(folder, "track 3.wav"))); // track 3 doesn't follow the song
    const r = await recognizeSongFiles(ws, sp.project.id, { check });
    expect(r.linked).toContainEqual({ name: "track 4.wav", role: "vocals" });
    expect(r.unassigned).toEqual([{ name: "track 3.wav", kind: "audio", guess: null }]);
    expect(r.retimed).toBe(true);
    expect(ws.db.select().from(makeRun).where(eq(makeRun.project_id, sp.project.id)).all().some((x) => (x.options_json as { lyricsOnly?: boolean }).lyricsOnly)).toBe(true);
  }, 60_000);
});

describe("songs made before keep working with nothing renamed", () => {
  it("song.wav, lyrics.txt, vocals.wav and backing-vocals.wav without a files.json", async () => {
    const sp = await findOrCreateSongProject(ws, inFile("Old Song.wav", 7));
    const paths0 = songPathsById(ws, sp.project.id);
    const folder = paths0.root;
    // As the app made them before: song.wav (the database names it), lyrics.txt, vocals.wav, no links.
    renameSync(paths0.audio!, path.join(folder, "song.wav"));
    ws.db.update(projectTable).set({ audio_path: path.relative(ws.dir, path.join(folder, "song.wav")).split(path.sep).join("/") }).where(eq(projectTable.id, sp.project.id)).run();
    rmSync(path.join(folder, ".studio", "files.json"), { force: true });
    writeFileSync(path.join(folder, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
    makeSong(path.join(folder, "vocals.wav"), 6);
    makeSong(path.join(folder, "backing-vocals.wav"), 5);
    const before = readdirSync(folder).sort();
    const songHash = sha(path.join(folder, "song.wav"));
    const assets = await songAssets(ws, sp.project.id, { check, queue: false });
    expect(assets.song?.name).toBe("song.wav");
    expect(assets.lyrics?.file.endsWith("/lyrics.txt")).toBe(true);
    expect(assets.vocals?.name).toBe("vocals.wav");
    expect(assets.backingVocals?.endsWith("/backing-vocals.wav")).toBe(true);
    expect(assets.unassigned).toEqual([]);
    expect(readdirSync(folder).sort()).toEqual(before); // nothing renamed or moved
    expect(sha(path.join(folder, "song.wav"))).toBe(songHash);
    const files = songFolderFiles(folder);
    expect(path.basename(files.song)).toBe("song.wav");
    expect(path.basename(files.lyrics)).toBe("lyrics.txt");
  }, 60_000);

  it("pnpm make on a folder made by hand: the stems are not taken for the song", () => {
    const dir = path.join(root, "by-hand");
    mkdirSync(dir, { recursive: true });
    makeSong(path.join(dir, "Blue Hour.wav"), 3);
    makeSong(path.join(dir, "Blue Hour (Lead Vocal).wav"), 2);
    writeFileSync(path.join(dir, "Blue Hour lyrics.txt"), "Verse one here\n");
    writeFileSync(path.join(dir, "stills.txt"), "a.jpg\n");
    const files = songFolderFiles(dir);
    expect(path.basename(files.song)).toBe("Blue Hour.wav");
    expect(path.basename(files.lyrics)).toBe("Blue Hour lyrics.txt");
  }, 60_000);
});

describe("the vocal stem's timing is the base (hand-set starts made before the stem are reset once)", () => {
  const stem: VoiceSource = { kind: "stem", label: "vocal stem, offset 0.0 s", stemFile: "x.wav", stemHash: "a".repeat(64), offsetMs: 0 };
  const demucs: VoiceSource = { kind: "demucs", label: "separated by the app" };
  const taps = "[00:01.00]Verse one here\n[00:03.00]Hold on to me\n";
  let dir: string;
  let hints: string;

  beforeAll(() => {
    dir = path.join(root, "hand");
    mkdirSync(dir, { recursive: true });
    hints = path.join(dir, "hints.lrc");
    writeFileSync(hints, `${taps}[00:49.03]! #1 Verse one here\n[01:04.06]! #5 Hold on to me\n`);
  });

  it("nothing happens while the timing is on the vocals the app separates", () => {
    expect(resetHandTimesMadeBeforeStem(hints, demucs)).toBe(0);
    expect(parseHandTimes(readFileSync(hints, "utf8"))).toHaveLength(2);
  });

  it("on the stem: reset once; the taps stay byte for byte; the old hints.lrc is kept", () => {
    const said: string[] = [];
    expect(resetHandTimesMadeBeforeStem(hints, stem, (m) => said.push(m))).toBe(2);
    expect(readFileSync(hints, "utf8")).toBe(taps);
    const record = readHandRecord(hints)!;
    expect(record.reset).toMatchObject({ count: 2, why: "before-stem" });
    expect(readFileSync(path.join(dir, ".studio", "replaced", record.reset!.backup), "utf8")).toContain("[00:49.03]! #1");
    expect(said[0]).toContain("2 hand-set starts were made before the vocal stem");
    expect(resetHandTimesMadeBeforeStem(hints, stem)).toBe(0); // once
  });

  it("Undo brings them back, and they then count as made on the stem (not reset again)", () => {
    expect(undoHandReset(hints, stem)).toBe(2);
    expect(parseHandTimes(readFileSync(hints, "utf8")).map((t) => t.number)).toEqual([1, 5]);
    expect(readFileSync(hints, "utf8").startsWith(taps)).toBe(true);
    expect(readHandRecord(hints)?.reset).toBeUndefined();
    expect(resetHandTimesMadeBeforeStem(hints, stem)).toBe(0);
  });

  it("Reset all: every line back to the stem's timing, with Undo", () => {
    expect(resetAllHandTimes(hints, stem)).toBe(2);
    expect(readFileSync(hints, "utf8")).toBe(taps);
    expect(readHandRecord(hints)?.reset?.why).toBe("all");
    expect(undoHandReset(hints, stem)).toBe(2);
    expect(parseHandTimes(readFileSync(hints, "utf8"))).toHaveLength(2);
  });
});
