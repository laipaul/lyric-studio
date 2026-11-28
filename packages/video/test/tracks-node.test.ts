// The two-layer timeline, Part A (28 Nov 2026): tracks.json in the song folder and what Make reads through it.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { fingerprint } from "../src/tracks";
import { differences, tracksCheckReport } from "../src/node/tracks-check";
import { readTracksFile, songEdit, songEditFromTracks, songTracks, TRACKS_FILE } from "../src/node/tracks";
import { readClipEdits } from "../src/node/clip-edits";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-tracks-"));
const recipe = path.join(root, "song.json");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const anchors = [
  { line: 3, clip: "hands.mp4", transition: "dissolve" },
  { line: 6, clip: "bride sings lines 6-7.mp4", sync: 41.25, through: 7, hide: [{ from: 2, to: 3.5, clip: "rings.mp4" }] },
];
writeFileSync(recipe, JSON.stringify({ anchors }));
writeFileSync(path.join(root, "clips.json"), JSON.stringify({ order: ["01_hands.mp4", "bride sings lines 6-7.mp4"], clips: {} }));

describe("tracks.json", () => {
  it("is made from the song's edit the first time; Make reads exactly that edit back", () => {
    const edits = readClipEdits(root);
    const r = songEditFromTracks(recipe, root, edits);
    expect(r.anchors).toEqual(anchors);
    expect(r.edits).toEqual(edits);
    expect("inserts" in r.edits).toBe(false); // absent in clips.json: stays absent (nothing Make compares changes)
    const saved = readTracksFile(root)!;
    expect(saved.singer).toEqual([{ line: 6, through: 7, clip: "bride sings lines 6-7.mp4", sync: 41.25 }]);
    expect(saved.broll.cutaways).toHaveLength(1);
    expect(saved.from).toBe(fingerprint(songEdit(recipe, root)));
    expect(JSON.parse(readFileSync(path.join(root, TRACKS_FILE), "utf8"))._help).toMatch(/V1: singing clips locked to song time/);
  });
  it("is kept while the edit stays the same, and made again when song.json or clips.json change", () => {
    expect(songTracks(recipe, root).made).toBe(false);
    writeFileSync(recipe, JSON.stringify({ anchors: anchors.map((a) => (a.line === 6 ? { ...a, sync: 41.35 } : a)) })); // a nudge
    const r = songTracks(recipe, root);
    expect(r.made).toBe(true);
    expect(r.tracks.singer[0].sync).toBe(41.35);
    expect(readTracksFile(root)!.singer[0].sync).toBe(41.35);
  });
  it("a video's own B-roll (Part B) survives the tracks being made again", () => {
    const t = readTracksFile(root)!;
    writeFileSync(path.join(root, TRACKS_FILE), JSON.stringify({ ...t, videos: { "reels-1": { broll: { inserts: [{ from: 1, to: 2, clip: "x.mp4" }] } } } }));
    writeFileSync(path.join(root, "clips.json"), JSON.stringify({ order: ["01_hands.mp4"], clips: {}, inserts: [{ from: 48.3, to: 50.2, clip: "06_rings.mp4" }] }));
    const r = songEditFromTracks(recipe, root, readClipEdits(root));
    expect(r.edits.inserts).toEqual([{ from: 48.3, to: 50.2, clip: "06_rings.mp4" }]);
    expect(readTracksFile(root)!.videos?.["reels-1"]).toBeDefined();
  });
  it("write: false (pnpm tracks:check) writes nothing", () => {
    const other = mkdtempSync(path.join(os.tmpdir(), "lyric-tracks-ro-"));
    writeFileSync(path.join(other, "song.json"), JSON.stringify({ anchors }));
    songEditFromTracks(path.join(other, "song.json"), other, readClipEdits(other), { write: false });
    expect(existsSync(path.join(other, TRACKS_FILE))).toBe(false);
    rmSync(other, { recursive: true, force: true });
  });
  it("an unreadable or older tracks.json is made again from the edit", () => {
    writeFileSync(path.join(root, TRACKS_FILE), "{ not json");
    expect(songTracks(recipe, root).made).toBe(true);
    expect(readTracksFile(root)).not.toBeNull();
  });
});

describe("pnpm tracks:check", () => {
  it("names the first differences by where they are", () => {
    expect(differences({ props: { shots: [{ start: 410 }] } }, { props: { shots: [{ start: 412 }] } })).toEqual(["props.shots[0].start: 410 → 412"]);
    expect(differences({ a: 1 }, { a: 1 })).toEqual([]);
    expect(differences({ a: 1 }, { a: 1, b: 2 })).toEqual(["b: (none) → 2"]);
  });
  it("says identical only when every video is, in plain words", () => {
    const ok = tracksCheckReport([{ id: "1", title: "Wedding Day", skipped: null, failed: null, tracks: { singer: 3, story: 20, pinned: 2, inserts: 1, cutaways: 0 }, videos: [{ platform: "Reels", video: "v1", identical: true, differences: [] }] }]);
    expect(ok.ok).toBe(true);
    expect(ok.text).toMatch(/✓ Wedding Day: 1 of 1 video\(s\) identical \(V1 Singer: 3 segment/);
    expect(ok.text).toMatch(/identical: all 1 video\(s\) of 1 song\(s\)/);
    const bad = tracksCheckReport([{ id: "1", title: "X", skipped: null, failed: null, tracks: null, videos: [{ platform: "Reels", video: "v1", identical: false, differences: ["props.shots[0].start: 410 → 412"] }] }]);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/✗ Reels v1:\n\s+props.shots\[0\].start: 410 → 412/);
    expect(bad.text).toMatch(/NOT identical: 1 of 1 video\(s\) differ.*Nothing was changed/);
  });
});
