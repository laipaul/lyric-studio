// The vocal-start guard (A Heart For Two: line 1 started seconds before it is sung, aligned into the
// intro): a post-process on the stored alignment, never re-aligning. Line 1 and lines after an
// instrumental gap that start more than 1 s before the voice move to the voice start; the move is
// logged and recorded; the voice map is cached; QA gets each line's distance to the voice.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyGuard, asrWindows, flagReason, likelyStart, checkVocalStart, earlyMs, matchFirstWords, moveLineStart, parseLrc, singingLevel, voiceStretches, type AsrWord, type TimedLine, type VoiceLevels } from "../src";
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

  it('A Heart For Two ~1:10, hook "You had a heart for two" 1.5 s early: hooks are always checked; voice and words move it', () => {
    const song = parseLrc(
      [
        "[01:05.00]<01:05.00>The verse <01:06.00>line <01:08.40>", // sung until 1:08.4
        "[01:08.50]<01:08.50>You <01:10.40>had <01:10.70>a <01:10.90>heart <01:11.20>for <01:11.50>two <01:12.50>", // stamped 1.5 s early
        "[01:13.00]<01:13.00>Next <01:13.60>verse <01:14.40>",
        "[01:20.00]",
      ].join("\n"),
      100_000,
    ).map((l) => ({ ...l, isHook: l.text.startsWith("You") }));
    const v = levels([[65_000, 68_400, -12], [70_000, 72_500, -12], [73_000, 74_400, -12]], 100_000);
    const asr = new Map([[1, asrAt(70_050, "You had a heart")]]);
    const c = checkVocalStart(song, v, { asr });
    expect(c.lines.map(row)).toEqual([
      [1, 65_000, 65_000, null, 65_000, 65_000, "in time", "stamp + voice"],
      [2, 68_500, 70_000, 70_050, 68_500, 70_000, "moved", "voice + words"],
    ]);
    // Not a hook: not checked by default; --all checks every line.
    const plain = song.map((l) => ({ ...l, isHook: false }));
    expect(checkVocalStart(plain, v, { asr }).lines.map((l) => l.index)).toEqual([0]);
    expect(checkVocalStart(plain, v, { asr, all: true }).lines.map((l) => [l.index, l.result])).toEqual([
      [0, "in time"],
      [1, "moved"],
      [2, "in time"],
    ]);
    expect(asrWindows(plain, v, true).map((w) => w[0])).toEqual([1, 2, 3]);
    // Sung on without a pause from the previous line: no voice onset of its own (not the next phrase).
    const legato = levels([[65_000, 72_500, -12], [73_000, 74_400, -12]], 100_000);
    const joined = checkVocalStart(song, legato, { asr: new Map([[1, asrAt(68_550, "You had a heart")]]) }).lines[1];
    expect([joined.voiceMs, joined.result]).toEqual([null, "in time"]); // stamp + words agree
  });

  describe("A Heart For Two lines 13, 27, 40: a first word of 2 s or more, voice and words within 0.6 s", () => {
    // Lines 13 and 27 are stamped ~2.4 s early (the first word stretched back 2.4 s); voice and words
    // agree within 0.4-0.5 s that they start later (more than the 0.3 s rule). Line 40, the last line
    // (a hook, a held note?), sung softly: only words and the word-duration estimate, 0.5 s apart: flagged.
    const song = parseLrc(
      [
        "[01:05.00]<01:05.00>The verse <01:06.00>line <01:08.40>",
        "[01:11.40]<01:11.40>Hold <01:13.80>me <01:14.20>close <01:15.40>", // line 13: first word 2.4 s
        "[01:20.00]<01:20.00>Another <01:20.60>verse <01:22.00>",
        "[02:31.50]<02:31.50>Through <02:33.90>the <02:34.20>night <02:35.40>", // line 27: first word 2.4 s
        "[02:40.00]<02:40.00>Then <02:40.60>more <02:42.00>",
        "[02:52.00]<02:52.00>A <02:55.40>heart <02:55.80>for <02:56.30>two <02:57.50>", // line 40: the last line, first word 3.4 s
        "[03:05.00]",
      ].join("\n"),
      200_000,
    ).map((l, i) => ({ ...l, isHook: i === 5 }));
    const v = levels(
      [[65_000, 68_400, SINGING], [73_900, 75_400, SINGING], [80_000, 82_000, SINGING], [153_800, 155_400, SINGING], [160_000, 162_000, SINGING], [175_000, 177_500, -33]], // line 40 sung softly (under the voice level), as on the PC
      200_000,
    );
    const asr = new Map<number, AsrWord[]>([
      [1, asrAt(73_500, "Hold me close")],
      [3, asrAt(153_300, "Through the night")],
      [5, asrAt(175_500, "A heart for two")],
    ]);
    const c = checkVocalStart(song, v, { asr });
    const of = (n: number) => c.lines.find((x) => x.index === n)!;

    it("lines 13 and 27 (checked by default: first word >= 2 s) move to the recognised words", () => {
      expect([of(1).stampMs, of(1).voiceMs, of(1).wordsMs, of(1).targetMs, of(1).result]).toEqual([71_400, 73_900, 73_500, 73_500, "moved"]);
      expect(of(1).why).toBe("the first word lasts 2.4 s and voice and words agree within 0.4 s that it starts later (moved to the recognised words)");
      expect([of(3).stampMs, of(3).voiceMs, of(3).wordsMs, of(3).targetMs, of(3).result]).toEqual([151_500, 153_800, 153_300, 153_300, "moved"]);
    });

    it("line 40 (the last line): its stamp is in silence and words + word durations are later, so it moves to the words (held-note protection only when the stamp has voice); a line set by hand keeps priority", () => {
      expect([of(5).targetMs, of(5).result]).toEqual([175_500, "moved"]);
      const hand = checkVocalStart(song, v, { asr, skip: new Set([1]) });
      expect(hand.lines.find((x) => x.index === 1)!.result).toBe("set by hand");
      expect(hand.moves.map((m) => m.index)).toEqual([3, 5]); // the hand-set line (index 1) is never moved
    });

    it("a short first word with voice and words 0.4 s apart, both over 1 s after a stamp in silence: moved to the words", () => {
      const short = song.map((l, i) => (i === 1 ? { ...l, words: l.words!.map((w, k) => (k === 1 ? { ...w, start_ms: 72_000 } : w)) } : l)); // first word 0.6 s
      const r = checkVocalStart(short, v, { asr, all: true }).lines.find((x) => x.index === 1)!;
      expect([r.targetMs, r.result]).toEqual([73_500, "moved"]);
    });
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

// L1a: the same checks on a clean vocal stem (Suno's vocals.wav) instead of a Demucs stem. The rules
// were tuned on Demucs stems (bleed in the intro and the solo); a clean stem has true silence between
// phrases, but audible breaths, a wet reverb tail after each phrase, delay echoes and ad-libs. These
// tests check that the thresholds (voice = 0.5 s within 15 dB of the singing level, two signals to move)
// decide the same on a clean stem: they do, after two changes the tests showed were needed (the reverb
// tail filling a short pause joined two phrases, and a tail ending just before a stamp counted as that
// line's voice): see splitAtAttacks and the stretch a line is in (src/vocal-guard.ts).
describe("vocal-start check: a stamp in silence with every signal later", () => {
  // Let My Love Carry You, line 5: stamp 0:34.8 in silence (-35 dB, under the voice level -30.5 dB), the
  // voice at 0:38.1, the recognised words at 0:37.2, the first word lasting 3.3 s (durations 0:37.7).
  const SUNG = -15.5;
  const LRC5 = [
    "[00:02.00]<00:02.00>One <00:02.50>two <00:03.00>",
    "[00:08.00]<00:08.00>Two <00:08.50>more <00:09.00>",
    "[00:15.00]<00:15.00>Three <00:15.50>more <00:16.00>",
    "[00:28.00]<00:28.00>Four <00:28.50>more <00:29.00>",
    "[00:34.80]<00:34.80>Let <00:38.10>my <00:38.40>love <00:40.00>",
    "[00:41.00]<00:41.00>Next <00:41.50>line <00:42.00>",
    "[00:45.00]",
  ].join("\n");
  const song = parseLrc(LRC5, 60_000);
  const spans = (extra: [number, number, number][] = []): [number, number, number][] => [
    [2_000, 3_500, SUNG], [8_000, 9_500, SUNG], [15_000, 16_500, SUNG], [28_000, 30_000, SUNG],
    [30_000, 37_500, -35], // bleed on the vocal stem: under the voice level
    [38_100, 40_000, -22], // the voice: over the threshold, under the singing-level energy of a stretched word
    [41_000, 43_000, SUNG],
    ...extra,
  ];
  const asr = new Map([[4, asrAt(37_200, "Let my love")]]);

  it("line 5: all signals later by over the lead-in: moved to the recognised words, with the reason", () => {
    const c = checkVocalStart(song, levels(spans()), { asr });
    expect(c.thresholdDb).toBe(-30.5);
    const l5 = c.lines.find((x) => x.index === 4)!;
    expect([l5.stampMs, l5.stampLevelDb, l5.voiceMs, l5.wordsMs, l5.durationMs, l5.targetMs, l5.result]).toEqual([34_800, -35, 38_100, 37_200, 37_700, 37_200, "moved"]);
    expect(l5.agree).toEqual(["voice", "words", "word durations"]);
    expect(l5.why).toBe("stamp in silence; voice, words, word durations all later (moved to the recognised words)");
    expect(c.moves.find((m) => m.index === 4)).toEqual({ index: 4, fromMs: 34_800, toMs: 37_200, reason: "stamp in silence; voice, words, word durations all later" });
  });

  it("the last line: words and durations 3 s apart and no voice: moved to the earliest (the durations)", () => {
    const last = parseLrc(
      [
        "[00:02.00]<00:02.00>One <00:02.50>two <00:03.00>",
        "[00:08.00]<00:08.00>Two <00:08.50>more <00:09.00>",
        "[00:15.00]<00:15.00>Three <00:15.50>more <00:16.00>",
        "[03:19.40]<03:19.40>Held <03:22.50>note <03:23.50>",
        "[03:30.00]",
      ].join("\n"),
      240_000,
    );
    const v = levels([[2_000, 3_500, SUNG], [8_000, 9_500, SUNG], [15_000, 16_500, SUNG], [190_000, 230_000, -35]], 240_000);
    const c = checkVocalStart(last, v, { asr: new Map([[3, asrAt(205_100, "Held note")]]) });
    const l = c.lines.find((x) => x.index === 3)!;
    expect([l.voiceMs, l.wordsMs, l.durationMs, l.targetMs, l.result, l.agree]).toEqual([null, 205_100, 202_100, 202_100, "moved", ["words", "word durations"]]);
    expect(c.moves).toEqual([{ index: 3, fromMs: 199_400, toMs: 202_100, reason: "stamp in silence; words, word durations all later" }]);
  });

  it("voice at the stamp: this rule never moves it (flagged as before)", () => {
    const c = checkVocalStart(song, levels(spans([[34_900, 35_100, -28]])), { asr }); // too short to be voice, but over the voice level
    const l5 = c.lines.find((x) => x.index === 4)!;
    expect(l5.stampLevelDb).toBe(-28);
    expect([l5.result, l5.targetMs]).toEqual(["flagged for review", 34_800]);
    expect(c.moves.some((m) => m.index === 4)).toBe(false);
  });

  it("one later signal alone never moves it", () => {
    // A normal first word (no word-duration signal) and no recognised words: only the voice is later.
    const short = song.map((l, i) => (i === 4 ? { ...l, words: l.words!.map((w, k) => (k === 1 ? { ...w, start_ms: 35_400 } : w)) } : l));
    const l5 = checkVocalStart(short, levels(spans()), { all: true }).lines.find((x) => x.index === 4)!;
    expect([l5.wordsMs, l5.voiceMs, l5.result]).toEqual([null, 38_100, "flagged for review"]);
  });

  // Line 9 of Let My Love Carry You: stamp 1:03.4, voice 1:05.8, words 1:04.8; the line before (0:58.6) holds
  // its last note past the stamp (about -25 dB), which is not this line's voice.
  describe("the previous line's held note", () => {
    const LRC9 = [
      "[00:02.00]<00:02.00>One <00:02.50>two <00:03.00>",
      "[00:08.00]<00:08.00>Two <00:08.50>more <00:09.00>",
      "[00:15.00]<00:15.00>Three <00:15.50>more <00:16.00>",
      "[00:28.00]<00:28.00>Four <00:28.50>more <00:29.00>",
      "[00:58.60]<00:58.60>Till <00:59.00>the <00:59.40>break <00:60.00>of <00:60.40>day <00:61.00>",
      "[01:03.40]<01:03.40>Let <01:03.50>my <01:03.80>love <01:04.00>",
      "[01:08.00]<01:08.00>Next <01:08.50>line <01:09.00>",
      "[01:12.00]",
    ].join("\n");
    const song9 = parseLrc(LRC9, 80_000);
    const base: [number, number, number][] = [[2_000, 3_500, SUNG], [8_000, 9_500, SUNG], [15_000, 16_500, SUNG], [28_000, 30_000, SUNG]];
    const asr9 = new Map([[5, asrAt(64_800, "Let my love")]]);
    it("a held last note under the stamp is not voice of the line: moved to the words", () => {
      const v = levels([...base, [58_500, 60_500, SUNG], [60_500, 63_500, -25], [65_800, 67_500, -20], [68_000, 70_000, SUNG]], 80_000);
      const c = checkVocalStart(song9, v, { asr: asr9, all: true });
      const l9 = c.lines.find((x) => x.index === 5)!;
      expect(c.thresholdDb).toBe(-30.5);
      expect([l9.stampLevelDb, l9.ownLevelDb, l9.voiceMs, l9.wordsMs, l9.targetMs, l9.result]).toEqual([-25, -100, 65_800, 64_800, 64_800, "moved"]);
      expect(c.moves.find((m) => m.index === 5)).toEqual({ index: 5, fromMs: 63_400, toMs: 64_800, reason: "stamp in silence; voice, words all later" });
    });
    it("this line's own voice already sounding at the stamp: never moved by the rule", () => {
      const v = levels([...base, [58_500, 60_500, SUNG], [60_500, 63_000, -25], [63_300, 64_500, -20], [65_800, 67_500, -20], [68_000, 70_000, SUNG]], 80_000);
      const c = checkVocalStart(song9, v, { asr: asr9, all: true });
      const l9 = c.lines.find((x) => x.index === 5)!;
      expect(l9.ownLevelDb).toBeGreaterThanOrEqual(c.thresholdDb);
      expect(l9.why).not.toContain("stamp in silence");
      expect(c.moves.some((m) => m.index === 5 && m.reason)).toBe(false);
    });
  });

  it("a hand-set start is never touched", () => {
    const c = checkVocalStart(song, levels(spans()), { asr, skip: new Set([4]) });
    const l5 = c.lines.find((x) => x.index === 4)!;
    expect([l5.result, l5.targetMs]).toEqual(["set by hand", 34_800]);
    expect(c.moves.some((m) => m.index === 4)).toBe(false);
  });
});

describe("vocal-start check on a clean vocal stem (Suno)", () => {
  const lines = parseLrc(LRC, 60_000);
  // A reverb tail: from the singing level down 40 dB per second (wet stems keep the room).
  const tail = (from: number): [number, number, number][] => Array.from({ length: 50 }, (_, k) => [from + k * 20, from + (k + 1) * 20, SINGING - (40 * (k * 20)) / 1000] as [number, number, number]);
  const CLEAN: VoiceLevels = levels([
    [5_000, 5_300, -24], // a breath, louder than on the Demucs stem (nothing masks it)
    [9_000, 9_300, -24],
    [10_400, 10_750, -17], // a short hum
    [11_800, 14_000, SINGING],
    ...tail(14_000),
    [15_000, 18_000, SINGING],
    ...tail(18_000),
    [19_300, 19_700, -20], // a delay echo of the last word
    [45_000, 46_500, SINGING],
    ...tail(46_500),
    [47_000, 50_000, SINGING],
  ]);

  it("decides exactly as on the Demucs stem: line 1 moved, line 3 flagged without words, line 4 in time", () => {
    const demucs = checkVocalStart(lines, HEART);
    const clean = checkVocalStart(lines, CLEAN);
    expect(clean.levelDb).toBe(SINGING);
    expect(clean.lines.map((c) => [c.index + 1, c.voiceMs, c.targetMs, c.result])).toEqual(demucs.lines.map((c) => [c.index + 1, c.voiceMs, c.targetMs, c.result]));
    expect(clean.lines.map(row)).toEqual([
      [1, 3_200, 11_800, null, 11_800, 11_800, "moved", "voice + word durations"],
      [3, 40_000, 45_000, null, 40_000, 40_000, "flagged for review", ""],
      [4, 47_000, 47_000, null, 47_000, 47_000, "in time", "stamp + voice"],
    ]);
  });

  it("with the recognised words: the same moves as on the Demucs stem", () => {
    const asr = new Map([
      [0, asrAt(11_850, "A heart for two")],
      [2, asrAt(45_080, "after the solo")],
    ]);
    const c = checkVocalStart(lines, CLEAN, { asr });
    expect(c.lines.map(row).slice(0, 2)).toEqual([
      [1, 3_200, 11_800, 11_850, 11_800, 11_800, "moved", "voice + words + word durations"],
      [3, 40_000, 45_000, 45_080, 40_000, 45_000, "moved", "voice + words"],
    ]);
  });

  it("breaths, a reverb tail and a delay echo are not voice; the silence between phrases is true silence", () => {
    const stretches = voiceStretches(CLEAN, SINGING - 15);
    // The tails join their phrase (no separate voice), the breaths, the hum and the echo are too short.
    expect(stretches.map(([a]) => a)).toEqual([11_800, 15_000, 45_000, 47_000]);
    expect(stretches[0][1]).toBeLessThan(14_500); // the tail ends the phrase within 0.4 s (40 dB/s down to -29 dB)
    expect(Math.min(...CLEAN.db)).toBe(-100);
  });

  it("an ad-lib on the lead stem before a line is voice, but never moves the line on its own", () => {
    // "Ooh" sung 2.5 s before the line after the solo, the line itself in time.
    const timed = parseLrc(LRC.replace("[00:40.00]<00:40.00>After <00:40.60>the <00:41.00>solo <00:42.00>", "[00:45.00]<00:45.00>After <00:45.40>the <00:45.80>solo <00:46.40>"), 60_000);
    const adlib = levels([
      [11_800, 14_000, SINGING],
      [15_000, 18_000, SINGING],
      [42_500, 43_400, -16], // the ad-lib
      [45_000, 46_500, SINGING],
      [47_000, 50_000, SINGING],
    ]);
    const c = checkVocalStart(timed, adlib, { asr: new Map([[2, asrAt(45_050, "after the solo")]]) });
    const line3 = c.lines.find((l) => l.index === 2)!;
    expect(line3.result).not.toBe("moved");
    expect(applyGuard(timed, c.moves)[2].start_ms).toBe(45_000);
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
      "vocal-start check: listening to the vocals separated by the app (Demucs); singing level -14.0 dB; voice = at least 0.5 s above -29.0 dB; recognised words: ran",
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

describe("a flagged line: its likely start and the reason in plain words", () => {
  const c = (o: { stampMs?: number; voiceMs?: number | null; wordsMs?: number | null; durationMs?: number | null }) => ({ stampMs: 60_000, voiceMs: null, wordsMs: null, durationMs: null, ...o });
  it("two signals within 1 s: the earlier one is proposed", () => {
    expect(likelyStart(c({ voiceMs: 64_800, wordsMs: 64_000 }))).toBe(64_000); // voice 1:04.8 + words 1:04.0
    expect(likelyStart(c({ voiceMs: 64_000, wordsMs: 64_900 }))).toBe(64_000);
    expect(likelyStart(c({ voiceMs: 64_000, wordsMs: 65_300 }))).toBeNull(); // 1.3 s apart
    expect(likelyStart(c({ voiceMs: 64_000 }))).toBeNull(); // one signal
  });
  it("word durations count only when they differ from the stamp (a stretched first word)", () => {
    expect(likelyStart(c({ wordsMs: 63_500, durationMs: 60_000 }))).toBeNull(); // durations = the stamp: no signal
    expect(likelyStart(c({ wordsMs: 63_500, durationMs: 63_000 }))).toBe(63_000);
    expect(likelyStart(c({ voiceMs: 60_100, wordsMs: 60_600 }))).toBeNull(); // already at the stamp
  });
  it("reasons: size and direction, whole seconds above 2 s, halves below", () => {
    expect(flagReason(c({ wordsMs: 62_100 }))).toBe("The singing may start about 2 s later than shown. Listen with ▶.");
    expect(flagReason(c({ wordsMs: 61_500 }))).toBe("The singing may start about 1.5 s later than shown. Listen with ▶.");
    expect(flagReason(c({ voiceMs: 58_400 }))).toBe("The singing may start about 1.5 s earlier than shown. Listen with ▶.");
    expect(flagReason(c({ voiceMs: 66_600 }))).toBe("The singing may start about 7 s later than shown. Listen with ▶."); // 6.6 -> 7
    expect(flagReason(c({ voiceMs: 64_800, wordsMs: 64_000 }))).toBe("The singing may start about 4 s later than shown. Listen with ▶."); // the likely start
    expect(flagReason(c({}))).toBe("The app could not hear where this line starts. Listen with ▶.");
    expect(flagReason(c({ durationMs: 63_000 }), true)).toBe("The first word may be a long held note. Listen with ▶.");
    expect(flagReason(c({ durationMs: 63_000 }), false)).toBe("The singing may start about 3 s later than shown. Listen with ▶.");
  });
});
