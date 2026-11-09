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

import { anchorsText, createSong, ensureAlignment, keepReplaced, labelLines, lyricsView, readRecipe, restoreLyrics, saveAnchors, saveHandTimes, saveLyricsText, fixLyricLine, setCheckedByEar, songPathsById, type AlignRunner } from "../src/node";

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

describe("replaced files are kept", () => {
  it("two replacements in the same second keep both (the newest sorts last)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-replaced-"));
    const file = path.join(dir, "lyrics.txt");
    const kept = ["first", "second", "third"].map((text) => {
      writeFileSync(file, text);
      return keepReplaced(dir, file);
    });
    expect(new Set(kept).size).toBe(3);
    expect(kept.map((k) => readFileSync(k, "utf8"))).toEqual(["first", "second", "third"]);
    const names = readdirSync(path.join(dir, ".studio", "replaced")).sort();
    expect(names.map((n) => readFileSync(path.join(dir, ".studio", "replaced", n), "utf8"))).toEqual(["first", "second", "third"]);
    rmSync(dir, { recursive: true, force: true });
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
    expect(hook.flagReason).toBe("The singing may start about 1.5 s later than shown. Listen with ▶.");
    expect(hook.likelyStartMs).toBeNull(); // only one signal disagrees
    expect(hook.screen).toEqual({ fadeInMs: null, readableMs: 68_267, leaveMs: 72_767 }); // readable 0.25 s before its stamp (to the frame)
    // After the solo (a long gap): nothing on screen, then a 1 s fade-in before the first word.
    expect(v.lines![3].screen.fadeInMs).toBe(89_000);
    expect(v.checkRan).toBe(true);
    expect(v.song).toMatch(/^songs\/Life Lyrics\/A Heart For Two\/A Heart For Two\.wav$/); // its own name
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

  it("story anchors: picked per line, saved in song.json (other settings kept), with the clips to choose from and the conflicts", async () => {
    const paths = songPathsById(ws, id);
    // Two clips of the song's own: 1 s and 6 s.
    mkdirSync(paths.clips!, { recursive: true });
    for (const [name, seconds] of [["01_hands.mp4", 1], ["02_rings.mp4", 6]] as const) {
      execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=216x384:r=30:d=${seconds}`, "-pix_fmt", "yuv420p", path.join(paths.clips!, name)]);
    }
    const before = readRecipe(paths.recipe);
    expect(saveAnchors(ws, id, [{ line: 3, clip: "02_rings.mp4", transition: "dissolve" }, { line: 2, clip: "01_hands.mp4" }], "story")).toEqual([
      { line: 2, clip: "01_hands.mp4" },
      { line: 3, clip: "02_rings.mp4", transition: "dissolve" },
    ]);
    const recipe = readRecipe(paths.recipe);
    expect([recipe.anchors?.length, recipe.gapOrder, recipe.collections]).toEqual([2, "story", before.collections]);
    const v = await lyricsView(ws, id);
    expect(v.anchors.list.map((a) => a.line)).toEqual([2, 3]);
    expect(v.anchors.clips.map((c) => [c.name, c.from, c.kind, !!c.thumb])).toEqual([["01_hands.mp4", "song", "video", true], ["02_rings.mp4", "song", "video", true]]);
    // Line 2 (the hook, 4.5 s on screen) on a 1 s clip: slowed, named; lines 2 and 3 fit their own bars.
    expect(v.anchors.problems).toEqual([{ line: 2, problem: "01_hands.mp4 has 1.0 s, line 2 lasts 4.2 s: it will be slowed to 0.50x and its last frame held" }]);
    expect(() => saveAnchors(ws, id, [{ line: 2 }])).toThrow(/clip must be a clip file name/);
    expect(saveAnchors(ws, id, [], null)).toEqual([]);
    expect(readRecipe(paths.recipe).anchors).toBeUndefined();
  });

  it("the Videos tab's text for the anchors a video used", () => {
    expect(anchorsText([
      { line: 9, text: "x", clip: "hands.mp4", used: true, shot: 3, at_ms: 41_000, transition: "dissolve", why: null },
      { line: 12, text: "y", clip: "rings.mp4", used: true, shot: 6, at_ms: 52_400, transition: "cut", why: null, playback_rate: 0.62 },
      { line: 31, text: "z", clip: "sea.mp4", used: false, shot: null, at_ms: null, transition: "cut", why: "outside this section" },
    ])).toBe("line 9 → hands.mp4 (0:41.0, dissolve), line 12 → rings.mp4 (0:52.4, slowed 0.62x); not in this video: line 31 (sea.mp4)");
  });

  it("editing the text: hook markers only do not re-align, words do; the old lyrics.txt can be restored", async () => {
    const paths = songPathsById(ws, id);
    expect(saveLyricsText(ws, id, LYRICS)).toEqual({ changed: false, realign: false });
    expect(saveLyricsText(ws, id, LYRICS.replace("* You", "You"))).toEqual({ changed: true, realign: false });
    expect(saveLyricsText(ws, id, `${LYRICS}One more line\n`)).toEqual({ changed: true, realign: true });
    const v = await lyricsView(ws, id);
    expect(v.lines).toBeNull(); // the words changed: no stored alignment for them until the next make
    expect(v.why).toMatch(/Time the lyrics again \(above\) or make a video/); // N1: never re-timed silently
    const earlier = v.replaced.find((r) => r.lines === 4)!;
    expect(restoreLyrics(ws, id, earlier.file)).toEqual({ changed: true, realign: true });
    expect((await lyricsView(ws, id)).lines).not.toBeNull(); // back to words that were aligned
    expect(existsSync(paths.lyricsTxt)).toBe(true);
    expect(() => restoreLyrics(ws, id, "../../studio.db")).toThrow(/Not an earlier version of the lyrics/);
    // Saves within the same second each keep their own copy, and each can be restored.
    const all = (await lyricsView(ws, id)).replaced;
    expect(all.some((r) => /\.\d+-lyrics\.txt$/.test(r.file))).toBe(true);
    for (const r of all) expect(() => restoreLyrics(ws, id, r.file)).not.toThrow();
  });
  it("fixing one line's words where it is shown keeps its timing (no new alignment) and its hand-set start", async () => {
    const paths = songPathsById(ws, id);
    saveLyricsText(ws, id, LYRICS);
    expect((await lyricsView(ws, id)).lines).not.toBeNull();
    await saveHandTimes(ws, id, [{ number: 3, ms: 73_500 }]);
    const before = aligned;
    expect(await fixLyricLine(ws, id, 3, "Next  verses ")).toEqual({ changed: true, timingKept: true });
    expect(await fixLyricLine(ws, id, 2, "You had a heart for us two")).toEqual({ changed: true, timingKept: true });
    expect(await fixLyricLine(ws, id, 2, "You had a heart for us two")).toEqual({ changed: false, timingKept: true });
    expect(readFileSync(paths.lyricsTxt, "utf8")).toBe("The verse line\n* You had a heart for us two\nNext verses\nAfter the solo\n");
    const v = await lyricsView(ws, id);
    expect(aligned).toBe(before); // nothing aligned again
    expect(v.lines!.map((l) => l.text)).toEqual(["The verse line", "You had a heart for us two", "Next verses", "After the solo"]);
    expect(v.lines![1].alignedMs).toBe(68_500);
    expect(v.lines![1].isHook).toBe(true);
    expect(v.lines![2]).toMatchObject({ alignedMs: 73_000, startMs: 73_500, source: "hand" }); // the hand-set start followed its words
    await expect(fixLyricLine(ws, id, 9, "x")).rejects.toThrow(/no line 9/);
    await expect(fixLyricLine(ws, id, 1, "  ")).rejects.toThrow(/can't be empty/);
    await saveHandTimes(ws, id, [{ number: 3, ms: null }]);
  });
});

// Bug (8 Nov 2026, "Let My Love Carry You"): the line "Mmmm..." was removed from the lyrics. The others got their
// neighbours' timing, and a hand-set start for "Hold on..." (3:22) was dropped, as the next line's stamp was earlier.
describe("a line removed from the lyrics", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-removed-"));
  let ws: Workspace;
  let calls = 0;
  let songs = 0;
  const TEXT = "You'll find your way\nMmmm...\nHold on...\nFloating through the night\nThe end\n";
  const STARTS = [10_000, 20_000, 30_000, 40_000, 55_000];
  const CONF = [0.9, 0.74, 0.23, 0.8, 0.9];
  const lrcFor = (names: string[], at: number[]) => `${names.map((t, i) => `[${String(Math.floor(at[i] / 60_000)).padStart(2, "0")}:${((at[i] % 60_000) / 1000).toFixed(2).padStart(5, "0")}]<00:00.00>${t.split(" ").join(" <00:00.00>")} `).join("\n")}\n[01:10.00]\n`;
  async function newSong(name: string, text: string, names: string[], at: number[], conf: number[]) {
    const dir = path.join(root, "in", name);
    mkdirSync(dir, { recursive: true });
    const song = path.join(dir, `${name}.wav`);
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${330 + 40 * ++songs}:duration=2`, song]);
    writeFileSync(path.join(dir, "lyrics.txt"), text);
    const id = (await createSong(ws, { song, lyrics: path.join(dir, "lyrics.txt") })).id;
    const p = ws.db.select().from(project).where(eq(project.id, id)).get()!;
    const paths = songPathsById(ws, id);
    const sp = { project: p, songFile: absPath(ws, p.audio_path!), songHash: p.audio_hash!, created: false };
    const exact: AlignRunner = async (a) => {
      calls++;
      writeFileSync(a.out, lrcFor(names, at));
      writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: names.map((t, i) => ({ number: i + 1, text: t, is_hook: false, start_ms: at[i], end_ms: at[i] + 5_000, confidence: conf[i] })) }));
    };
    await ensureAlignment(ws, sp, { lyricsTxt: paths.lyricsTxt, durationMs: 100_000, align: exact });
    return id;
  }
  const NAMES = ["You'll find your way", "Mmmm...", "Hold on...", "Floating through the night", "The end"];

  beforeAll(() => {
    ws = openWorkspace(path.join(root, "workspace"));
  });
  afterAll(() => {
    ws?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("C: every other line keeps its OWN timing and confidence; nothing is aligned again; adding a line aligns again", async () => {
    const id = await newSong("removed", TEXT, NAMES, STARTS, CONF);
    const before = calls;
    saveLyricsText(ws, id, TEXT.replace("Mmmm...\n", ""));
    const v = await lyricsView(ws, id);
    expect(calls).toBe(before);
    expect(v.lines!.map((l) => [l.text, l.alignedMs, l.confidence])).toEqual([
      ["You'll find your way", 10_000, 0.9],
      ["Hold on...", 30_000, 0.23],
      ["Floating through the night", 40_000, 0.8],
      ["The end", 55_000, 0.9],
    ]);
    // Taking away the first and the last line as well.
    saveLyricsText(ws, id, "Hold on...\nFloating through the night\n");
    expect((await lyricsView(ws, id)).lines!.map((l) => l.alignedMs)).toEqual([30_000, 40_000]);
    // A line added is not guessed: the next make aligns again.
    saveLyricsText(ws, id, "Hold on...\nA new line\nFloating through the night\n");
    expect((await lyricsView(ws, id)).lines).toBeNull();
  });

  it("C: a removed line that could be either of two identical lines is not guessed (aligned again)", async () => {
    const id = await newSong("twice", "Hold on\nHold on\nFloating\n", ["Hold on", "Hold on", "Floating"], [10_000, 20_000, 30_000], [0.9, 0.8, 0.7]);
    saveLyricsText(ws, id, "Hold on\nFloating\n");
    expect((await lyricsView(ws, id)).lines).toBeNull();
    saveLyricsText(ws, id, "Floating\nHold on\n"); // order changed: not a removal either
    expect((await lyricsView(ws, id)).lines).toBeNull();
  });

  it("A + B: a hand-set start follows its line by text; Hold on 3:22-style (after the next stamp) is kept and the next line is pushed", async () => {
    const id = await newSong("handset", TEXT, NAMES, STARTS, CONF);
    const paths = songPathsById(ws, id);
    await saveHandTimes(ws, id, [{ number: 4, ms: 45_000 }, { number: 3, ms: 31_000 }]); // old numbering: Floating, Hold on
    saveLyricsText(ws, id, TEXT.replace("Mmmm...\n", ""));
    let v = await lyricsView(ws, id);
    // The entries followed their lines (Hold on 31 s, Floating 45 s) although the numbers shifted.
    expect(v.lines!.map((l) => [l.text, l.startMs, l.source])).toEqual([
      ["You'll find your way", 10_000, "alignment"],
      ["Hold on...", 31_000, "hand"],
      ["Floating through the night", 45_000, "hand"],
      ["The end", 55_000, "alignment"],
    ]);
    // Saving "Hold on..." (now line 2) at 43 s, after its next line's stamp (40 s); Floating back to automatic.
    expect(await saveHandTimes(ws, id, [{ number: 2, ms: 43_000 }, { number: 3, ms: null }])).toBe(1);
    expect(readFileSync(paths.hints!, "utf8")).toBe("[00:43.00]! #2 Hold on...\n"); // no stale #3 / #4 entries left
    v = await lyricsView(ws, id);
    expect(v.lines![1]).toMatchObject({ startMs: 43_000, source: "hand", handSkipped: null });
    expect(v.lines![2].source).toBe("alignment");
    expect(v.lines![2].startMs).toBeGreaterThan(43_000); // pushed behind Hold on, never before it
    expect(v.lines![2].handPushed).toEqual({ fromMs: 40_000, because: 2 });
    expect(v.lines![3].startMs).toBeGreaterThan(v.lines![2].startMs);
    // Now Floating by hand too, later: both kept, nothing pushed.
    await saveHandTimes(ws, id, [{ number: 3, ms: 50_000 }]);
    v = await lyricsView(ws, id);
    expect(v.lines!.map((l) => [l.startMs, l.source, l.handPushed])).toEqual([[10_000, "alignment", null], [43_000, "hand", null], [50_000, "hand", null], [55_000, "alignment", null]]);
    // Two hand-set starts out of order: the save refuses and names both lines.
    await expect(saveHandTimes(ws, id, [{ number: 3, ms: 42_000 }])).rejects.toThrow(/Line 2 "Hold on\.\.\." \(.*\) and line 3 "Floating through the night" \(.*\) are both set by hand and out of order/);
    expect(readFileSync(paths.hints!, "utf8")).toBe("[00:43.00]! #2 Hold on...\n[00:50.00]! #3 Floating through the night\n");
  });
});
