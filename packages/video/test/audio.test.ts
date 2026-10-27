// "Lyric Studio never alters the music": the audio plan (fades only where the music is cut, AAC 320 kbps
// at the master's own sample rate, nothing else) and QA "Audio matches the song" on real FFmpeg files.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin } from "@lyric/db";
import { afterAll, describe, expect, it } from "vitest";

import { audioPlan, runQa, type QaInput } from "../src";
import { compareAudio } from "../src/node";

describe("the audio plan", () => {
  const base = { songMs: 241_000, fadeInSeconds: 0.3, fadeOutSeconds: 0.5, sourceRate: 44_100, sampleRate: "source" as const };

  it("a whole-song video (YouTube) keeps the song's own start and end: no fades; the master's own rate", () => {
    const p = audioPlan({ ...base, startMs: 0, endMs: 241_000, fadeOutSeconds: 1.5 });
    expect(p).toMatchObject({ fadeInS: 0, fadeOutS: 0, sampleRate: 44_100, resampled: false, bitrate: "320k" });
    expect(p.note).toBe("audio: the song itself, the song's own start, the song's own end; AAC 320 kbps, 44.1 kHz (the master's own rate); no volume, loudness, EQ, compression or limiting");
  });

  it("a section (Reels): a fade only where the music is cut", () => {
    expect(audioPlan({ ...base, startMs: 34_200, endMs: 66_000, fadeOutSeconds: 0.12 })).toMatchObject({ fadeInS: 0.3, fadeOutS: 0.12 });
    expect(audioPlan({ ...base, startMs: 0, endMs: 45_000 })).toMatchObject({ fadeInS: 0, fadeOutS: 0.5 }); // from the song's start
    expect(audioPlan({ ...base, startMs: 200_000, endMs: 241_000 })).toMatchObject({ fadeInS: 0.3, fadeOutS: 0 }); // to the song's end
  });

  it("48 kHz only when platforms.json asks for it (then it says the master is resampled)", () => {
    const p = audioPlan({ ...base, startMs: 0, endMs: 241_000, sampleRate: 48_000 });
    expect([p.sampleRate, p.resampled]).toEqual([48_000, true]);
    expect(p.note).toContain("48 kHz (the master is 44.1 kHz: resampled as platforms.json asks)");
    expect(audioPlan({ ...base, startMs: 0, endMs: 241_000, sourceRate: 48_000 }).resampled).toBe(false);
  });
});

describe("QA: Audio matches the song", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-audio-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const ff = (...args: string[]) => execFileSync(ffmpegBin(), ["-y", "-v", "error", ...args]);
  // A "song": two tones whose loudness rises and falls every few seconds (so a shifted section is visible).
  const song = path.join(dir, "song.wav");
  ff("-f", "lavfi", "-i", "aevalsrc='(0.35+0.3*sin(2*PI*0.37*t))*sin(2*PI*220*t)+0.2*sin(2*PI*0.13*t)*sin(2*PI*330*t)|(0.35+0.3*sin(2*PI*0.37*t))*sin(2*PI*221*t)':s=44100:d=20", "-c:a", "pcm_s24le", song);
  // What the render does: the section 2-8 s, 0.3 s fade-in, 0.12 s fade-out, AAC 320 kbps, 44.1 kHz.
  const video = (name: string, filters: string, start = 2) => {
    const out = path.join(dir, name);
    ff("-ss", String(start), "-t", "6", "-i", song, "-af", `afade=t=in:d=0.3,afade=t=out:st=5.88:d=0.12${filters}`, "-c:a", "aac", "-b:a", "320k", "-ar", "44100", out);
    return out;
  };
  const section = { startMs: 2_000, endMs: 8_000 };
  const fades = { fadeInS: 0.3, fadeOutS: 0.12 };

  it("the song itself (cut, faded, AAC 320 kbps) matches: same length, level within 0.5 dB, same curve", async () => {
    const m = await compareAudio(video("ok.m4a", ""), song, section, fades);
    expect(Math.abs(m.actualS - m.expectedS)).toBeLessThan(0.1);
    expect(Math.abs(m.levelDiffDb)).toBeLessThan(0.1); // AAC 320 kbps changes the level by far less than 0.5 dB
    expect(m.envelopeDiffDb).toBeLessThan(0.3);
    const qa = runQa({ ...EMPTY, audioMatch: m });
    expect(qa.checks.find((c) => c.name === "Audio matches the song")).toEqual({ name: "Audio matches the song", ok: true, details: [] });
  });

  it("a level change (-1 dB), a different part of the song or a wrong length is a WARN", async () => {
    const quieter = await compareAudio(video("quiet.m4a", ",volume=-1dB"), song, section, fades);
    expect(quieter.levelDiffDb).toBeLessThan(-0.9);
    const shifted = await compareAudio(video("shifted.m4a", "", 4), song, section, fades);
    expect(shifted.envelopeDiffDb).toBeGreaterThan(1);
    const details = (m: Parameters<typeof runQa>[0]["audioMatch"]) => runQa({ ...EMPTY, audioMatch: m }).checks.find((c) => c.name === "Audio matches the song")!.details;
    expect(details(quieter)[0]).toMatch(/^the level differs from the song by -1\.\d\d dB \(allowed 0\.5 dB\)$/);
    expect(details(shifted).some((d) => d.startsWith("the loudness curve differs"))).toBe(true);
    expect(details({ expectedS: 6, actualS: 5.5, levelDiffDb: 0, envelopeDiffDb: 0 })).toEqual(["the audio lasts 5.50 s, the section 6.00 s"]);
  });
});

const EMPTY: QaInput = {
  props: { shots: [], lyrics: [], cinematicBars: false, durationInFrames: 180, format: undefined as never, safeZone: undefined as never, logo: null } as unknown as QaInput["props"],
  shotClips: [],
  poolSize: 1,
  lyrics: [],
  frames: null,
};
