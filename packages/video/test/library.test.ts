// The studio's Library (Step 6.1): song cards from the database and the export folders, "+ New
// song", artists, per-artist brand folders, and the studio listening on this PC only.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin, openWorkspace, project, renderJob, variation, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { studioHost } from "../../../apps/studio/scripts/next.mjs";
import { appIcon, brandDirFor, checkNewSong, createSong, knownArtists, listSongs, loadBrand, loadFontCatalog, readProjectSettings } from "../src/node";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-library-"));
const inDir = path.join(root, "in");
let ws: Workspace;
const file = (name: string, content: string) => {
  const f = path.join(inDir, name);
  writeFileSync(f, content);
  return f;
};

beforeAll(() => {
  mkdirSync(inDir, { recursive: true });
  ws = openWorkspace(path.join(root, "workspace"));
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", path.join(inDir, "Hold On Tight.wav")]);
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x7a2e4d:s=64x64", "-frames:v", "1", path.join(inDir, "cover.jpg")]);
  file("lyrics.txt", "Verse one\n* Hold on to me\n");
  file("taps.lrc", "[00:01.00]Verse one\n[00:02.00]Hold on to me\n");
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("+ New song", () => {
  it("checks the files and names every problem", () => {
    const problems = checkNewSong({ song: file("song.txt", "x"), lyrics: file("empty.txt", "\n* \n"), cover: file("cover.gif", "x"), hints: file("taps.txt", "x") });
    expect(problems).toEqual([
      "The song must be a WAV or MP3 file (got song.txt).",
      "The lyrics file is empty.",
      "The cover must be a JPG, PNG or WEBP picture (got cover.gif).",
      "The hints must be an .lrc file of tapped times (got taps.txt).",
    ]);
    expect(checkNewSong({ song: "", lyrics: "" })).toEqual(["Choose the song (WAV or MP3).", "Choose the lyrics (lyrics.txt)."]);
    expect(checkNewSong({ song: path.join(inDir, "Hold On Tight.wav"), lyrics: path.join(inDir, "lyrics.txt"), hints: file("bad.lrc", "no stamps") })).toEqual(["The hints file has no time stamps like [00:12.34]."]);
  });

  it("creates the project with lyrics, cover, hints, artist and EP; the title defaults to the file name", async () => {
    const r = await createSong(ws, { song: path.join(inDir, "Hold On Tight.wav"), lyrics: path.join(inDir, "lyrics.txt"), cover: path.join(inDir, "cover.jpg"), hints: path.join(inDir, "taps.lrc"), artist: "Pômé", ep: "In The Mood for Life" });
    expect(r.created).toBe(true);
    const p = ws.db.select().from(project).where(eq(project.id, r.id)).get()!;
    expect([p.title, p.artist, p.cover_path]).toEqual(["Hold On Tight", "Pômé", `projects/${r.id}/audio/cover.jpg`]);
    const settings = readProjectSettings(ws, r.id);
    expect(settings).toMatchObject({ ep: "In The Mood for Life", lyricsTxt: `projects/${r.id}/lyrics/lyrics.txt` });
    expect(readFileSync(path.join(ws.dir, "projects", r.id, "lyrics", "lyrics.txt"), "utf8")).toBe("Verse one\n* Hold on to me\n");
    const hint = JSON.parse(readFileSync(path.join(ws.dir, "projects", r.id, "lyrics", "hint.json"), "utf8"));
    expect(hint.copy).toMatch(/^hints-[0-9a-f]{12}\.lrc$/); // pnpm make uses it automatically
  });

  it("the same song again (any file name) updates the project instead of making a duplicate", async () => {
    const copy = path.join(inDir, "renamed.wav");
    writeFileSync(copy, readFileSync(path.join(inDir, "Hold On Tight.wav")));
    const r = await createSong(ws, { song: copy, lyrics: file("lyrics2.txt", "New words\n"), title: "Hold On Tight (Acoustic)", artist: "Pômé" });
    expect(r.created).toBe(false);
    expect(r.updated).toEqual(["title", "lyrics"]);
    expect(ws.db.select().from(project).all()).toHaveLength(1);
    expect(ws.db.select().from(project).get()!.title).toBe("Hold On Tight (Acoustic)");
  });

  it("artists: Life Lyrics first, then every artist used and every brand folder", async () => {
    mkdirSync(path.join(ws.dir, "brand", "Client Band"), { recursive: true });
    writeFileSync(path.join(ws.dir, "brand", "Client Band", "brand.json"), "{}");
    expect(knownArtists(ws)).toEqual(["Life Lyrics", "Client Band", "Pômé"]);
  });
});

describe("song cards", () => {
  const touch = (dir: string, names: string[], qa: "PASS" | "WARN" = "PASS") => {
    mkdirSync(dir, { recursive: true });
    for (const n of names) {
      const content = n.endsWith(".qa.txt")
        ? `x\n${qa === "WARN" ? "[WARN] Clips repeated within 3 shots\n" : ""}Summary: ${qa}${qa === "WARN" ? " - Clips repeated within 3 shots" : ""}\n`
        : n.endsWith(".manifest.json")
          ? JSON.stringify({ manifest_version: 1, created_at: "2026-01-03T09:00:00Z", command: "pnpm make song.wav lyrics.txt", variation: { order: "story", seed: 1, style: "Simple", cinematic_bars: false }, props: {} })
          : "x";
      writeFileSync(path.join(dir, n), content);
    }
  };

  it("per platform: videos of its latest run and a status (PASS, WARN, FAILED, Rendering, none)", () => {
    const id = ws.db.select().from(project).get()!.id;
    expect(listSongs(ws)[0].platforms.every((p) => p.status === "none" && p.videos === 0)).toBe(true);
    const exportsDir = path.join(ws.dir, "projects", id, "exports");
    touch(path.join(exportsDir, "2026-01-02_1030", "reels"), ["v1.mp4", "v1.manifest.json", "v1.qa.txt"]);
    touch(path.join(exportsDir, "2026-01-03_0900", "reels"), ["v1.mp4", "v1.manifest.json", "v1.qa.txt", "v2.mp4", "v2.manifest.json"]);
    touch(path.join(exportsDir, "2026-01-03_0900", "reels"), ["v2.qa.txt"], "WARN");
    touch(path.join(exportsDir, "2026-01-03_0900"), ["v1.mp4", "v1.manifest.json", "v1.qa.txt", "v2.mp4"]); // standard: v2 never finished
    touch(path.join(exportsDir, "2026-01-03_0900", "youtube"), ["v1.mp4", "v1.manifest.json", "v1.qa.txt"]);
    const v = ws.db.insert(variation).values({ project_id: id, seed: 1, cut_rate: "1x", text_size: 64, colour: "#fff", cinematic_bars: false, overrides_json: { platform: "tiktok" } }).returning().get();
    ws.db.insert(renderJob).values({ variation_id: v.id, status: "rendering", pid: process.pid }).run(); // this process: alive

    const card = listSongs(ws)[0];
    const by = Object.fromEntries(card.platforms.map((p) => [p.name, p]));
    expect(card.platforms.map((p) => p.label)).toEqual(["Standard", "Reels", "TikTok", "Shorts", "YouTube", "Canvas"]);
    expect(by.reels).toMatchObject({ videos: 2, status: "WARN", runs: 2, details: ["v2: Clips repeated within 3 shots"] });
    expect(by.standard).toMatchObject({ videos: 1, status: "FAILED", details: ["v2 not finished"] });
    expect(by.youtube).toMatchObject({ videos: 1, status: "PASS" });
    expect(by.tiktok).toMatchObject({ videos: 0, status: "Rendering" });
    expect(by.canvas).toMatchObject({ videos: 0, status: "none" });
    expect(card.lastRun).toBe(new Date(2026, 0, 3, 9, 0).toISOString());
    expect(card).toMatchObject({ artist: "Pômé", ep: "In The Mood for Life", hasLyrics: true });
    expect(card.cover).toMatch(/audio\/cover\.jpg$/);
  });
});

describe("artists' brands, app icons, localhost", () => {
  it("brand\\<artist>\\brand.json when the artist has one, else the default brand (Life Lyrics)", () => {
    const catalog = loadFontCatalog(ws.dir);
    const own = path.join(ws.dir, "brand", "Pômé");
    mkdirSync(own, { recursive: true });
    writeFileSync(path.join(own, "brand.json"), JSON.stringify({ accentColour: "#88AACC" }));
    expect(brandDirFor(ws.dir, "Pômé")).toBe(own);
    expect(loadBrand(ws.dir, catalog, "Pômé").brand.accentColour).toBe("#88AACC");
    expect(brandDirFor(ws.dir, "Life Lyrics")).toBe(path.join(ws.dir, "brand"));
    expect(brandDirFor(ws.dir, "Nobody Yet")).toBe(path.join(ws.dir, "brand"));
    expect(loadBrand(ws.dir, catalog, "Nobody Yet").brand.accentColour).toBe("#E8A3B5");
  });

  it("app icons from the brand logo, remade when the logo changes", async () => {
    const plain = await appIcon(ws.dir, 192, "any"); // no logo yet: the default icon
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0xE8A3B5:s=300x300", "-frames:v", "1", path.join(ws.dir, "brand", "logo.png")]);
    const withLogo = await appIcon(ws.dir, 192, "any");
    expect(withLogo).not.toBe(plain);
    const probe = (f: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).toString().trim();
    expect(probe(withLogo)).toBe("192,192");
    expect(probe(await appIcon(ws.dir, 512, "maskable"))).toBe("512,512");
    expect(probe(await appIcon(ws.dir, 256, "ico"))).toBe("256,256");
  });

  it("the studio listens on this PC only unless STUDIO_HOST is set", () => {
    expect(studioHost({})).toBe("127.0.0.1");
    expect(studioHost({ STUDIO_HOST: " " })).toBe("127.0.0.1");
    expect(studioHost({ STUDIO_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });
});
