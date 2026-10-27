// "Checked by ear" (Lyrics tab): the user listened to a line the aligner was unsure about (low
// confidence) or the vocal-start check flagged, and its timing is right. It clears that line's timing
// WARNs in QA ("line 40 checked by ear") as long as nothing changed: the same stored alignment, the
// same words and the same start (a nudge, a vocal-start move or a new alignment makes it lapse).
// Kept with the song in .studio\lyrics\checked-by-ear.json. Pure.
import { normalizeLyric, type TimedLine } from "./lrc";

export type EarCheck = { number: number; text: string; lrc: string; start_ms: number; at: string }; // lrc: the alignment's hash

export const CHECKED_BY_EAR_FILE = "checked-by-ear.json";

export function checkedStill(check: EarCheck, lrcHash: string, line: TimedLine | undefined): boolean {
  return !!line && check.lrc === lrcHash && normalizeLyric(check.text) === normalizeLyric(line.text) && Math.abs(check.start_ms - line.start_ms) <= 1;
}

// The lines (0-based) whose "checked by ear" still holds.
export function checkedByEar(checks: readonly EarCheck[], lrcHash: string, lines: readonly TimedLine[]): Set<number> {
  return new Set(checks.filter((c) => checkedStill(c, lrcHash, lines[c.number - 1])).map((c) => c.number - 1));
}
