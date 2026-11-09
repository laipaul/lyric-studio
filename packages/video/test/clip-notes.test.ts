// Story notes on clip cards (Prepare → Clips): saved per clip, keyed by the clip's content so they survive reordering,
// renaming, Omit / Use and every regeneration; clearing deletes; and the app never reads them for anything else.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { CLIP_NOTE_MAX, notesForClips, readClipNotes, setClipNote } from "../src/node/clip-notes";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-clip-notes-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

describe("clip story notes", () => {
  it("saves, reads and deletes a note by the clip's content", () => {
    setClipNote(root, { hash: A, clip: "01_beach.mp4", text: "Opening: she waits by the sea" });
    expect(readClipNotes(root)[A]).toMatchObject({ text: "Opening: she waits by the sea", clip: "01_beach.mp4" });
    expect(JSON.parse(readFileSync(path.join(root, ".studio", "clip-notes.json"), "utf8")).about).toMatch(/for you only/);
    setClipNote(root, { hash: A, clip: "01_beach.mp4", text: "   " });
    expect(readClipNotes(root)[A]).toBeUndefined();
  });

  it("follows a renamed or reordered clip (same content), and a clip replaced under the same name", () => {
    setClipNote(root, { hash: A, clip: "01_beach.mp4", text: "The meeting" });
    // Renamed (and now second in the order): found by its content.
    expect(notesForClips(readClipNotes(root), [{ name: "02_first.mp4", hash: B }, { name: "beach renamed.mp4", hash: A }]).get("beach renamed.mp4")).toBe("The meeting");
    // Replaced: another file under the old name, the old content gone -> found by the name.
    const replaced = notesForClips(readClipNotes(root), [{ name: "01_beach.mp4", hash: C }]);
    expect(replaced.get("01_beach.mp4")).toBe("The meeting");
    // ...but not while the old content is still one of the song's clips (it was renamed, the name reused).
    expect(notesForClips(readClipNotes(root), [{ name: "beach renamed.mp4", hash: A }, { name: "01_beach.mp4", hash: C }]).get("01_beach.mp4")).toBeUndefined();
    // Writing the replaced clip's note moves it to the new content.
    setClipNote(root, { hash: C, clip: "01_beach.mp4", text: "The meeting, take 2" });
    expect(Object.keys(readClipNotes(root))).toEqual([C]);
  });

  it("keeps line breaks, cuts very long notes, refuses a clip without a fingerprint", () => {
    setClipNote(root, { hash: B, clip: "02.mp4", text: `line one\r\nline two${"x".repeat(CLIP_NOTE_MAX)}` });
    const n = readClipNotes(root)[B];
    expect(n.text.startsWith("line one\nline two")).toBe(true);
    expect(n.text.length).toBe(CLIP_NOTE_MAX);
    expect(() => setClipNote(root, { hash: "", clip: "x.mp4", text: "hi" })).toThrow(/fingerprint/);
  });

  it("a broken notes file never breaks the clips list", () => {
    const broken = mkdtempSync(path.join(os.tmpdir(), "lyric-clip-notes-broken-"));
    mkdirSync(path.join(broken, ".studio"));
    writeFileSync(path.join(broken, ".studio", "clip-notes.json"), "{ not json");
    expect(readClipNotes(broken)).toEqual({});
    rmSync(broken, { recursive: true, force: true });
  });

  it("is never read by the app for anything but the clips list: only assets.ts uses it", () => {
    const src = path.join(__dirname, "..", "src");
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f.name) && /clip-notes|readClipNotes|notesForClips|CLIP_NOTES_FILE/.test(readFileSync(p, "utf8"))) users.push(path.relative(src, p).split(path.sep).join("/"));
      }
    };
    walk(src);
    expect(users.sort()).toEqual(["node/assets.ts", "node/clip-notes.ts", "node/index.ts"]);
    expect(existsSync(path.join(src, "node", "clip-notes.ts"))).toBe(true);
  });
});
