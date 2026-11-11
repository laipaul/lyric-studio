// The links of a song in song.json (Prepare → Song Details → Links): every change is applied to the list as
// it is in the file, so adding a link never replaces another, and the song.json before a change is kept.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateSongProject } from "../src/node";
import { songPathsById } from "../src/node/song-folder";
import { changeSongLinks, setPostLinks, songLinks } from "../src/node/song-links";
import { makeSong } from "./media-helpers";

const SPOTIFY = "https://open.spotify.com/track/abc";
const APPLE = "https://music.apple.com/album/xyz";

describe("song links on the server", () => {
  let root: string;
  let ws: Workspace;
  let id: string;
  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "song-links-"));
    ws = openWorkspace(path.join(root, "workspace"));
    mkdirSync(path.join(root, "in"), { recursive: true });
    const song = path.join(root, "in", "Here With Me.wav");
    makeSong(song, 2);
    id = (await findOrCreateSongProject(ws, song)).project.id;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const services = () => songLinks(ws, id).links.map((l) => l.service).join(",");

  it("adding Spotify and then Apple Music keeps both (the service comes from the address)", () => {
    changeSongLinks(ws, id, { op: "add", url: SPOTIFY });
    changeSongLinks(ws, id, { op: "add", url: "music.apple.com/album/xyz" });
    expect(services()).toBe("spotify,appleMusic");
    expect(() => changeSongLinks(ws, id, { op: "add", url: SPOTIFY })).toThrow(/already/);
    expect(services()).toBe("spotify,appleMusic");
  });

  it("changing one row's service or address never drops another", () => {
    changeSongLinks(ws, id, { op: "update", url: APPLE, patch: { service: "itunes" } });
    expect(services()).toBe("spotify,itunes");
    changeSongLinks(ws, id, { op: "update", url: SPOTIFY, patch: { url: "https://open.spotify.com/track/new" } });
    expect(songLinks(ws, id).links.map((l) => l.url)).toEqual(["https://open.spotify.com/track/new", APPLE]);
    changeSongLinks(ws, id, { op: "update", url: "https://open.spotify.com/track/new", patch: { service: "spotify", url: SPOTIFY } });
    changeSongLinks(ws, id, { op: "update", url: APPLE, patch: { service: "appleMusic" } });
    expect(services()).toBe("spotify,appleMusic");
  });

  it("remove and restore put the link back at its old place, with its Post picks", () => {
    setPostLinks(ws, id, "reels", [APPLE]);
    const gone = changeSongLinks(ws, id, { op: "remove", url: SPOTIFY });
    expect(services()).toBe("appleMusic");
    changeSongLinks(ws, id, { op: "restore", link: { service: "spotify", url: SPOTIFY }, index: 0 });
    expect(services()).toBe("spotify,appleMusic");
    expect(gone.removedPicks).toEqual([]);
    const away = changeSongLinks(ws, id, { op: "remove", url: APPLE });
    expect(away.removedPicks).toEqual(["reels"]);
    changeSongLinks(ws, id, { op: "restore", link: { service: "appleMusic", url: APPLE }, index: 1, picks: away.removedPicks });
    expect(services()).toBe("spotify,appleMusic");
    expect(songLinks(ws, id).postLinks.reels).toEqual([APPLE]);
  });

  it("keeps the song.json from before each change in .studio/replaced", () => {
    const paths = songPathsById(ws, id);
    const dir = path.join(paths.root, ".studio", "replaced");
    expect(existsSync(dir)).toBe(true);
    const copies = readdirSync(dir).filter((f) => f.endsWith("-song.json")).sort();
    expect(copies.length).toBeGreaterThan(3);
    const first = JSON.parse(readFileSync(path.join(dir, copies[0]), "utf8")) as { links?: { service: string }[] };
    expect(first.links?.map((l) => l.service)).toEqual(["spotify"]); // the oldest copy: from before Apple Music was added
  });
});
