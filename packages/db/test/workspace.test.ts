import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  STYLE_PRESETS,
  TABLES,
  absPath,
  addClip,
  clip,
  createCollection,
  createProject,
  ffmpegBin,
  openWorkspace,
  project,
  safeName,
  seedStylePresets,
  stylePreset,
  thumbnailTimeSeconds,
  type Workspace,
} from "../src";
import { brightness, makeClip, makeSong, tempDir } from "./helpers";

let ws: Workspace;
let fixtures: ReturnType<typeof tempDir>;
let wsTemp: ReturnType<typeof tempDir>;

beforeAll(() => {
  fixtures = tempDir("fixtures");
  wsTemp = tempDir("workspace");
  ws = openWorkspace(wsTemp.dir);
});

afterAll(() => {
  ws?.close();
  wsTemp?.cleanup();
  fixtures?.cleanup();
});

describe("database", () => {
  it("creates all 9 tables from the migrations", () => {
    const rows = ws.db.$client
      .prepare("select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name != 'sqlite_sequence'")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name).sort()).toEqual(Object.keys(TABLES).sort());
  });

  it("seeds exactly the 10 style presets, even when run twice", () => {
    expect(seedStylePresets(ws.db)).toBe(10);
    expect(seedStylePresets(ws.db)).toBe(0);
    const names = ws.db.select().from(stylePreset).all().map((s) => s.name).sort();
    expect(names).toEqual(
      ["Simple", "Bold", "Blur", "Brat", "TikTok", "Inked", "Hollow", "Subtitle", "Matrix", "Elegant"].sort(),
    );
    expect(STYLE_PRESETS).toHaveLength(10);
  });

  it("Bold is 72 px: new databases get it, existing ones still at 84 px are updated, a changed size is kept", () => {
    const boldSize = () => ws.db.select().from(stylePreset).where(eq(stylePreset.name, "Bold")).get()!.default_size;
    expect(boldSize()).toBe(72);
    ws.db.update(stylePreset).set({ default_size: 84 }).where(eq(stylePreset.name, "Bold")).run(); // old database
    seedStylePresets(ws.db);
    expect(boldSize()).toBe(72);
    ws.db.update(stylePreset).set({ default_size: 90 }).where(eq(stylePreset.name, "Bold")).run(); // user's choice
    seedStylePresets(ws.db);
    expect(boldSize()).toBe(90);
    ws.db.update(stylePreset).set({ default_size: 72 }).where(eq(stylePreset.name, "Bold")).run();
  });

  it("rejects values outside the allowed lists", () => {
    expect(() =>
      ws.db.$client.prepare("insert into render_job (id, variation_id, status) values ('x', 'y', 'paused')").run(),
    ).toThrow();
  });
});

describe("workspace service", () => {
  it("creates a project and copies the song into projects/<id>/audio", async () => {
    const song = makeSong(path.join(fixtures.dir, "My Song.wav"));
    const p = await createProject(ws, { title: "My Song", audioFile: song });

    expect(p.title).toBe("My Song");
    expect(p.artist).toBe("Life Lyrics");
    expect(p.audio_path).toBe(`projects/${p.id}/audio/My Song.wav`);
    expect(p.duration_ms).toBeGreaterThan(2900);
    expect(p.duration_ms).toBeLessThan(3100);
    expect(p.created_at).toBeInstanceOf(Date);

    expect(statSync(absPath(ws, p.audio_path!)).size).toBe(statSync(song).size);
    expect(existsSync(absPath(ws, `projects/${p.id}/exports`))).toBe(true);
    expect(ws.db.select().from(project).where(eq(project.id, p.id)).get()?.title).toBe("My Song");
  });

  it("adds a clip to a collection with its size, length and a JPG thumbnail", async () => {
    const video = makeClip(path.join(fixtures.dir, "beach.mp4"), 2.5);
    const coll = createCollection(ws, "Summer: B-roll");
    const c = await addClip(ws, { collectionId: coll.id, file: video });

    expect(c.path).toBe("clips/Summer_ B-roll/beach.mp4");
    expect(existsSync(absPath(ws, c.path))).toBe(true);
    expect(c.width).toBe(360);
    expect(c.height).toBe(640);
    expect(c.duration_ms).toBeGreaterThan(2400);
    expect(c.duration_ms).toBeLessThan(2600);
    expect(c.source).toBe("upload");

    expect(c.thumb_path).toBe(`thumbs/${c.id}.jpg`);
    const jpg = readFileSync(absPath(ws, c.thumb_path!));
    expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8]); // JPEG file signature
    // The clip is black for 0.5 s, then white: a thumbnail at ~1 s must be white, not black.
    expect(brightness(absPath(ws, c.thumb_path!))).toBeGreaterThan(200);

    // Adding the same file again keeps both copies.
    const again = await addClip(ws, { collectionId: coll.id, file: video });
    expect(again.path).toBe("clips/Summer_ B-roll/beach-2.mp4");
    expect(ws.db.select().from(clip).all()).toHaveLength(2);
  });

  it("takes the thumbnail from the middle of clips shorter than 2 seconds", async () => {
    const video = makeClip(path.join(fixtures.dir, "short.mp4"), 1.2, 0.3);
    const coll = createCollection(ws, "Short clips");
    const c = await addClip(ws, { collectionId: coll.id, file: video });
    expect(brightness(absPath(ws, c.thumb_path!))).toBeGreaterThan(200);
  });

  it("rejects a file without video and leaves nothing behind", async () => {
    const song = makeSong(path.join(fixtures.dir, "not-a-video.wav"));
    const coll = createCollection(ws, "Broken");
    await expect(addClip(ws, { collectionId: coll.id, file: song })).rejects.toThrow(/No video/);
    expect(existsSync(absPath(ws, "clips/Broken/not-a-video.wav"))).toBe(false);
  });
});

describe("helpers", () => {
  it("thumbnail time is 1 s, or the middle of clips shorter than 2 s", () => {
    expect(thumbnailTimeSeconds(10_000)).toBe(1);
    expect(thumbnailTimeSeconds(2_000)).toBe(1);
    expect(thumbnailTimeSeconds(1_200)).toBeCloseTo(0.6);
    expect(thumbnailTimeSeconds(400)).toBeCloseTo(0.2);
  });

  it("makes names safe for Windows", () => {
    expect(safeName('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(safeName("CON")).toBe("_CON");
    expect(safeName("song. ")).toBe("song");
    expect(safeName("   ")).toBe("untitled");
  });
});

describe("photos as clips", () => {
  it("adds a jpg with its size, no duration and a thumbnail", async () => {
    const t = tempDir("photo");
    const ws = openWorkspace(path.join(t.dir, "ws"));
    const photo = path.join(t.dir, "portrait.jpg");
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=600x1000", "-frames:v", "1", photo]);
    const coll = createCollection(ws, "photos");
    const c = await addClip(ws, { collectionId: coll.id, file: photo });
    expect([c.width, c.height, c.duration_ms]).toEqual([600, 1000, 0]);
    expect(existsSync(absPath(ws, c.thumb_path!))).toBe(true);
    ws.close();
    t.cleanup();
  });
});
