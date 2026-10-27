// The vocal-start guard (A Heart For Two: line 1 started seconds before it is sung, aligned into the
// intro): a post-process on the stored alignment, never re-aligning. Line 1 and lines after an
// instrumental gap that start more than 1 s before the voice move to the voice start; the move is
// logged and recorded; the voice map is cached; QA gets each line's distance to the voice.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyGuard, asrWindows, checkVocalStart, earlyMs, matchFirstWords, moveLineStart, parseLrc, singingLevel, voiceStretches, type AsrWord, type TimedLine, type VoiceLevels } from "../src";
import { applyVocalGuard, ensureAlignment, findOrCreateSongProject, type AlignRunner, type FirstWordsRunner, type VoiceMapRunner } from "../src/node";
import { makeSong } from "./media-helpers";

// The song: line 1 aligned at 0:03.2 into the intro (sung from 0:11.8, only its first word stretched
// back); line 3 aligned 5 s early into a guitar solo (sung from 0:45); the other lines in time.
const LRC = [
  "[00:03.20]<00:03.20>A <00:11.90>heart <00:12.20>for <00:12.50>two <00:13.00>",
  "[00:15.00]<00:15.00>Second <00:15.60>line <00:16.40>",
  "[00:40.00]<00:40.00>After <00:40.60>the <00:41.00>solo <00:42.00>",
  "[00:47.00]<00:47.00>Last <00:47.50>line <00:48.40>",
  "[00:50.00]",
].join("\n");

// The vocal track's level every 20 ms, as the voice map has it.
const levels = (spans: [number, number, number][], totalMs = 60_000, floor = -100): VoiceLevels => {
  const db = Array.from({ length: totalMs / 20 }, () => floor);
  for (const [from, to, level] of spans) for (let k = Math.round(from / 20); k < Math.round(to / 20); k++) db[k] = Math.max(db[k], level);
  return { hopMs: 20, db };
};
// A Heart For Two as reported: the intro is not silent on the vocal track. Guitar bleed at -32 dB all
// through the intro and the solo, two breaths (-22 dB, 0.2-0.25 s) and a short hum (-17 dB, 0.35 s)
// before the singing starts at 0:11.8 (about -14 dB).
const SINGING = -14;
const HEART: VoiceLevels = levels([
  [0, 11_800, -32], // bleed in the intro
  [5_000, 5_250, -22], // a breath
  [9_000, 9_200, -22], // a breath
  [10_400, 10_750, -17], // a short hum
  [11_800, 14_000, SINGING],
  [15_000, 18_000, SINGING],
  [18_000, 45_000, -32], // bleed in the solo
  [45_000, 46_500, SINGING],
  [47_000, 50_000, SINGING],
]);

const asrAt = (ms: number, text: string): AsrWord[] => text.split(" ").map((w, k) => ({ text: w, start_ms: ms + k * 320, end_ms: ms + k * 320 + 280, prob: 0.8 }));
const row = (c: ReturnType<typeof checkVocalStart>["lines"][number]) => [c.index + 1, c.stampMs, c.voiceMs, c.wordsMs, c.durationMs, c.targetMs, c.result, c.agree.join(" + ")];

describe("vocal-start check (pure)", () => {
  const lines = parseLrc(LRC, 60_000);

  it("A Heart For Two: bleed, breaths and a short hum in the intro are not voice; voice and word durations agree on line 1", () => {
    // Why the first version did not fire: voice was "anything within 20 dB of the loudest 5%", so the
    // bleed counted as singing from 0:00 and line 1 looked in time.
    const loudest = [...HEART.db].sort((a, b) => a - b)[Math.round(0.95 * (HEART.db.length - 1))];
    expect(voiceStretches(HEART, loudest - 20)[0][0]).toBe(0);
    // Now: relative to the song's own singing level, sustained for at least 0.5 s.
    expect(singingLevel(lines, HEART)).toBe(SINGING);
    const c = checkVocalStart(lines, HEART);
    expect(c.thresholdDb).toBe(SINGING - 15);
    expect(c.lines.map(row)).toEqual([
      [1, 3_200, 11_800, null, 11_800, 11_800, "moved", "voice + word durations"],
      [3, 40_000, 45_000, null, 40_000, 40_000, "flagged for review", ""], // the voice alone never moves a line
      [4, 47_000, 47_000, null, 47_000, 47_000, "in time", "stamp + voice"],
    ]);
    expect(c.lines[0].loudestBeforeDb).toBe(-17); // the hum: loud, but too short to be voice
    expect(c.lines[1].why).toBe("only voice 0:45.0 (+5.0 s); no second signal agrees");
    const fixed = applyGuard(lines, c.moves);
    // Line 1: only the stretched first word moves; the words already in the voice keep their times.
    expect(fixed[0].words!.map((w) => w.start_ms)).toEqual([11_800, 11_900, 12_200, 12_500]);
    expect(fixed[0].sung_end_ms).toBe(13_000);
    expect(fixed.slice(1)).toEqual(lines.slice(1));
    expect(earlyMs(lines, c.stretches)[0]).toBe(8_600); // what QA would report without the check
  });

  it("with the recognised words: line 1 on all three, the line after the solo on voice + words", () => {
    const asr = new Map([
      [0, asrAt(11_850, "A heart for two")],
      [2, asrAt(45_080, "after the solo")],
    ]);
    const c = checkVocalStart(lines, HEART, { asr });
    expect(c.lines.map(row).slice(0, 2)).toEqual([
      [1, 3_200, 11_800, 11_850, 11_800, 11_800, "moved", "voice + words + word durations"],
      [3, 40_000, 45_000, 45_080, 40_000, 45_000, "moved", "voice + words"],
    ]);
    expect(c.lines[0].wordsText).toBe("A heart for");
    const fixed = applyGuard(lines, c.moves);
    // Line 3: sung entirely before the voice: moved as a whole, squeezed to end before line 4.
    expect(fixed[2].start_ms).toBe(45_000);
    expect(fixed[2].sung_end_ms).toBeLessThanOrEqual(46_950);
    expect(earlyMs(fixed, c.stretches).every((e) => e !== null && e <= 1_000)).toBe(true);
  });

  // The user's check-start results on A Heart For Two (0:12.4 -> 0:21.0; lines 14 and 28 "And a place";
  // line 40), rebuilt with the same signals.
  describe("A Heart For Two as checked on the PC", () => {
    const song = [
      "[00:12.40]<00:12.40>A <00:22.30>heart <00:22.70>for <00:23.10>two <00:23.80>", // first word 9.9 s
      "[00:25.00]<00:25.00>Line two <00:25.60>here <00:26.40>",
      "[00:30.00]<00:30.00>Line three <00:30.60>here <00:32.40>",
      "[00:40.00]<00:40.00>Line four <00:40.60>here <00:42.40>",
      "[01:18.60]<01:18.60>And <01:19.00>a <01:19.30>place <01:20.40>", // line 5 here = line 14 there
      "[01:24.00]<01:24.00>Then <01:24.60>more <01:25.40>",
      "[02:52.00]<02:52.00>A <02:55.40>heart <02:55.80>for <02:56.30>two <02:57.50>", // the last line, a hook: first word 3.4 s
      "[03:05.00]",
    ].join("\n");
    const ls = parseLrc(song, 200_000).map((l, i) => ({ ...l, isHook: i === 6 }));
    const v = levels(
      [
        [12_000, 12_600, -24], // "the sound at 0:12": short and quiet
        [20_950, 23_900, SINGING],
        [25_000, 26_400, SINGING],
        [30_000, 32_400, SINGING],
        [40_000, 42_400, SINGING],
        [78_600, 80_400, -31], // "And a place" sung softly: under the voice level (-29 dB)
        [84_000, 85_400, -31],
        [101_600, 104_000, SINGING], // the next loud singing, 23 s after the stamp
        [172_000, 177_500, -33], // a soft last line
      ],
      200_000,
    );
    const asr = new Map<number, AsrWord[]>([
      [0, asrAt(21_000, "A heart for two")],
      [4, asrAt(76_600, "And a place")], // 2.0 s before the stamp: the recognised words alone
    ]);
    const c = checkVocalStart(ls, v, { asr });
    const of = (n: number) => c.lines.find((x) => x.index === n - 1)!;

    it("line 1: a first word of 9.9 s and the recognised words near its estimate: moved to the words", () => {
      expect([of(1).targetMs, of(1).result, of(1).agree]).toEqual([21_000, "moved", ["words", "word durations"]]);
      expect(of(1).why).toBe("the first word lasts 9.9 s and the recognised words are within 0.1 s of the word-duration estimate");
    });

    it('"And a place": the recognised words alone (2.0 s earlier) never move it; flagged for review', () => {
      expect([of(5).targetMs, of(5).result]).toEqual([78_600, "flagged for review"]);
      expect(of(5).why).toBe("only voice 1:41.6 (+23.0 s), only words 1:16.6 (-2.0 s); no second signal agrees");
      // Why the voice was 23 s late: the singing there is under the voice level (shown in the printout).
      expect(of(5).stampLevelDb).toBe(-31);
      expect(c.thresholdDb).toBe(-29);
    });

    it("line 40: a 3.4 s first word on a hook, no voice, no words: kept and flagged (a held note?)", () => {
      expect([of(7).targetMs, of(7).result]).toEqual([172_000, "flagged for review"]);
      expect(of(7).why).toMatch(/^only word durations .*; no second signal agrees; the long first word \(3\.4 s\) may be a held note \(a hook\)$/);
    });

    it("moves only line 1", () => {
      expect(c.moves).toEqual([{ index: 0, fromMs: 12_400, toMs: 21_000 }]);
    });
  });

  it("A Heart For Two 10 s early with loud bleed: the long first word and the words move it; without words it is only flagged", () => {
    const loud = levels([
      [0, 11_800, -22], // bleed within 15 dB of the singing: "voice" from 0:00
      [11_800, 14_000, SINGING],
      [15_000, 18_000, SINGING],
      [45_000, 46_500, SINGING],
      [47_000, 50_000, SINGING],
    ]);
    const tenEarly = parseLrc(LRC.replace("[00:03.20]<00:03.20>A", "[00:01.80]<00:01.80>A"), 60_000);
    const withWords = checkVocalStart(tenEarly, loud, { asr: new Map([[0, asrAt(11_900, "a heart for two")]]) });
    expect(row(withWords.lines[0])).toEqual([1, 1_800, 0, 11_900, 11_800, 11_900, "moved", "words + word durations"]);
    const without = checkVocalStart(tenEarly, loud);
    expect([without.lines[0].targetMs, without.lines[0].result]).toEqual([1_800, "flagged for review"]);
  });

  it("the whole line placed early with normal word lengths: the recognised words alone only flag it", () => {
    const loud = levels([
      [0, 11_800, -22],
      [11_800, 14_000, SINGING],
      [15_000, 18_000, SINGING],
    ]);
    const early = parseLrc("[00:02.00]<00:02.00>A <00:02.30>heart <00:02.70>for <00:03.10>two <00:03.60>\n[00:15.00]<00:15.00>Second <00:15.60>line <00:16.40>\n[00:20.00]", 60_000);
    const c = checkVocalStart(early, loud, { asr: new Map([[0, asrAt(11_820, "a heart for two")]]) });
    expect([c.lines[0].targetMs, c.lines[0].result]).toEqual([2_000, "flagged for review"]);
  });

  it("Love Is A Good Thing (all in time): every signal agrees, nothing moves", () => {
    const fine = parseLrc("[00:08.40]<00:08.40>Love <00:08.90>is <00:09.20>a <00:09.40>good <00:09.80>thing <00:10.60>\n[00:11.20]<00:11.20>Next <00:11.80>line <00:12.50>\n[00:30.00]", 40_000);
    const v = levels([
      [0, 8_400, -40], // quiet bleed in the intro
      [8_380, 10_600, -12],
      [11_200, 12_500, -12],
    ], 40_000);
    const c = checkVocalStart(fine, v, { asr: new Map([[0, asrAt(8_450, "Love is a good thing")]]) });
    expect(c.lines.map(row)).toEqual([[1, 8_400, 8_380, 8_450, 8_400, 8_400, "in time", "stamp + voice + words"]]);
    expect(c.moves).toEqual([]);
  });

  it("Love Is A Good Thing lines 15, 17, 22, 34: a difference smaller than the 1 s lead-in is not visible: in time, not flagged", () => {
    const song = parseLrc(
      [
        "[00:10.00]<00:10.00>First <00:10.60>line <00:11.40>",
        "[00:20.00]<00:20.00>After <00:20.60>a gap <00:21.40>", // after 8.6 s without singing: checked
        "[00:23.00]<00:23.00>Next <00:23.60>one <00:24.40>",
        "[00:40.00]<00:40.00>After <00:40.60>another <00:41.40>",
        "[00:45.00]",
      ].join("\n"),
      60_000,
    );
    const v = levels([[10_000, 11_400, -12], [20_000, 21_400, -12], [23_000, 24_400, -12], [40_000, 41_400, -12]], 60_000);
    // The recognised words alone say 0.4 s and 0.8 s earlier: under the lead-in, invisible.
    const asr = new Map([[1, asrAt(19_600, "After a gap")], [3, asrAt(39_200, "After another")]]);
    const c = checkVocalStart(song, v, { asr, reviewMs: 1_000 });
    const l2 = c.lines.find((x) => x.index === 1)!;
    expect([l2.result, l2.targetMs]).toEqual(["in time", 20_000]); // stamp + voice agree anyway
    const l4 = c.lines.find((x) => x.index === 3)!;
    expect([l4.result, l4.targetMs]).toEqual(["in time", 40_000]);
    // Without the voice (e.g. a soft passage), only the words disagree, by 0.8 s: still not flagged.
    const soft = levels([[10_000, 11_400, -12], [20_000, 21_400, -12], [23_000, 24_400, -12], [40_000, 41_400, -40]], 60_000);
    const quiet = checkVocalStart(song, soft, { asr, reviewMs: 1_000 }).lines.find((x) => x.index === 3)!;
    expect([quiet.result, quiet.why]).toEqual(["in time", "only words 0:39.2 (-0.8 s); less than the 1.0 s lead-in, not visible"]);
    // With a shorter lead-in (brand motion.gapLeadInS 0.5 s) the same 0.8 s is visible: flagged.
    expect(checkVocalStart(song, soft, { asr, reviewMs: 500 }).lines.find((x) => x.index === 3)!.result).toBe("flagged for review");
    expect(c.moves).toEqual([]);
  });

  it('Love Is A Good Thing line 39 "The old ones": voice and words agree 1.3 s later, inside line 38 (held too long): line 38 ends there', () => {
    const song = parseLrc(
      [
        "[02:50.00]<02:50.00>Line thirty <02:51.00>eight <03:01.50>", // its last word "held" until 3:01.5
        "[02:59.70]<02:59.70>The <03:01.40>old <03:01.80>ones <03:02.60>",
        "[03:04.00]<03:04.00>After <03:05.00>",
        "[03:10.00]",
      ].join("\n"),
      200_000,
    );
    const v = levels([[170_000, 175_000, -12], [181_000, 182_600, -12], [184_000, 185_000, -12]], 200_000);
    // Checked because its recognised words are asked for (here: a 4.6 s gap before it in the voice).
    const c = checkVocalStart(song, v, { asr: new Map([[1, asrAt(181_050, "The old ones")]]) });
    const l39 = c.lines.find((x) => x.index === 1)!;
    expect([l39.targetMs, l39.result, l39.agree]).toEqual([181_000, "moved", ["voice", "words"]]);
    expect(c.moves).toEqual([{ index: 1, fromMs: 179_700, toMs: 181_000, shortensPrevious: true }]);
    const fixed = applyGuard(song, c.moves);
    expect([fixed[0].sung_end_ms, fixed[1].start_ms]).toEqual([180_950, 181_000]);
    // An EARLIER start inside the previous line stays as it is.
    const earlier = checkVocalStart(song, levels([[170_000, 175_000, -12], [178_000, 179_000, -12], [184_000, 185_000, -12]], 200_000), {
      asr: new Map([[1, asrAt(178_050, "The old ones")]]),
    });
    expect(earlier.lines.find((x) => x.index === 1)!.result).toBe("flagged for review");
  });

  it("matches the line's first words: case and punctuation ignored, a missed short first word allowed", () => {
    expect(matchFirstWords("A heart for two", asrAt(5_000, "oh A heart for"))).toEqual({ ms: 5_320, text: "A heart for" });
    expect(matchFirstWords("I won't let go", asrAt(5_000, "Won't let go"))).toEqual({ ms: 4_750, text: "Won't" }); // "won t" = the 2nd and 3rd tokens
    expect(matchFirstWords("Love is a good thing", asrAt(5_000, "LOVE, is a"))).toEqual({ ms: 5_000, text: "LOVE, is a" });
    expect(matchFirstWords("A heart for two", asrAt(5_000, "something else entirely"))).toBeNull();
  });

  it("never moves a line onto or past the next one; hand-placed lines stay", () => {
    const both: TimedLine[] = [
      { text: "One", start_ms: 3_000, end_ms: 6_000, isHook: false, words: [{ text: "One", start_ms: 3_000 }, { text: "more", start_ms: 11_900 }] },
      { text: "Two", start_ms: 6_000, end_ms: 15_000, isHook: false },
      { text: "Three", start_ms: 15_000, end_ms: 20_000, isHook: false },
    ];
    const c = checkVocalStart(both, HEART);
    // Voice and word durations agree on 0:11.8, but that is past line 2.
    expect([c.lines[0].result, c.lines[0].why]).toEqual(["flagged for review", "voice, word durations agree, but that is past the next line"]);
    expect(checkVocalStart(lines, HEART, { skip: new Set([0]) }).lines[0].result).toBe("set by hand");
  });

  it("lines inside a verse are not checked; a quiet verse line is not 'early' when within 15 dB", () => {
    const verse: TimedLine[] = [
      { text: "One", start_ms: 12_000, end_ms: 15_000, isHook: false, sung_end_ms: 14_500 },
      { text: "Two", start_ms: 15_500, end_ms: 20_000, isHook: false, sung_end_ms: 19_000 },
    ];
    const v = levels([
      [12_000, 14_500, -12],
      [15_500, 19_000, -24], // sung softly, 12 dB lower
    ]);
    const c = checkVocalStart(verse, v);
    expect(c.lines.map((l) => l.index)).toEqual([0]);
    expect(earlyMs(verse, c.stretches)).toEqual([0, 0]);
  });

  it("asks speech recognition only around the checked lines", () => {
    expect(asrWindows(lines, HEART)).toEqual([
      [1, 1_200, 15_000],
      [3, 38_000, 47_000],
      [4, 45_000, 51_000], // the last line: up to 4 s after its signals
    ]);
  });

  it("a line without word timings moves its start", () => {
    expect(moveLineStart({ text: "x", start_ms: 1_000, end_ms: 9_000, isHook: false }, 5_000, 9_000)).toEqual({ text: "x", start_ms: 5_000, end_ms: 9_000, isHook: false });
  });
});

describe("pnpm make: the guard on the stored alignment", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-guard-"));
  let ws: Workspace;
  const aligner: { calls: number; run: AlignRunner } = {
    calls: 0,
    run: async (a) => {
      aligner.calls++;
      writeFileSync(a.out, `${LRC}\n`);
      const report = parseLrc(LRC, 60_000).map((l, i) => ({ number: i + 1, text: l.text, is_hook: false, start_ms: l.start_ms, end_ms: l.sung_end_ms ?? l.end_ms, confidence: 0.8 }));
      writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: report }));
    },
  };
  const voice = { calls: 0 };
  const voiceMap: VoiceMapRunner = async (a) => {
    voice.calls++;
    writeFileSync(a.out, JSON.stringify({ version: 2, stem: "x-htdemucs-vocals.wav", hop_ms: HEART.hopMs, db: HEART.db }));
  };
  const heard = { calls: 0 };
  const firstWords: FirstWordsRunner = async (a) => {
    heard.calls++;
    const said: Record<number, AsrWord[]> = { 1: asrAt(11_850, "A heart for two"), 3: asrAt(45_080, "after the solo"), 4: asrAt(47_020, "last line") };
    writeFileSync(a.out, JSON.stringify({ version: 1, model: "fake", lang: a.lang, windows: a.windows.map(([line, from, to]) => ({ line, from_ms: from, to_ms: to, words: said[line] ?? [] })) }));
  };
  let song: string;
  let lyrics: string;

  beforeAll(() => {
    ws = openWorkspace(path.join(root, "workspace"));
    mkdirSync(path.join(root, "in"), { recursive: true });
    song = path.join(root, "in", "A Heart For Two.wav");
    makeSong(song, 2);
    lyrics = path.join(root, "in", "lyrics.txt");
    writeFileSync(lyrics, "A heart for two\nSecond line\nAfter the solo\nLast line\n");
  });
  afterAll(() => {
    ws?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("reuses the stored alignment, logs and records each move, runs the voice map once", async () => {
    const sp = await findOrCreateSongProject(ws, song);
    const run = async () => {
      const log: string[] = [];
      const stored = await ensureAlignment(ws, sp, { lyricsTxt: lyrics, durationMs: 60_000, align: aligner.run, log: (m) => log.push(m) });
      const guarded = await applyVocalGuard(ws, sp, stored, { log: (m) => log.push(m), voiceMap, firstWords });
      return { log, stored, guarded };
    };
    await run(); // the first alignment
    const { log, stored, guarded } = await run();
    expect(aligner.calls).toBe(1); // never aligned again for the guard
    expect(voice.calls).toBe(1); // the voice map is cached
    expect(log.some((l) => l.startsWith("lyrics: using the stored alignment"))).toBe(true);
    expect(heard.calls).toBe(1); // the recognised words are cached too
    // What was measured is always printed, also for lines that stay.
    expect(log.filter((l) => l.startsWith("vocal-start check:"))).toEqual([
      "vocal-start check: singing level -14.0 dB; voice = at least 0.5 s above -29.0 dB; recognised words: ran",
      'vocal-start check: line 1 stamp 0:03.2 · voice 0:11.8 (vocal track at the stamp: up to -22.0 dB) · words 0:11.8 "A heart for" · word durations 0:11.8 (first word 8.7 s) -> 0:11.8: moved (+8.6 s); the first word lasts 8.7 s and the recognised words are within 0.1 s of the word-duration estimate; loudest sound before it -17.0 dB',
      'vocal-start check: line 3 stamp 0:40.0 · voice 0:45.0 (vocal track at the stamp: up to -32.0 dB, under the voice level -29.0 dB) · words 0:45.1 "after the solo" · first word 0.6 s -> 0:45.0: moved (+5.0 s); voice, words agree; loudest sound before it -32.0 dB',
      'vocal-start check: line 4 stamp 0:47.0 · voice 0:47.0 (vocal track at the stamp: up to -14.0 dB) · words 0:47.0 "last line" · first word 0.5 s -> 0:47.0: in time; stamp, voice, words agree',
    ]);
    expect(log.filter((l) => l.startsWith("guard:"))).toEqual(["guard: line 1 moved from 0:03.2 to 0:11.8 (vocals start)", "guard: line 3 moved from 0:40.0 to 0:45.0 (vocals start)"]);
    expect(guarded.guard?.check.lines.map((l) => [l.number, l.stamp_ms, l.voice_ms, l.words_ms, l.duration_ms, l.target_ms, l.result])).toEqual([
      [1, 3_200, 11_800, 11_850, 11_800, 11_800, "moved"],
      [3, 40_000, 45_000, 45_080, 40_000, 45_000, "moved"],
      [4, 47_000, 47_000, 47_020, 47_000, 47_000, "in time"],
    ]);
    expect(guarded.lines[0].start_ms).toBe(11_800);
    expect(guarded.guard?.earlyMs.every((e) => e !== null && e <= 1_000)).toBe(true);
    // The stored alignment is never changed; the moves and what was measured are recorded next to it.
    expect(readFileSync(stored.lrcFile, "utf8")).toBe(`${LRC}\n`);
    const dir = path.dirname(stored.lrcFile);
    const record = readdirSync(dir).find((f) => /^guard-[0-9a-f]{12}\.json$/.test(f))!;
    const recorded = JSON.parse(readFileSync(path.join(dir, record), "utf8"));
    expect([recorded.moves.length, recorded.check.lines.length, recorded.check.level_db]).toEqual([2, 3, -14]);
  });

  it("flagged lines are printed clearly, listed at the end and kept where the alignment has them", async () => {
    const sp = await findOrCreateSongProject(ws, song);
    const stored = await ensureAlignment(ws, sp, { lyricsTxt: lyrics, durationMs: 60_000, align: aligner.run });
    const log: string[] = [];
    // No recognised words for line 3 this time: the voice alone says 0:45.0.
    const onlyLineOne: FirstWordsRunner = async (a) =>
      writeFileSync(a.out, JSON.stringify({ version: 1, windows: a.windows.map(([line, from, to]) => ({ line, from_ms: from, to_ms: to, words: line === 1 ? asrAt(11_850, "A heart for two") : [] })) }));
    process.env.FIRST_WORDS_MODEL = "other"; // a new cache key for this test
    const guarded = await applyVocalGuard(ws, sp, stored, { log: (m) => log.push(m), voiceMap, firstWords: onlyLineOne });
    delete process.env.FIRST_WORDS_MODEL;
    expect(log.filter((l) => l.includes("FLAGGED FOR REVIEW"))).toEqual([
      "vocal-start check: FLAGGED FOR REVIEW: line 3 stamp 0:40.0 · voice 0:45.0 (vocal track at the stamp: up to -32.0 dB, under the voice level -29.0 dB) · words – · first word 0.6 s -> 0:40.0: flagged for review; only voice 0:45.0 (+5.0 s); no second signal agrees; loudest sound before it -32.0 dB",
    ]);
    expect(log).toContain("vocal-start check: 1 line(s) flagged for review (kept where the alignment has them; check them by ear, later in the Lyrics tab): line 3");
    expect(guarded.lines[2].start_ms).toBe(40_000);
    expect(guarded.warnings.at(-1)).toBe("Vocal-start check: line 3 flagged for review (the signals do not agree; kept where the alignment has them).");
  });

  it("no vocal track available: the check is skipped with a warning, the alignment used as it is", async () => {
    const sp = await findOrCreateSongProject(ws, song);
    const stored = await ensureAlignment(ws, sp, { lyricsTxt: lyrics, durationMs: 60_000, align: aligner.run });
    for (const f of readdirSync(path.dirname(stored.lrcFile)).filter((x) => x.startsWith("voice-"))) rmSync(path.join(path.dirname(stored.lrcFile), f));
    const failing: VoiceMapRunner = async () => {
      throw new Error("python said\nThe vocal track of this song is not cached and the AI packages are not installed: install them with pnpm audio:setup --ai.");
    };
    const guarded = await applyVocalGuard(ws, sp, stored, { voiceMap: failing });
    expect(guarded.guard).toBeNull();
    expect(guarded.lines).toEqual(stored.lines);
    expect(guarded.warnings.at(-1)).toMatch(/vocal-start check was skipped \(The vocal track of this song is not cached/);
    expect(readdirSync(path.dirname(stored.lrcFile)).some((f) => f.endsWith(".part"))).toBe(false);
    expect(existsSync(stored.lrcFile)).toBe(true);
  });
});
