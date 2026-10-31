// The vocal stem's timing is the base; the user's own corrections (hand-set starts, the Lyrics tab) go on
// top of it, and every line can go back to the stem's timing (↺ on a line, or "Reset all").
// Decided by the user on 31 Oct 2026: hand-set starts made before the song had a vocal stem were
// corrections of the old timing (the vocals the app separated), so they are reset once, as soon as the
// timing on the stem is there. The old hints.lrc is kept in .studio\replaced\ and Undo brings those
// starts back (they then count as made on the stem). Starts set while the stem is used always stay.
// Which voice the hand-set starts were made on is kept in <song folder>\.studio\hand-times.json.
// Taps (pnpm tap) in hints.lrc are never touched: only the "!" lines (hand-times.ts).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseHandTimes, stripHandTimes, withHandTimes } from "../hand-times";
import { keepReplaced } from "./project-settings";
import { voiceKey, type VoiceSource } from "./voice-source";

export type HandReset = { count: number; backup: string; at: string; why: "before-stem" | "all" };
export type HandTimesRecord = { voice: string; reset?: HandReset };

const recordFile = (hintsFile: string) => path.join(path.dirname(hintsFile), ".studio", "hand-times.json");
// "demucs" or the stem's key ("stem-<hash>-<offset>ms").
export const voiceTag = (v: VoiceSource | undefined) => (v?.kind === "stem" ? voiceKey(v) : "demucs");

export function readHandRecord(hintsFile: string): HandTimesRecord | null {
  try {
    const r = JSON.parse(readFileSync(recordFile(hintsFile), "utf8")) as HandTimesRecord;
    return typeof r.voice === "string" ? r : null;
  } catch {
    return null;
  }
}

export function writeHandRecord(hintsFile: string, record: HandTimesRecord): void {
  const file = recordFile(hintsFile);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

// Removes the hand-set starts of hints.lrc (the taps stay byte for byte); the old file is kept in
// .studio\replaced\. Returns how many were removed and the kept copy's name.
function dropHandTimes(hintsFile: string): { count: number; backup: string } | null {
  if (!existsSync(hintsFile)) return null;
  const content = readFileSync(hintsFile, "utf8");
  const count = parseHandTimes(content).length;
  if (!count) return null;
  const backup = keepReplaced(path.dirname(hintsFile), hintsFile, true);
  writeFileSync(hintsFile, stripHandTimes(content));
  return { count, backup: path.basename(backup) };
}

// Once, when the timing on the vocal stem is there: hand-set starts made before the stem are reset.
export function resetHandTimesMadeBeforeStem(hintsFile: string, voice: VoiceSource | undefined, log: (m: string) => void = () => {}, now = new Date()): number {
  if (voice?.kind !== "stem") return 0;
  const record = readHandRecord(hintsFile);
  if (record && record.voice !== "demucs") return 0; // made (or kept) on a stem
  const dropped = dropHandTimes(hintsFile);
  if (!dropped) return 0;
  writeHandRecord(hintsFile, { voice: voiceTag(voice), reset: { ...dropped, at: now.toISOString(), why: "before-stem" } });
  log(`lyrics: ${dropped.count} hand-set start${dropped.count === 1 ? " was" : "s were"} made before the vocal stem: back to the stem's timing (the old hints.lrc is kept in .studio\\replaced\\${dropped.backup}; Undo in the Lyrics tab brings them back)`);
  return dropped.count;
}

// "Reset all": every line back to the timing (the stem's, when it is used).
export function resetAllHandTimes(hintsFile: string, voice: VoiceSource | undefined, now = new Date()): number {
  const dropped = dropHandTimes(hintsFile);
  if (!dropped) return 0;
  writeHandRecord(hintsFile, { voice: voiceTag(voice), reset: { ...dropped, at: now.toISOString(), why: "all" } });
  return dropped.count;
}

// Undo of a reset: the hand-set starts of the kept copy come back (the taps of now stay); they then
// count as made on the current voice, so they are not reset again.
export function undoHandReset(hintsFile: string, voice: VoiceSource | undefined): number {
  const record = readHandRecord(hintsFile);
  if (!record?.reset) throw new Error("There is no reset to undo.");
  const backup = path.join(path.dirname(hintsFile), ".studio", "replaced", record.reset.backup);
  if (!existsSync(backup)) throw new Error("The kept copy of the hand-set starts is not there any more.");
  const times = parseHandTimes(readFileSync(backup, "utf8"));
  const current = existsSync(hintsFile) ? readFileSync(hintsFile, "utf8") : "";
  const next = withHandTimes(current, times);
  if (next !== current) {
    if (existsSync(hintsFile)) keepReplaced(path.dirname(hintsFile), hintsFile, true);
    writeFileSync(hintsFile, next);
  }
  writeHandRecord(hintsFile, { voice: voiceTag(voice) });
  return times.length;
}

// The notice is closed (the reset stays).
export function dismissHandReset(hintsFile: string): void {
  const record = readHandRecord(hintsFile);
  if (record?.reset) writeHandRecord(hintsFile, { voice: record.voice });
}

// Hand-set starts were saved on this voice (the Lyrics tab's Save).
export function noteHandTimesSaved(hintsFile: string, voice: VoiceSource | undefined): void {
  writeHandRecord(hintsFile, { voice: voiceTag(voice) });
}
