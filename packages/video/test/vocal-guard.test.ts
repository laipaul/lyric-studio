// The vocal-start guard (A Heart For Two: line 1 started seconds before it is sung, aligned into the
// intro): a post-process on the stored alignment, never re-aligning. Line 1 and lines after an
// instrumental gap that start more than 1 s before the voice move to the voice start; the move is
// logged and recorded; the voice map is cached; QA gets each line's distance to the voice.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyGuard, earlyMs, moveLineStart, parseLrc, planGuard, type TimedLine, type VoiceStretch } from "../src";
import { applyVocalGuard, ensureAlignment, findOrCreateSongProject, type AlignRunner, type VoiceMapRunner } from "../src/node";
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
const VOICE: VoiceStretch[] = [
  [11_800, 14_000],
  [15_000, 18_000],
  [45_000, 46_500],
  [47_000, 50_000],
];

describe("vocal-start guard (pure)", () => {
  const lines = parseLrc(LRC, 60_000);

  it("moves line 1 out of the intro and a line after a solo; leaves lines in time alone", () => {
    expect(planGuard(lines, VOICE)).toEqual([
      { index: 0, fromMs: 3_200, toMs: 11_800 },
      { index: 2, fromMs: 40_000, toMs: 45_000 },
    ]);
    const fixed = applyGuard(lines, planGuard(lines, VOICE));
    // Line 1: only the stretched first word moves; the words already in the voice keep their times.
    expect(fixed[0].start_ms).toBe(11_800);
    expect(fixed[0].words!.map((w) => w.start_ms)).toEqual([11_800, 11_900, 12_200, 12_500]);
    expect(fixed[0].sung_end_ms).toBe(13_000);
    // Line 3: sung entirely before the voice: moved as a whole, squeezed to end before line 4.
    expect(fixed[2].start_ms).toBe(45_000);
    expect(fixed[2].sung_end_ms).toBeLessThanOrEqual(46_950);
    expect(fixed[2].words![0].start_ms).toBe(45_000);
    expect([fixed[1], fixed[3]]).toEqual([lines[1], lines[3]]);
    expect(earlyMs(fixed, VOICE).every((e) => e !== null && e <= 1_000)).toBe(true);
    expect(earlyMs(lines, VOICE)[0]).toBe(8_600); // what QA would report without the guard
  });

  it("only line 1 and lines after an instrumental gap (>= 4 s of silence) are checked", () => {
    // Line 2 starts 1.5 s before its voice, but only 1.5 s after line 1's singing: a verse, left alone.
    const verse: TimedLine[] = [
      { text: "One", start_ms: 12_000, end_ms: 15_000, isHook: false },
      { text: "Two", start_ms: 15_500, end_ms: 20_000, isHook: false },
    ];
    const voice: VoiceStretch[] = [
      [12_000, 15_000],
      [17_000, 19_000],
    ];
    expect(planGuard(verse, voice)).toEqual([]);
    expect(earlyMs(verse, voice)[1]).toBe(1_500); // QA still warns about it
  });

  it("never moves a line onto or past the next one; hand-placed lines stay", () => {
    const both: TimedLine[] = [
      { text: "One", start_ms: 3_000, end_ms: 6_000, isHook: false },
      { text: "Two", start_ms: 6_000, end_ms: 15_000, isHook: false },
      { text: "Three", start_ms: 15_000, end_ms: 20_000, isHook: false },
    ];
    expect(planGuard(both, VOICE).map((m) => m.index)).toEqual([1]);
    expect(planGuard(lines, VOICE, new Set([0])).map((m) => m.index)).toEqual([2]);
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
    writeFileSync(a.out, JSON.stringify({ version: 1, stem: "x-htdemucs-vocals.wav", stretches: VOICE }));
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
      const guarded = await applyVocalGuard(ws, sp, stored, { log: (m) => log.push(m), voiceMap });
      return { log, stored, guarded };
    };
    await run(); // the first alignment
    const { log, stored, guarded } = await run();
    expect(aligner.calls).toBe(1); // never aligned again for the guard
    expect(voice.calls).toBe(1); // the voice map is cached
    expect(log.some((l) => l.startsWith("lyrics: using the stored alignment"))).toBe(true);
    expect(log.filter((l) => l.startsWith("guard:"))).toEqual(["guard: line 1 moved from 0:03.2 to 0:11.8 (vocals start)", "guard: line 3 moved from 0:40.0 to 0:45.0 (vocals start)"]);
    expect(guarded.lines[0].start_ms).toBe(11_800);
    expect(guarded.guard?.moves.map((m) => [m.number, m.from_ms, m.to_ms])).toEqual([
      [1, 3_200, 11_800],
      [3, 40_000, 45_000],
    ]);
    expect(guarded.guard?.earlyMs.every((e) => e !== null && e <= 1_000)).toBe(true);
    // The stored alignment is never changed; the moves are recorded next to it.
    expect(readFileSync(stored.lrcFile, "utf8")).toBe(`${LRC}\n`);
    const dir = path.dirname(stored.lrcFile);
    const record = readdirSync(dir).find((f) => /^guard-[0-9a-f]{12}\.json$/.test(f))!;
    expect(JSON.parse(readFileSync(path.join(dir, record), "utf8")).moves).toHaveLength(2);
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
