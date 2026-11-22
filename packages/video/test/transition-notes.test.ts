// Storyboard clip cards: the notes on what the app changed so a dissolve never freezes a frame (node/transition-notes.ts).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { STORYBOARD_SCHEMA } from "../src/storyboard-file";
import { transitionNotes, videoLabel } from "../src/node/transition-notes";

describe("transitionNotes", () => {
  it("reads the videos' own shot plans (not .previous or Try other looks) and labels each note", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tn-"));
    mkdirSync(path.join(root, "storyboards"));
    const plan = (note: string) => ({
      schemaVersion: STORYBOARD_SCHEMA,
      shots: [
        { clip: "Mirror.mp4", startMs: 53_100, render: { fitNotes: [note] } },
        { clip: "Other.mp4", startMs: 57_400, render: {} },
      ],
    });
    writeFileSync(path.join(root, "storyboards", "reels-1.json"), JSON.stringify(plan("slowed to 90% to fit the dissolve")));
    writeFileSync(path.join(root, "storyboards", "reels-1.previous.json"), JSON.stringify(plan("old")));
    writeFileSync(path.join(root, "storyboards", "reels-1~theme-x.json"), JSON.stringify(plan("try")));
    const notes = transitionNotes(root);
    expect(notes.get("mirror.mp4")).toEqual(["Reel, 0:53: slowed to 90% to fit the dissolve"]);
    expect(notes.has("other.mp4")).toBe(false);
    expect(videoLabel("tiktok-2")).toBe("TikTok 2");
    expect(transitionNotes(path.join(root, "none")).size).toBe(0);
  });
});
