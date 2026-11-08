// Hand-set line starts (Lyrics tab) in hints.lrc: "[01:10.05]! #14 text". The aligner never sees them
// (the stored alignment is reused), pnpm make applies them, the vocal-start check leaves them alone.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyHandTimes, parseHandTimes, parseLrc, stripHandTimes, withHandTimes } from "../src";
import { applyHandSet, checkHints, ensureAlignment, findOrCreateSongProject, type AlignRunner } from "../src/node";
import { makeSong } from "./media-helpers";

const TAPS = "[00:12.40]A heart for two\n[00:25.00]Line two here\n[01:10.30]You had a heart for two\n";

describe("hand-set lines in hints.lrc", () => {
  it("are added, replaced and removed without touching the taps (byte for byte, with or without a last newline)", () => {
    for (const taps of [TAPS, TAPS.trimEnd(), "", TAPS.replace(/\n/g, "\r\n")]) {
      const one = withHandTimes(taps, [{ number: 3, ms: 70_050, text: "You had a heart for two" }]);
      expect(stripHandTimes(one)).toBe(taps);
      const two = withHandTimes(one, [
        { number: 3, ms: 70_100, text: "You had a heart for two" },
        { number: 1, ms: 21_000, text: "A heart for two" },
      ]);
      expect(stripHandTimes(two)).toBe(taps);
      expect(parseHandTimes(two)).toEqual([
        { number: 1, ms: 21_000, text: "A heart for two" },
        { number: 3, ms: 70_100, text: "You had a heart for two" },
      ]);
      expect(withHandTimes(two, [])).toBe(taps);
    }
    expect(withHandTimes(TAPS, [{ number: 3, ms: 70_050, text: "You had a heart for two" }])).toBe(`${TAPS}[01:10.05]! #3 You had a heart for two\n`);
    expect(stripHandTimes(TAPS)).toBe(TAPS); // no hand-set lines: unchanged
  });

  it("move the whole line (all words by the same amount); a changed line or a wrong order is ignored with a message", () => {
    const lines = parseLrc("[01:05.00]<01:05.00>The verse <01:06.00>line <01:08.40>\n[01:08.50]<01:08.50>You <01:08.80>had <01:09.10>a heart <01:10.00>\n[01:13.00]<01:13.00>Next <01:14.40>\n[01:20.00]", 100_000);
    const r = applyHandTimes(lines, [{ number: 2, ms: 70_000, text: "You had a heart" }]);
    expect(r.applied).toEqual([{ index: 1, fromMs: 68_500, toMs: 70_000 }]);
    expect(r.lines[1].words!.map((w) => w.start_ms)).toEqual([70_000, 70_300, 70_600]);
    expect(r.lines[1].sung_end_ms).toBe(71_500);
    expect(r.lines[0]).toEqual(lines[0]);
    // Squeezed before the next line.
    expect(applyHandTimes(lines, [{ number: 2, ms: 72_000, text: "" }]).lines[1].sung_end_ms).toBeLessThanOrEqual(72_950);
    const bad = applyHandTimes(lines, [
      { number: 2, ms: 70_000, text: "Other words" },
      { number: 3, ms: 60_000, text: "Next" },
      { number: 9, ms: 1_000, text: "Gone" },
    ]);
    expect(bad.applied).toEqual([]);
    expect(bad.problems).toEqual([
      'hand-set line 2 "Other words": line 2 is now "You had a heart"; ignored (set it again in the Lyrics tab)',
      'hand-set line 9 "Gone": there is no line 9 any more; ignored',
      'hand-set line 3 "Next" at 01:00.00: not between its neighbours; ignored',
    ]);
  });

  // Bug (8 Nov 2026, "Let My Love Carry You"): lines 28-31 with "Mmmm..." removed. Hold on was nudged to 3:22 but the next
  // line's automatic stamp is 3:18.26, so it was silently dropped as "passing its neighbour".
  const TAIL = parseLrc(
    "[03:12.98]<03:12.98>You'll <03:13.50>find <03:14.00>\n[03:14.76]<03:14.76>Hold <03:15.50>on <03:17.27>\n[03:18.26]<03:18.26>Floating <03:19.00>through <03:20.00>\n[03:21.00]\n",
    230_000,
  );

  it("a hand-set start after the next line's automatic stamp wins; the next line is pushed behind it (and shown as moved)", () => {
    const r = applyHandTimes(TAIL, [{ number: 2, ms: 202_000, text: "Hold on" }]);
    expect(r.skipped).toEqual([]);
    expect(r.applied).toEqual([{ index: 1, fromMs: 194_760, toMs: 202_000 }]);
    expect(r.lines[1].start_ms).toBe(202_000);
    expect(r.pushed).toEqual([{ index: 2, fromMs: 198_260, toMs: 204_610, because: 2 }]);
    expect(r.lines[2].start_ms).toBe(204_610); // behind Hold on's sung end (3:24.51) + 0.1 s
    expect(r.lines[2].start_ms).toBeGreaterThan(r.lines[1].sung_end_ms!);
    expect(r.lines[0]).toEqual(TAIL[0]);
  });

  it("both set by hand: each is checked against the other's FINAL start, both are kept", () => {
    const r = applyHandTimes(TAIL, [
      { number: 2, ms: 202_000, text: "Hold on" },
      { number: 3, ms: 205_060, text: "Floating through" },
    ]);
    expect(r.skipped).toEqual([]);
    expect(r.pushed).toEqual([]);
    expect(r.lines.map((l) => l.start_ms)).toEqual([192_980, 202_000, 205_060]);
    // Hold on set after Floating's hand-set start: the clash is named, in plain words.
    const bad = applyHandTimes(TAIL, [
      { number: 2, ms: 210_000, text: "Hold on" },
      { number: 3, ms: 205_060, text: "Floating through" },
    ]);
    expect(bad.skipped[0]).toMatchObject({ line: 2, with: 3 });
    expect(bad.skipped[0].why).toMatch(/not before line 3, which you set to 03:25\.06/);
  });

  it("follow their line by text when the numbers shifted; stale entries never override the current one", () => {
    // "Mmmm..." was line 2 and has been removed: the old entries for #3 Hold on and #4 Floating are now lines 2 and 3.
    const r = applyHandTimes(TAIL, [
      { number: 2, ms: 190_000, text: "Mmmm..." },
      { number: 3, ms: 202_000, text: "Hold on" },
      { number: 4, ms: 202_040, text: "Floating through" },
      { number: 3, ms: 205_060, text: "Floating through" },
    ]);
    expect(r.lines.map((l) => l.start_ms).slice(1)).toEqual([202_000, 205_060]);
    expect(r.stale).toEqual([{ number: 4, ms: 202_040, text: "Floating through" }]);
    expect(r.problems.some((p) => /"Mmmm\.\.\."/.test(p))).toBe(true);
  });

  it("are not counted as taps by the Assets tab's hints check", () => {
    const withHand = withHandTimes(TAPS, [{ number: 3, ms: 70_050, text: "You had a heart for two" }]);
    expect(checkHints(withHand, "A heart for two\nLine two here\nYou had a heart for two\n")).toMatchObject({ timed: 3, orphans: [], handSet: 1 });
  });
});

describe("pnpm make with hand-set lines", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lyric-hand-"));
  let ws: Workspace;
  let song: string;
  let lyrics: string;
  let hints: string;
  const seen: (string | undefined)[] = [];
  const aligner: AlignRunner = async (a) => {
    seen.push(a.hint ? readFileSync(a.hint, "utf8") : undefined);
    writeFileSync(a.out, "[00:12.40]<00:12.40>A <00:12.80>heart <00:13.40>\n[00:25.00]<00:25.00>Line <00:25.60>two <00:26.40>\n[01:08.50]<01:08.50>You <01:08.80>had <01:10.00>\n[01:20.00]\n");
    const lines = ["A heart", "Line two", "You had"].map((text, i) => ({ number: i + 1, text, is_hook: false, start_ms: [12_400, 25_000, 68_500][i], end_ms: [13_400, 26_400, 70_000][i], confidence: 0.9 }));
    writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines }));
  };
  beforeAll(() => {
    ws = openWorkspace(path.join(root, "workspace"));
    mkdirSync(path.join(root, "in"), { recursive: true });
    song = path.join(root, "in", "song.wav");
    makeSong(song, 2);
    lyrics = path.join(root, "in", "lyrics.txt");
    writeFileSync(lyrics, "A heart\nLine two\nYou had\n");
    hints = path.join(root, "in", "hints.lrc");
  });
  afterAll(() => {
    ws?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps the stored alignment (the aligner gets only the taps) and applies the hand-set start", async () => {
    const sp = await findOrCreateSongProject(ws, song);
    writeFileSync(hints, TAPS);
    const first = await ensureAlignment(ws, sp, { lyricsTxt: lyrics, hint: hints, durationMs: 90_000, align: aligner });
    writeFileSync(hints, withHandTimes(TAPS, [{ number: 3, ms: 70_000, text: "You had" }]));
    const log: string[] = [];
    const again = await ensureAlignment(ws, sp, { lyricsTxt: lyrics, hint: hints, durationMs: 90_000, align: aligner, log: (m) => log.push(m) });
    expect(seen).toEqual([TAPS]); // aligned once, with the taps only
    expect([again.source, again.lrcFile]).toEqual(["stored", first.lrcFile]);
    const hand = applyHandSet(again, hints, (m) => log.push(m));
    expect(hand.alignment.lines[2].start_ms).toBe(70_000);
    expect([...hand.skip]).toEqual([2]);
    expect(hand.alignment.handTimes).toEqual([{ number: 3, text: "You had", from_ms: 68_500, to_ms: 70_000 }]);
    expect(log).toContain("lyrics: line 3 set by hand: starts at 1:10.0 (was 1:08.5; Lyrics tab, hints.lrc)");
  });

  it("a hints.lrc with only hand-set lines counts as no hints (no re-alignment)", async () => {
    const other = path.join(root, "in", "song2.wav");
    makeSong(other, 3);
    const sp = await findOrCreateSongProject(ws, other);
    const before = seen.length;
    const plain = await ensureAlignment(ws, sp, { lyricsTxt: lyrics, durationMs: 90_000, align: aligner });
    const only = path.join(root, "in", "only-hand.lrc");
    writeFileSync(only, withHandTimes("", [{ number: 1, ms: 13_000, text: "A heart" }]));
    const withHand = await ensureAlignment(ws, sp, { lyricsTxt: lyrics, hint: only, durationMs: 90_000, align: aligner });
    expect(seen.length - before).toBe(1);
    expect([withHand.source, withHand.lrcFile, withHand.hint]).toEqual(["stored", plain.lrcFile, null]);
  });
});
