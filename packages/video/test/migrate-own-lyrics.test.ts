// A song whose lyrics keep the user's own file name (linked in .studio\files.json) is not "missing
// lyrics.txt": the Library's "songs need tidying" must not offer to write a lyrics.txt over it (1 Nov 2026).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, describe, expect, it } from "vitest";

import { createSong, planMigration, songPathsById } from "../src/node";
import { makeSong } from "./media-helpers";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-own-lyrics-"));
let ws: Workspace;
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("lyrics under their own name", () => {
  it("are not repaired into a lyrics.txt", async () => {
    ws = openWorkspace(path.join(root, "workspace"));
    const song = path.join(root, "Here With Me.wav");
    makeSong(song, 3);
    const words = path.join(root, "Here with Me- Pure-Lyrics.txt");
    writeFileSync(words, "Verse one\n");
    const { id } = await createSong(ws, { song, lyrics: words, lyricsName: "Here with Me- Pure-Lyrics.txt", title: "Here With Me" });
    const paths = songPathsById(ws, id);
    expect(path.basename(paths.lyricsTxt)).toBe("Here with Me- Pure-Lyrics.txt");
    // a video made with older lyrics, whose stored copy exists
    const run = path.join(paths.exports, "2026-11-01_2011", "reels");
    mkdirSync(run, { recursive: true });
    writeFileSync(path.join(run, "v1.manifest.json"), JSON.stringify({ created_at: "2026-11-01T19:11:00Z", lyrics: { txt_sha256: "abcdef1234567890" } }));
    mkdirSync(paths.store, { recursive: true });
    writeFileSync(path.join(paths.store, "lyrics-abcdef123456.txt"), "Old words\n");
    expect(planMigration(ws).repairs.filter((r) => r.kind === "lyrics")).toEqual([]);
  });
});
