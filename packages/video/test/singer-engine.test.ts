// Engine default and "Make singing clips" with a group that cannot be made (28 Nov 2026, Paul pressed Make on Wedding
// Day with line 17 sung from a video): the song's remembered engine applies to pictures only; one group that cannot be
// made never stops the others; the cost counts only what is sent.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, openWorkspace, project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, ensureAlignment, songPathsById } from "../src/node";
import { readPictures } from "../src/node/animate";
import { engineOf, setSingerEngine, setSingerLine, singerView, startSinging, type SingerSettings } from "../src/node/singer";
import { fakeAlign, ffmpeg, LYRICS, makeClip } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-singer-engine-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
const STUB = { LYRIC_GENERATE_STUB: "1" } as NodeJS.ProcessEnv;
let ws: Workspace;
let id = "";
let pics = "";

beforeAll(async () => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  const song = path.join(root, "Engine Song.wav");
  ffmpeg("-f", "lavfi", "-i", "aevalsrc='(random(0)*2-1)*(0.4+0.3*sin(2*PI*0.37*t))':s=44100:d=12", "-ac", "2", song);
  writeFileSync(path.join(root, "lyrics.txt"), `${LYRICS.join("\n")}\n`);
  id = (await createSong(ws, { song, lyrics: path.join(root, "lyrics.txt") })).id;
  const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
  const paths = songPathsById(ws, id);
  const sp = { project: p, songFile: absPath(ws, p.audio_path!), songHash: p.audio_hash!, created: false };
  await ensureAlignment(ws, sp, { lyricsTxt: paths.lyricsTxt, durationMs: 12_000, align: fakeAlign }); // a line every 1.5 s from 1 s
  pics = path.join(paths.root, "pictures");
  mkdirSync(pics, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=144x256", "-frames:v", "1", path.join(pics, "jennifer.jpg"));
  makeClip(path.join(pics, "singing clip.mp4"), 3, "red", "144x256");
}, 120_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("the engine of a group", () => {
  it("the song's remembered engine applies to a picture, not to a video; a group's own choice always stands", () => {
    const s: SingerSettings = { lines: {}, engine: "mv" };
    expect(engineOf(s, 1, "jennifer.jpg")).toBe("mv");
    expect(engineOf(s, 1)).toBe("mv"); // (no source known: as before)
    expect(engineOf(s, 5, "singing clip.mp4")).toBe("infinitetalk");
    expect(engineOf({ ...s, engines: { "5": "mv" } }, 5, "singing clip.mp4")).toBe("mv"); // chosen for that group: "needs a picture" stands
    expect(engineOf({ lines: {} }, 5, "jennifer.jpg")).toBe("infinitetalk");
  });
});

describe("Make singing clips with one group that cannot be made", () => {
  it("the effective engine of a video group is InfiniteTalk, and nothing is blocked", async () => {
    setSingerLine(ws, id, 1, "jennifer.jpg");
    setSingerLine(ws, id, 4, "singing clip.mp4");
    setSingerEngine(ws, id, 1, "mv"); // the song now remembers MV Generator
    const v = await singerView(ws, id, STUB);
    expect(v.lines!.find((l) => l.number === 1)!.engine).toBe("mv");
    expect(v.lines!.find((l) => l.number === 4)!.engine).toBe("infinitetalk");
    expect(v.blocked).toEqual([]);
    expect(v.toMake.lines).toEqual([1, 4]);
  });
  it("a video group set to the MV Generator by hand is left out with a note, the picture group is made, the cost counts only that", async () => {
    setSingerEngine(ws, id, 4, "mv");
    const v = await singerView(ws, id, STUB);
    expect(v.blocked).toEqual([{ line: 4, note: "Line 4 was not made: it is sung from a video and the MV Generator needs a picture: choose a picture or InfiniteTalk." }]);
    expect(v.toMake.lines).toEqual([1]); // the bar's cost counts only what is sent
    const r = await startSinging(ws, id, { capUsd: 50 }, STUB);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].source).toBe("jennifer.jpg");
    expect(r.lines).toEqual([1]);
    expect(r.usd).toBe(v.toMake.usd);
    expect(r.notes).toEqual([v.blocked[0].note]);
    expect(readPictures(pics).pictures["singing clip.mp4"]?.takes ?? []).toHaveLength(0);
  });
  it("only the video group is asked for: nothing is sent, in plain words", async () => {
    await expect(startSinging(ws, id, { capUsd: 50, lines: [4] }, STUB)).rejects.toThrow(/Line 4 was not made: it is sung from a video and the MV Generator needs a picture.*Nothing was sent\./);
  });
  it("one group by its first line (the line's own Make button) makes just that one", async () => {
    setSingerEngine(ws, id, 4, "infinitetalk");
    const r = await startSinging(ws, id, { capUsd: 50, lines: [4], draft: true }, STUB);
    expect(r.jobs.map((j) => j.source)).toEqual(["singing clip.mp4"]);
    expect(r.lines).toEqual([4]);
    expect(r.notes).toEqual([]);
  });
});
