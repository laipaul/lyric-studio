// The Lyrics tab (Step 5c.2): lines with stamp, start now, what the viewer sees, flags; nudges saved as
// hand-set lines in hints.lrc (the stored alignment kept); lyrics.txt edits with undo; label lines.
// First real case: A Heart For Two ~1:10, the hook "You had a heart for two" stamped 1.5 s early.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, ffmpegBin, openWorkspace, project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSong, ensureAlignment, labelLines, lyricsView, restoreLyrics, saveHandTimes, saveLyricsText, setCheckedByEar, songPathsById, type AlignRunner } from "../src/node";

const LRC = [
  "[01:05.00]<01:05.00>The verse <01:06.00>line <01:08.40>",
  "[01:08.50]<01:08.50>You <01:10.40>had <01:10.70>a <01:10.90>heart <01:11.20>for <01:11.50>two <01:12.50>",
  "[01:13.00]<01:13.00>Next <01:13.60>verse <01:14.40>",
  "[01:30.00]<01:30.00>After <01:30.60>the solo <01:31.40>",
  "[01:40.00]",
].join("\n");
const LYRICS = "The verse line\n* You had a heart for two\nNext verse\nAfter the solo\n";

describe("label, title and credit lines in lyrics.txt", () => {
  it("are flagged; sung lines (also the title when it is sung) are not", () => {
    const text = "A Heart For Two\n\n[Chorus]\nVerse 1:\nYou had a heart for two\n(x2)\nWritten by Pômé\n© 2026 Life Lyrics\nChorus\nA chorus of birds\n";
    expect(labelLines(text, "A Heart For Two", "Life Lyrics")).toEqual([
      { line: 1, text: "A Heart For Two", why: "the song title at the top" },
      { line: 3, text: "[Chorus]", why: "a label in brackets (e.g. [Chorus])" },
      { line: 4, text: "Verse 1:", why: "a section label (verse, chorus, bridge, ...)" },
      { line: 6, text: "(x2)", why: "a label in brackets (e.g. [Chorus])" },
      { line: 7, text: "Written by Pômé", why: "a credit line" },
      { line: 8, text: "© 2026 Life Lyrics", why: "a credit line" },
      { line: 9, text: "Chorus", why: "a section label (verse, chorus, bridge, ...)" },
    ]);
    // The title as the first sung line that comes back later (a hook): sung, not flagged.
    expect(labelLines("A heart for two\nSomething\n* A heart for two\n", "A Heart For Two", "Life Lyrics")).toEqual([]);
  });
});

describe("the Lyrics tab", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-lyrics-tab-"));
  let ws: Workspace;
  let id: string;
  let aligned = 0;
  const aligner: AlignRunner = async (a) => {
    aligned++;
    writeFileSync(a.out, `${LRC}\n`);
    const lines = ["The verse line", "You had a heart for two", "Next verse", "After the solo"].map((text, i) => ({ number: i + 1, text, is_hook: i === 1, start_ms: [65_000, 68_500, 73_000, 90_000][i], end_ms: [68_400, 72_500, 74_400, 91_400][i], confidence: i === 3 ? 0.36 : 0.9 }));
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines }));
  };

  beforeAll(async () => {
    ws = openWorkspace(path.join(root, "workspace"));
    mkdirSync(path.join(root, "in"), { recursive: true });
    const song = path.join(root, "in", "A Heart For Two.wav");
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", song]);
    writeFileSync(path.join(root, "in", "lyrics.txt"), LYRICS);
    id = (await createSong(ws, { song, lyrics: path.join(root, "in", "lyrics.txt") })).id;
    const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
    const paths = songPathsById(ws, id);
    const sp = { project: p, songFile: absPath(ws, p.audio_path!), songHash: p.audio_hash!, created: false };
    const stored = await ensureAlignment(ws, sp, { lyricsTxt: paths.lyricsTxt, durationMs: 100_000, align: aligner });
    // What the last pnpm make's vocal-start check recorded: the hook flagged.
    writeFileSync(
      path.join(path.dirname(stored.lrcFile), `guard-${stored.lrcHash.slice(0, 12)}.json`),
      JSON.stringify({ moves: [], check: { level_db: -14, threshold_db: -29, words_check: "ran", lines: [{ number: 2, text: "You had a heart for two", stamp_ms: 68_500, voice_ms: null, words_ms: 70_050, words_text: "You had a", duration_ms: 68_500, first_word_ms: 1_900, loudest_before_db: null, stamp_level_db: -40, target_ms: 68_500, agree: [], why: "only words 1:10.1 (+1.6 s); no second signal agrees", result: "flagged for review" }] } }),
    );
  });
  afterAll(() => {
    ws?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("lists every line: stamp, start now, confidence, the check's verdict and what the viewer sees", async () => {
    const v = await lyricsView(ws, id);
    expect(v.lines!.map((l) => [l.number, l.alignedMs, l.startMs, l.source, l.isHook, l.lowConfidence])).toEqual([
      [1, 65_000, 65_000, "alignment", false, false],
      [2, 68_500, 68_500, "alignment", true, false],
      [3, 73_000, 73_000, "alignment", false, false],
      [4, 90_000, 90_000, "alignment", false, true], // 0.36 confidence
    ]);
    const hook = v.lines![1];
    expect(hook.flagged).toBe("only words 1:10.1 (+1.6 s); no second signal agrees");
    expect(hook.screen).toEqual({ fadeInMs: null, readableMs: 68_267, leaveMs: 72_767 }); // readable 0.25 s before its stamp (to the frame)
    // After the solo (a long gap): nothing on screen, then a 1 s fade-in before the first word.
    expect(v.lines![3].screen.fadeInMs).toBe(89_000);
    expect(v.checkRan).toBe(true);
    expect(v.song).toMatch(/^songs\/Life Lyrics\/A Heart For Two\/song\.wav$/);
  });

  it("a nudge is saved as a hand-set line in hints.lrc; the stored alignment is kept; reset takes it back", async () => {
    const paths = songPathsById(ws, id);
    expect(await saveHandTimes(ws, id, [{ number: 2, ms: 70_000 }])).toBe(1);
    expect(readFileSync(paths.hints!, "utf8")).toBe("[01:10.00]! #2 You had a heart for two\n");
    const v = await lyricsView(ws, id);
    const hook = v.lines![1];
    expect([hook.startMs, hook.source, hook.flagged, hook.screen.readableMs]).toEqual([70_000, "hand", null, 69_767]);
    expect(aligned).toBe(1); // never aligned again
    expect(await saveHandTimes(ws, id, [{ number: 2, ms: null }])).toBe(0);
    expect((await lyricsView(ws, id)).lines![1].source).toBe("alignment");
    expect(readdirSync(path.join(paths.root, ".studio", "replaced")).some((f) => f.endsWith("-hints.lrc"))).toBe(true); // the old hints.lrc kept
    await expect(saveHandTimes(ws, id, [{ number: 9, ms: 1_000 }])).rejects.toThrow(/no line 9/);
  });

  it('"checked by ear" on the low-confidence line holds until its time changes', async () => {
    await setCheckedByEar(ws, id, 4, true, new Date("2026-10-27T10:00:00Z"));
    let line = (await lyricsView(ws, id)).lines![3];
    expect([line.checkedByEar, line.checkLapsed]).toEqual(["2026-10-27T10:00:00.000Z", false]);
    // Nudged: the time changed, so the mark lapses ("check it again").
    await saveHandTimes(ws, id, [{ number: 4, ms: 90_500 }]);
    line = (await lyricsView(ws, id)).lines![3];
    expect([line.checkedByEar, line.checkLapsed]).toEqual([null, true]);
    // Back at the time it was checked at: it holds again. Taken off: gone.
    await saveHandTimes(ws, id, [{ number: 4, ms: null }]);
    expect((await lyricsView(ws, id)).lines![3].checkedByEar).toBe("2026-10-27T10:00:00.000Z");
    await setCheckedByEar(ws, id, 4, false);
    line = (await lyricsView(ws, id)).lines![3];
    expect([line.checkedByEar, line.checkLapsed]).toEqual([null, false]);
    await expect(setCheckedByEar(ws, id, 9, true)).rejects.toThrow(/no line 9/);
  });

  it("editing the text: hook markers only do not re-align, words do; the old lyrics.txt can be restored", async () => {
    const paths = songPathsById(ws, id);
    expect(saveLyricsText(ws, id, LYRICS)).toEqual({ changed: false, realign: false });
    expect(saveLyricsText(ws, id, LYRICS.replace("* You", "You"))).toEqual({ changed: true, realign: false });
    expect(saveLyricsText(ws, id, `${LYRICS}One more line\n`)).toEqual({ changed: true, realign: true });
    const v = await lyricsView(ws, id);
    expect(v.lines).toBeNull(); // the words changed: no stored alignment for them until the next make
    expect(v.why).toMatch(/make a video first/);
    const earlier = v.replaced.find((r) => r.lines === 4)!;
    expect(restoreLyrics(ws, id, earlier.file)).toEqual({ changed: true, realign: true });
    expect((await lyricsView(ws, id)).lines).not.toBeNull(); // back to words that were aligned
    expect(existsSync(paths.lyricsTxt)).toBe(true);
    expect(() => restoreLyrics(ws, id, "../../studio.db")).toThrow(/Not an earlier lyrics.txt/);
  });
});
