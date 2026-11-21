// Automatic endings (Reels, TikTok, Shorts): a tight loop only when the end flows back into the start,
// else a soft fade after the last sung word, or a ring-out of one more bar when there is little room.
import { describe, expect, it } from "vitest";

import { chooseEnding, type LoopAudio, type LoopLine } from "../src";
import { ringOutLimitMs } from "../src/node/make";

const RATE = 16_000;
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
// A 60 s C major chord; `loud` raises the level of a stretch (ms).
function song(loud: { fromMs: number; toMs: number; gain: number } | null = null): LoopAudio {
  const samples = new Float32Array(RATE * 60);
  for (const n of [48, 60, 64, 67]) {
    const w = (2 * Math.PI * midi(n)) / RATE;
    for (let i = 0; i < samples.length; i++) {
      const ms = (i / RATE) * 1000;
      const g = loud && ms >= loud.fromMs && ms < loud.toMs ? loud.gain : 1;
      samples[i] += 0.05 * g * Math.sin(w * i);
    }
  }
  return { rate: RATE, samples };
}
// 120 BPM: a bar is 2 s, bar lines at 0:00.5, 0:02.5, ... The section 0:10.5-0:40.5 is 15 bars.
const downbeats = Array.from({ length: 30 }, (_, i) => 500 + i * 2000);
const lines = (lastEnd: number): LoopLine[] => [
  { number: 1, text: "Verse line", sungStartMs: 11_000, sungEndMs: 20_000 },
  { number: 2, text: "This is the house that my heart built", sungStartMs: 22_000, sungEndMs: lastEnd },
];
const base = { requested: "auto" as const, startMs: 10_500, endMs: 40_500, songMs: 60_000, bpm: 120, downbeats, loopFadeS: 0.12, maxEndMs: 50_000 };
const flat = song();
const loudEnd = song({ fromMs: 36_500, toMs: 41_000, gain: 4 }); // the chorus is loud at the end, the start quiet

describe("automatic endings", () => {
  it("a tight loop when the last bar flows straight back into the first", () => {
    const e = chooseEnding({ ...base, lines: lines(38_000), audio: flat });
    expect(e).toMatchObject({ kind: "loop", endMs: 40_500, fadeOutS: 0.12 });
    expect(e.text).toContain("tight loop");
  });
  it("a loud end into a quiet start with room after the last word: a soft fade over that room (at most a bar)", () => {
    const e = chooseEnding({ ...base, lines: lines(38_000), audio: loudEnd });
    expect(e).toMatchObject({ kind: "fade", endMs: 40_500, fadeOutS: 2 }); // 2.5 s of room, one bar = 2 s
    expect(e.text).toBe("Ending: a soft fade over the last 2.0 s — the end is loud and the start quiet, so the loop starts the song again gently.");
  });
  it("little room after the last word: the last chord rings out one more bar (whole bars kept) and fades", () => {
    const e = chooseEnding({ ...base, lines: lines(40_200), audio: loudEnd });
    expect(e).toMatchObject({ kind: "ring-out", endMs: 42_500, fadeOutS: 2 });
    expect((e.endMs - base.startMs) % 2000).toBe(0);
    expect(e.text).toContain("rings out one more bar");
  });
  it("no ring-out past the platform's length or into a sung line: a short fade instead", () => {
    expect(chooseEnding({ ...base, lines: lines(40_200), audio: loudEnd, maxEndMs: 40_500 })).toMatchObject({ kind: "fade", endMs: 40_500, fadeOutS: 0.3 });
    const sung = [...lines(40_200), { number: 3, text: "Next line", sungStartMs: 41_500, sungEndMs: 44_000 }];
    expect(chooseEnding({ ...base, lines: sung, audio: loudEnd })).toMatchObject({ kind: "fade", endMs: 40_500 });
  });
  it("no room and no ring-out: the fade takes the tail of the last word (half a bar, at most 1 s), never an earlier word", () => {
    const word = (lastWordStartMs: number): LoopLine[] => [lines(40_200)[0], { ...lines(40_200)[1], lastWordStartMs }];
    // A held last note (1.2 s): 1.0 s of fade (the cap), from inside the note.
    const held = chooseEnding({ ...base, lines: word(39_000), audio: loudEnd, maxEndMs: 40_500 });
    expect(held).toMatchObject({ kind: "fade", endMs: 40_500, fadeOutS: 1 });
    expect(held.text).toContain("from the tail of the last held note");
    // A short last word (0.3 s): the 0.3 s of room and that word only, 0.6 s, not the word before.
    expect(chooseEnding({ ...base, lines: word(39_900), audio: loudEnd, maxEndMs: 40_500 })).toMatchObject({ kind: "fade", fadeOutS: 0.6 });
  });
  it("a part chosen by hand may ring out one more bar too, within the platform's length (never past it)", () => {
    // Reels: 0:48.9 - 2:27.7 chosen by hand (98.8 s), the length allows up to 120 s.
    expect(ringOutLimitMs({ start_ms: 48_900, end_ms: 147_700 }, { hardMaxMs: 120_000 })).toBe(168_900);
    expect(ringOutLimitMs({ start_ms: 0, end_ms: 130_000 }, { hardMaxMs: 120_000 })).toBe(130_000); // already longer: no bar added
    expect(ringOutLimitMs({ start_ms: 0, end_ms: 30_000 }, null)).toBe(30_000);
  });
  it("the song's own end: no fade", () => {
    expect(chooseEnding({ ...base, endMs: 60_000, lines: lines(38_000), audio: loudEnd })).toMatchObject({ kind: "song-end", fadeOutS: 0 });
  });
  it("the recipe can ask for an ending; a ring-out that does not fit becomes a fade, with a note", () => {
    expect(chooseEnding({ ...base, requested: "loop", lines: lines(38_000), audio: loudEnd })).toMatchObject({ kind: "loop", fadeOutS: 0.12 });
    expect(chooseEnding({ ...base, requested: "fade", lines: lines(38_000), audio: flat })).toMatchObject({ kind: "fade", fadeOutS: 2 });
    expect(chooseEnding({ ...base, requested: "ring-out", lines: lines(38_000), audio: flat })).toMatchObject({ kind: "ring-out", endMs: 42_500 });
    const no = chooseEnding({ ...base, requested: "ring-out", lines: lines(38_000), audio: flat, maxEndMs: 40_500 });
    expect(no).toMatchObject({ kind: "fade", note: "ring-out: one more bar would make the video longer than the platform allows" });
  });
  it("without the song's samples the platform's own ending is kept", () => {
    expect(chooseEnding({ ...base, lines: lines(38_000), audio: null })).toMatchObject({ kind: "loop", fadeOutS: 0.12 });
  });
});

describe("loop suggestions keep the payoff line", () => {
  it("never suggests an end that drops a chorus / title line the plan has", async () => {
    const { loopSuggestions } = await import("../src");
    const ls: LoopLine[] = [
      { number: 1, text: "Verse line", sungStartMs: 11_000, sungEndMs: 19_800 },
      { number: 2, text: "This is the house that my heart built", sungStartMs: 22_000, sungEndMs: 38_000 },
    ];
    const o = { audio: flat, bpm: 120, startMs: 10_500, downbeats, lines: ls, targetMs: 20_000, durationMs: 60_000 };
    expect(loopSuggestions(o).map((x) => x.endMs)).toContain(20_500); // ends after the verse line, before the title line
    expect(loopSuggestions({ ...o, keep: [ls[1]] }).map((x) => x.endMs)).not.toContain(20_500);
    expect(loopSuggestions({ ...o, keep: [ls[1]] }).every((x) => x.endMs >= 38_000)).toBe(true);
  });
});

describe('QA "Loop flows" with the chosen ending', () => {
  it("a soft fade turns the level jump into a note, not a WARN", async () => {
    const { loopFlows } = await import("../src");
    const o = { lengthMs: 30_000, bpm: 120, downbeats, startMs: 10_500, endMs: 40_500, lines: lines(38_000), audio: loudEnd, firstClip: "a.mp4", lastClip: "b.mp4", shots: 8, continues: false };
    expect(loopFlows(o).points.find((p) => p.point === "sound")!.ok).toBe(false);
    const ending = chooseEnding({ ...base, lines: lines(38_000), audio: loudEnd });
    const r = loopFlows({ ...o, ending });
    const sound = r.points.find((p) => p.point === "sound")!;
    expect(sound.ok).toBe(true);
    expect(sound.detail).toMatch(/^level jump \d+\.\d dB, softened by a 2\.0 s fade: the loop starts the song again gently$/);
    expect(r.ending).toMatchObject({ kind: "fade", fade_out_s: 2 });
    expect(loopFlows({ ...o, ending: { ...ending, kind: "loop", fadeOutS: 0.12 } }).points.find((p) => p.point === "sound")!.ok).toBe(false);
    // A 0.3 s fade does not soften it: the music stops dead. A WARN that names the creative fix.
    const abrupt = loopFlows({ ...o, ending: { ...ending, fadeOutS: 0.3 } }).points.find((p) => p.point === "sound")!;
    expect(abrupt.ok).toBe(false);
    expect(abrupt.detail).toMatch(/the music stops in 0\.3 s: end the part a bar after the last sung word, or let the app choose it \(Automatic\)$/);
  });
});

describe("the title line", () => {
  it("is found with words in between, accents and case ignored", async () => {
    const { isTitleLine } = await import("../src/node/make");
    expect(isTitleLine("This is the house that my heart built", "The House My Heart Built")).toBe(true);
    expect(isTitleLine("With aching beams and hopeless sills", "The House My Heart Built")).toBe(false);
    expect(isTitleLine("Où es-tu, mon cœur ?", "Où es-tu")).toBe(true);
  });
});

describe("a tight loop needs a clear margin", () => {
  it("a level jump just under the limit (that the video's frames may push over it) gets a soft ending", () => {
    const close = song({ fromMs: 39_000, toMs: 41_000, gain: 1.38 }); // ~2.8 dB louder in the last bar
    const e = chooseEnding({ ...base, lines: lines(38_000), audio: close });
    expect(e.kind).toBe("fade");
    expect(e.text).toMatch(/close to the limit|loud and the start quiet/);
  });
});

describe("loop suggestions", () => {
  it("never suggest the plan's own end again", async () => {
    const { loopSuggestions } = await import("../src");
    const o = { audio: flat, bpm: 120, startMs: 10_500, downbeats, lines: lines(38_000), targetMs: 30_000, durationMs: 60_000 };
    expect(loopSuggestions(o).map((x) => x.endMs)).toContain(38_500); // the first bar after the last line
    expect(loopSuggestions({ ...o, currentEndMs: 38_500 }).map((x) => x.endMs)).not.toContain(38_500);
  });
});
