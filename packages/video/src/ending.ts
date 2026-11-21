// Automatic endings for the loop platforms (Reels, TikTok, Shorts). The app chooses how the music ends,
// from the music at the end of the section (guiding principle: a technical decision, never the user's):
//   loop      a tight loop: the music is cut on the bar with the platform's short fade (Reels 0.12 s), only
//             when the last bar flows straight back into the first (whole bars, level within 3 dB, a key
//             that fits both bars);
//   fade      a soft fade over the room after the last sung word, starting at the earliest halfway into a
//             held last note (at least 0.6 s long; never on the words themselves) (at most one bar, at most 3 s), when the
//             end would not flow back (e.g. a loud chorus into a quiet pickup): the loop restarts the song
//             gently instead of with a sudden drop;
//   ring-out  when there is little room after the last word: the last chord sounds one more bar (the next
//             detected bar line, still whole bars, no sung line in it, inside the platform's length) and
//             fades over that bar;
//   song-end  the section ends at the song's own end: no fade (the song's own ending).
// Whole bars are kept, a sung line is never cut, the music itself is never changed (only the fade curve
// where the section cuts it). The recipe's "ending" (song.json, per platform) overrides "auto".
// Pure: the song's samples are passed in.
import { loopFit, loopLevels, barMsAt, LOOP_LEVEL_JUMP_DB, type LoopAudio, type LoopLine } from "./loop";

export const ENDING_VALUES = ["auto", "loop", "fade", "ring-out"] as const;
export type EndingChoice = (typeof ENDING_VALUES)[number];
export type EndingKind = "loop" | "fade" | "ring-out" | "song-end";

export const ENDING_FADE_MAX_MS = 3000; // the longest fade-out
export const ENDING_FADE_MIN_MS = 300; // a fade shorter than this is a cut, not a fade
const ROOM_FOR_FADE = 0.75; // of a bar: room after the last word for a soft fade (else ring out)
const HELD_NOTE_MS = 600;
const FRAME_MS = 34; // one video frame at 30 fps (rounded up)
const LEVEL_MARGIN_DB = 0.75; // a tight loop only with a level jump clearly under the 3 dB limit // a last word this long is a held note: the fade may start halfway into it
const EDGE_MS = 50;

export type Ending = {
  kind: EndingKind;
  requested: EndingChoice;
  endMs: number; // the section's end (later than the chosen end for a ring-out)
  fadeOutS: number; // the fade where the music is cut (0 at the song's own end)
  text: string; // plain words, for the Storyboard header, QA and pnpm make
  note: string | null; // when the requested ending was not possible
};

// The lights-dim ending (21 Nov 2026, Paul: "fading with the studio light going to dim"): a fade or ring-out also
// takes the picture to black over the same frames as the music, so the light and the sound go out together. A loop
// (it has to flow back into the start) and the song's own end (no fade) keep their picture.
export const endDimSeconds = (e: Ending | null): number => (e && (e.kind === "fade" || e.kind === "ring-out") ? e.fadeOutS : 0);

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const round2 = (ms: number) => Math.round(ms / 10) / 100;

export function chooseEnding(o: {
  requested: EndingChoice;
  startMs: number;
  endMs: number;
  songMs: number;
  bpm: number;
  downbeats: readonly number[]; // sorted, song ms
  lines: readonly LoopLine[]; // song time
  audio: LoopAudio | null;
  loopFadeS: number; // the platform's fade for a tight loop (platforms.json fadeOutSeconds)
  maxEndMs: number; // the latest end the platform's length allows (= endMs: the end may not move)
}): Ending {
  const base = { requested: o.requested, note: null as string | null };
  if (o.endMs >= o.songMs - EDGE_MS) return { ...base, kind: "song-end", endMs: o.endMs, fadeOutS: 0, text: "Ending: the song's own ending (no fade)." };

  // The room after the last sung word and the bar at the end.
  const sungBefore = o.lines.filter((l) => l.sungStartMs < o.endMs).map((l) => Math.min(l.sungEndMs, o.endMs));
  const lastSung = sungBefore.length ? Math.max(...sungBefore) : o.startMs;
  const room = Math.max(0, o.endMs - lastSung);
  // A held last note (>= 0.6 s): the fade may start halfway into it (its tail, not the word itself).
  const lastLine = o.lines.filter((l) => l.sungStartMs < o.endMs).reduce<LoopLine | null>((a, l) => (!a || l.sungEndMs > a.sungEndMs ? l : a), null);
  const held = lastLine?.lastWordStartMs !== undefined ? Math.min(lastLine.sungEndMs, o.endMs) - lastLine.lastWordStartMs : 0;
  const tail = held >= HELD_NOTE_MS ? Math.round(held / 2) : 0;
  const next = o.downbeats.find((d) => d > o.endMs + EDGE_MS);
  const prev = [...o.downbeats].reverse().find((d) => d < o.endMs - EDGE_MS);
  const barMs = next !== undefined ? next - o.endMs : prev !== undefined ? o.endMs - prev : barMsAt(o.bpm);
  const nextFree = next !== undefined && !o.lines.some((l) => l.sungStartMs < next && l.sungEndMs > o.endMs + EDGE_MS);
  const ringEnd = next !== undefined && nextFree && next <= o.maxEndMs + EDGE_MS ? Math.min(next, o.songMs) : null;

  const loop = (why: string): Ending => ({ ...base, kind: "loop", endMs: o.endMs, fadeOutS: o.loopFadeS, text: `Ending: a tight loop on the bar — ${why}.` });
  const fade = (why: string): Ending => {
    const ms = Math.max(ENDING_FADE_MIN_MS, Math.min(room + tail, barMs, ENDING_FADE_MAX_MS));
    const inNote = ms > room + 20 && tail > 0;
    return { ...base, kind: "fade", endMs: o.endMs, fadeOutS: round2(ms), text: `Ending: a soft fade over the last ${s1(ms)}${inNote ? ", from the tail of the last held note" : ""} — ${why}, so the loop starts the song again gently.` };
  };
  const ringOut = (why: string): Ending => {
    const end = ringEnd!;
    if (end >= o.songMs - EDGE_MS) return { ...base, kind: "song-end", endMs: o.songMs, fadeOutS: 0, text: "Ending: the last chord rings out to the song's own ending (no fade)." };
    const ms = Math.min(end - o.endMs, ENDING_FADE_MAX_MS);
    return { ...base, kind: "ring-out", endMs: end, fadeOutS: round2(ms), text: `Ending: the last chord rings out one more bar and fades over ${s1(ms)} — ${why}, so the loop starts the song again gently.` };
  };

  // Why a tight loop does or does not work here.
  const fit = o.audio ? loopFit(o.audio, o.bpm, o.startMs, o.endMs, o.downbeats) : null;
  const lv = o.audio ? loopLevels(o.audio, o.startMs, o.endMs) : null;
  // The level jump as the rendered video may have it: the section's start and end land on whole frames,
  // and a few ms move the 100 ms windows on a transient. The worst jump within a frame either side, with
  // a safety margin, decides (so QA, which measures the frames, agrees with the choice).
  const worstJump = o.audio
    ? Math.max(...[-FRAME_MS, 0, FRAME_MS].flatMap((a) => [-FRAME_MS, 0, FRAME_MS].map((b) => loopLevels(o.audio!, o.startMs + a, o.endMs + b).jump)))
    : 0;
  const levelSafe = worstJump <= LOOP_LEVEL_JUMP_DB - LEVEL_MARGIN_DB;
  const why = !lv
    ? "the song could not be measured"
    : !levelSafe
      ? lv.jump > LOOP_LEVEL_JUMP_DB
        ? lv.last > lv.first
          ? "the end is loud and the start quiet"
          : "the end is quiet and the start loud"
        : `the level at the loop point is close to the limit (up to ${worstJump.toFixed(1)} dB)`
      : lv.jump > LOOP_LEVEL_JUMP_DB
      ? lv.last > lv.first
        ? "the end is loud and the start quiet"
        : "the end is quiet and the start loud"
      : fit && !fit.ok && /clash/.test(fit.text)
        ? "the last and the first bar are in different keys"
        : "the end does not flow straight back into the start";
  const soft = () => (room + tail >= ROOM_FOR_FADE * barMs || !ringEnd ? fade(why) : ringOut(`there is little room after the last word, and ${why}`));

  if (o.requested === "loop") return loop(fit?.ok ? "the last bar flows straight back into the first" : `as set in the recipe (${why})`);
  if (o.requested === "fade") return fade(`as set in the recipe`);
  if (o.requested === "ring-out") {
    if (ringEnd) return ringOut("as set in the recipe");
    const r = fade("a ring-out does not fit here");
    return { ...r, note: next === undefined ? "ring-out: there is no bar after the end" : !nextFree ? "ring-out: the next bar is sung" : "ring-out: one more bar would make the video longer than the platform allows" };
  }
  // auto
  if (!o.audio) return loop("the song could not be measured, so the platform's own ending is kept");
  if (fit?.ok && levelSafe) return loop("the last bar flows straight back into the first (same level, same key)");
  return soft();
}
