// The song's clip order (2 Nov 2026): one sequence for Assets (drag and drop), Shape and Make, saved in
// clips.json "order". Assets moves only the song's own clips; collection clips keep their places.
import { describe, expect, it } from "vitest";

import { inClipOrder, withSongOrder, type ClipEdits } from "../src/node/clip-edits";

const edits = (order: string[]): ClipEdits => ({ order, clips: {} });

describe("the song's clip order", () => {
  it("listed clips first, as listed; the others by file name (numbers counted as numbers)", () => {
    expect(inClipOrder(edits([]), ["10_c.mp4", "2_b.mp4", "1_a.mp4"])).toEqual(["1_a.mp4", "2_b.mp4", "10_c.mp4"]);
    expect(inClipOrder(edits(["Sunset.MP4", "1_a.mp4"]), ["1_a.mp4", "2_b.mp4", "sunset.mp4"])).toEqual(["sunset.mp4", "1_a.mp4", "2_b.mp4"]);
  });

  it("a new song order takes the song clips' places; collection clips stay where they are", () => {
    const before = edits(["a.mp4", "lifelyrics_1.mp4", "b.mp4", "lifelyrics_2.mp4", "c.mp4"]);
    const next = withSongOrder(before, ["a.mp4", "b.mp4", "c.mp4"], ["c.mp4", "a.mp4", "b.mp4"]);
    expect(next.order).toEqual(["c.mp4", "lifelyrics_1.mp4", "a.mp4", "lifelyrics_2.mp4", "b.mp4"]);
  });

  it("song clips not yet in the order go at the end; a clip is never dropped", () => {
    const next = withSongOrder(edits(["lifelyrics_1.mp4", "a.mp4"]), ["a.mp4", "new.mp4", "z.mp4"], ["new.mp4", "a.mp4"]);
    expect(next.order).toEqual(["lifelyrics_1.mp4", "new.mp4", "a.mp4", "z.mp4"]);
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isOmitted, readClipEdits, setClipOmit, writeClipEdits } from "../src/node/clip-edits";

describe("Use / Omit on a clip (clips.json)", () => {
  it("omit is saved per clip, keeps the clip's other edits and its place in the order; Use takes it away", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-omit-"));
    try {
      writeClipEdits(dir, { order: ["b.mp4", "a.mp4"], clips: { "A.mp4": { in: 1 } } });
      setClipOmit(dir, "a.mp4", true);
      let e = readClipEdits(dir);
      expect(e.order).toEqual(["b.mp4", "a.mp4"]);
      expect(e.clips["A.mp4"]).toEqual({ in: 1, omit: true });
      expect(isOmitted(e, "a.mp4")).toBe(true);
      expect(isOmitted(e, "b.mp4")).toBe(false);
      setClipOmit(dir, "a.mp4", false);
      e = readClipEdits(dir);
      expect(e.clips["A.mp4"]).toEqual({ in: 1 });
      setClipOmit(dir, "b.mp4", true);
      setClipOmit(dir, "b.mp4", false);
      expect(JSON.parse(readFileSync(path.join(dir, "clips.json"), "utf8")).clips).toEqual({ "A.mp4": { in: 1 } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a wrong omit value is named", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-omit-"));
    try {
      expect(() => writeClipEdits(dir, { order: [], clips: { "a.mp4": { omit: "yes" } } })).toThrow(/omit must be true/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Shape reorders only the clips it shows", () => {
  it("a clip this platform cannot use keeps its place in the song's order", () => {
    const next = withSongOrder(edits(["a.mp4", "wide.mp4", "b.mp4"]), ["b.mp4", "a.mp4"], ["b.mp4", "a.mp4"]);
    expect(next.order).toEqual(["b.mp4", "wide.mp4", "a.mp4"]);
  });
});
