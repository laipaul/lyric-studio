// The two-layer timeline, Part A (28 Nov 2026): the song's edit as tracks (V1 Singer, V2 B-roll) and back, exactly.
import { describe, expect, it } from "vitest";

import type { AnchorSpec } from "../src/anchors";
import { fingerprint, fromEdit, toEdit, type Edit } from "../src/tracks";

const anchors: AnchorSpec[] = [
  { line: 3, clip: "hands.mp4", transition: "dissolve" },
  { line: 6, clip: "bride sings lines 6-7.mp4", sync: 41.25, through: 7, hide: [{ from: 2, to: 3.5, clip: "rings.mp4", clipIn: 1 }] },
  { line: 9, clip: "sea.mp4", clipIn: 1.5 },
  { line: 12, clip: "Music video 1.01-1.14 shot 3.mp4", sync: 61.9 },
];
const edit: Edit = { anchors, order: ["01_hands.mp4", "collection:Flowers", "bride sings lines 6-7.mp4"], inserts: [{ from: 48.3, to: 50.2, clip: "06_rings.mp4" }] };

describe("the song's edit as tracks", () => {
  it("singing clips (with a song time) are V1; story anchors, the story line, B-roll and cut-aways are V2", () => {
    const t = fromEdit(edit);
    expect(t.singer).toEqual([
      { line: 6, through: 7, clip: "bride sings lines 6-7.mp4", sync: 41.25 },
      { line: 12, clip: "Music video 1.01-1.14 shot 3.mp4", sync: 61.9 },
    ]);
    expect(t.broll.pinned).toEqual([{ line: 3, clip: "hands.mp4", transition: "dissolve" }, { line: 9, clip: "sea.mp4", clipIn: 1.5 }]);
    expect(t.broll.cutaways).toEqual([{ over: { line: 6, clip: "bride sings lines 6-7.mp4" }, from: 2, to: 3.5, clip: "rings.mp4", clipIn: 1 }]);
    expect(t.broll.story).toEqual(edit.order);
    expect(t.broll.inserts).toEqual(edit.inserts);
  });
  it("back to the edit Make reads: exactly the same (the anchors in their own order)", () => {
    expect(toEdit(fromEdit(edit))).toEqual(edit);
    const empty: Edit = { anchors: [], order: [], inserts: [] };
    expect(toEdit(fromEdit(empty))).toEqual(empty);
  });
  it("without the saved interleaving: singing segments first, then the pinned clips", () => {
    const t = { ...fromEdit(edit), anchorOrder: undefined };
    expect(toEdit(t).anchors.map((a) => a.line)).toEqual([6, 12, 3, 9]);
  });
  it("the tracks never share objects with the edit they came from", () => {
    const t = fromEdit(edit);
    t.broll.story.push("x.mp4");
    t.broll.inserts[0].to = 99;
    expect(edit.order).toHaveLength(3);
    expect(edit.inserts[0].to).toBe(50.2);
  });
  it("the fingerprint: the same edit (any key order) gives the same one; any change gives another", () => {
    const same: Edit = { inserts: edit.inserts, order: edit.order, anchors: anchors.map((a) => Object.fromEntries(Object.entries(a).reverse()) as AnchorSpec) };
    expect(fingerprint(same)).toBe(fingerprint(edit));
    expect(fromEdit(edit).from).toBe(fingerprint(edit));
    const nudged = { ...edit, anchors: anchors.map((a) => (a.line === 6 ? { ...a, sync: 41.35 } : a)) };
    expect(fingerprint(nudged)).not.toBe(fingerprint(edit));
    expect(fingerprint({ ...edit, order: [...edit.order].reverse() })).not.toBe(fingerprint(edit));
  });
});
