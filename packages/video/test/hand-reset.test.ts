// The 31 Oct notice "N starts you set by hand before the vocal stem was added were reset": once the user closes it, it
// stays closed (the close is kept in .studio\hand-times.json), and the reset is not done again (Prepare, 11 Nov 2026).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { withHandTimes } from "../src";
import { dismissHandReset, readHandRecord, resetHandTimesMadeBeforeStem, writeHandRecord } from "../src/node/hand-reset";
import type { VoiceSource } from "../src/node/voice-source";

const dir = mkdtempSync(path.join(os.tmpdir(), "hand-reset-"));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
const STEM: VoiceSource = { kind: "stem", label: "vocal stem", stemHash: "a".repeat(64), offsetMs: 0 };

describe("the hand-set reset notice", () => {
  it("stays closed once closed, and the reset is not done again", () => {
    const song = path.join(dir, "song");
    mkdirSync(song, { recursive: true });
    const hints = path.join(song, "hints.lrc");
    writeFileSync(hints, withHandTimes("[00:10.00]Line one\n", [{ number: 2, ms: 20_000, text: "Line two" }]));
    writeHandRecord(hints, { voice: "demucs" }); // set by hand on the separated vocals

    expect(resetHandTimesMadeBeforeStem(hints, STEM)).toBe(1);
    expect(readHandRecord(hints)?.reset?.why).toBe("before-stem"); // the notice shows

    dismissHandReset(hints);
    expect(readHandRecord(hints)?.reset).toBeUndefined(); // closed
    // The next lyric timing, Save or page load: nothing is reset again, so the notice does not come back.
    writeFileSync(hints, withHandTimes("[00:10.00]Line one\n", [{ number: 2, ms: 21_000, text: "Line two" }]));
    expect(resetHandTimesMadeBeforeStem(hints, STEM)).toBe(0);
    expect(readHandRecord(hints)?.reset).toBeUndefined();
  });
});
