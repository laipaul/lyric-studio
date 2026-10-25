import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegBin } from "@lyric/db";
import { afterAll, describe, expect, it } from "vitest";

import { DEFAULT_LYRIC_AREA, formatQa, lyricBox, parseFrameDetect, runQa, safeZoneProblem, type QaInput, type ShotProps } from "../src";
import { detectBadFrames, loadFontCatalog, measureLyrics, resolveFace } from "../src/node";

const shot = (start: number, duration: number, extra: Partial<ShotProps> = {}): ShotProps => ({
  start,
  duration,
  src: `clip-${start}.mp4`,
  clipStartFrame: 0,
  clipDurationFrames: 300,
  playbackRate: 1,
  holdLastFrame: false,
  ...extra,
});
const goodBox = lyricBox(1, 64, 500);

function input(overrides: Partial<QaInput> = {}): QaInput {
  const shots = [shot(0, 60), shot(60, 60), shot(120, 60), shot(180, 60)];
  return {
    props: { shots, lyrics: [], cinematicBars: false, durationInFrames: 240 },
    shotClips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4"],
    poolSize: 4,
    lyrics: [{ number: 1, text: "Hold on", confidence: 0.9, lines: 1, box: goodBox }],
    frames: { black: [], frozen: [] },
    ...overrides,
  };
}
const check = (report: ReturnType<typeof runQa>, name: string) => report.checks.find((c) => c.name === name)!;

describe("QA checks", () => {
  it("a clean variation passes every check", () => {
    const report = runQa(input());
    expect(report.status).toBe("PASS");
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(formatQa(report, "song - v1")).toContain("Summary: PASS");
  });

  it("Spotify Canvas: seamless loop, no audio and 3-8 s, each failing with a clear reason", () => {
    const canvas = { lastToFirst: 2, typicalStep: 3, hasAudio: false, seconds: 8, min: 3, max: 8 };
    const good = runQa(input({ lyrics: [], canvas }));
    for (const name of ["Seamless loop", "No audio", "Length 3-8 s"]) expect(check(good, name).ok).toBe(true);
    const bad = runQa(input({ lyrics: [], canvas: { ...canvas, lastToFirst: 40, hasAudio: true, seconds: 9.2 } }));
    expect(bad.status).not.toBe("PASS");
    expect(check(bad, "Seamless loop").details[0]).toContain("the jump from the last frame to the first is 40.0");
    expect(check(bad, "No audio").details[0]).toContain("audio track");
    expect(check(bad, "Length 3-8 s").details[0]).toBe("the loop is 9.20 s");
  });

  it("the logo must sit in a frame corner (fixed margin), never mid-frame", () => {
    const logo = (left: number, top: number) => ({ src: "logo.png", left, top, width: 86, height: 35, goneAt: null });
    const props = (l: ReturnType<typeof logo>) => ({ ...input().props, logo: l });
    expect(check(runQa(input({ props: props(logo(1080 - 32 - 86, 1920 - 32 - 35)) })), "Logo in a frame corner").ok).toBe(true);
    const mid = runQa(input({ props: props(logo(922, 1153)) }));
    expect(check(mid, "Logo in a frame corner").ok).toBe(false);
    expect(mid.status).not.toBe("PASS");
  });

  it("flags lyric lines below 0.5 confidence", () => {
    const report = runQa(input({ lyrics: [{ number: 7, text: "Low one", confidence: 0.42, lines: 1, box: goodBox }] }));
    expect(report.status).toBe("WARN");
    expect(check(report, "Lyric timing confidence").details).toEqual(['line 7 "Low one": confidence 0.42 (below 0.5); check its timing']);
  });

  it("flags a clip repeated within 3 shots (but not 4 shots later)", () => {
    const shots = Array.from({ length: 6 }, (_, i) => shot(i * 30, 30));
    const report = runQa(input({ props: { shots, lyrics: [], cinematicBars: false, durationInFrames: 180 }, shotClips: ["a", "b", "c", "a", "d", "b"] }));
    // "a" again at shot 4 (3 shots later): flagged; "b" again at shot 6 (4 shots later): fine.
    expect(check(report, "Clips repeated within 3 shots").details).toEqual(["shot 4 (0:03.0) repeats a from shot 1"]);
  });

  it("flags black and frozen frames, naming a held last frame as the cause", () => {
    const shots = [shot(0, 60), shot(60, 90, { holdLastFrame: true, playbackRate: 0.5 }), shot(150, 90)];
    const report = runQa(
      input({
        props: { shots, lyrics: [], cinematicBars: false, durationInFrames: 240 },
        shotClips: ["a.mp4", "short.mp4", "c.mp4"],
        frames: { black: [{ start_s: 0, end_s: 0.5 }], frozen: [{ start_s: 3.5, end_s: 5 }] },
      }),
    );
    expect(check(report, "Black or frozen frames").details).toEqual([
      "black 0:00.0-0:00.5 (0.5 s)",
      "frozen 0:03.5-0:05.0 (1.5 s) - shot 2 holds the last frame of short.mp4 (clip too short)",
    ]);
  });

  it("flags lyric lines shown on more than 2 lines", () => {
    const report = runQa(input({ lyrics: [{ number: 3, text: "A very long line", confidence: 0.9, lines: 3, box: goodBox }] }));
    expect(check(report, "Lyric lines over 2 lines").details).toEqual(['line 3 "A very long line" needs 3 lines; split it in lyrics.txt']);
  });

  it("flags shots under 0.8 s", () => {
    const shots = [shot(0, 60), shot(60, 23), shot(83, 157)];
    const report = runQa(input({ props: { shots, lyrics: [], cinematicBars: false, durationInFrames: 240 }, shotClips: ["a", "b", "c"] }));
    expect(check(report, "Shots under 0.8 s").details).toEqual(["shot 2 at 0:02.0 lasts 0.77 s"]);
  });

  it("flags lyrics outside the safe zone (right 12%, bottom 20%, cinematic bars)", () => {
    const wide = { left: 100, right: 960, top: 1150, bottom: 1250 };
    const low = { left: 100, right: 800, top: 1500, bottom: 1540 };
    expect(safeZoneProblem(goodBox, false)).toBeNull();
    expect(safeZoneProblem(wide, false)).toBe("reaches 960 px from the left (limit 950 px, right 12%)");
    expect(safeZoneProblem(low, false)).toBe("reaches 1540 px from the top (limit 1536 px, bottom 20%)");
    expect(safeZoneProblem({ left: 100, right: 800, top: 150, bottom: 300 }, true)).toBe("reaches into the top cinematic bar");
    const report = runQa(input({ lyrics: [{ number: 2, text: "Wide", confidence: 0.9, lines: 1, box: wide }] }));
    expect(check(report, "Lyrics inside the safe zone").ok).toBe(false);
  });

  it("measured lyric boxes of real lines stay inside the lyric area", () => {
    const catalog = loadFontCatalog(os.tmpdir());
    const main = resolveFace(catalog, "Montserrat", 900);
    const lines = [
      { text: "Hold on to me", startFrame: 0, endFrame: 30, number: 1, confidence: 0.9 },
      { text: "When the night won't let you sleep and the morning never comes again", startFrame: 30, endFrame: 60, number: 2, confidence: 0.9 },
    ];
    const measured = measureLyrics(lines, { main, hook: null, textCase: "upper", textSize: 72, animation: "pop" });
    expect(measured[0].lines).toBe(1);
    expect(measured[1].lines).toBeGreaterThanOrEqual(2);
    for (const m of measured) {
      expect(safeZoneProblem(m.box, true)).toBeNull();
      expect(m.box.left).toBeGreaterThanOrEqual(DEFAULT_LYRIC_AREA.left - 20); // pop overshoot of 2%
    }
  });

  it("reads FFmpeg's blackdetect and freezedetect messages", () => {
    const stderr = [
      "[blackdetect @ 0x1] black_start:0 black_end:1.2 black_duration:1.2",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 2.5",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 1.5",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 4",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 8",
    ].join("\n");
    expect(parseFrameDetect(stderr, 10)).toEqual({
      black: [{ start_s: 0, end_s: 1.2 }],
      frozen: [
        { start_s: 2.5, end_s: 4 },
        { start_s: 8, end_s: 10 }, // still frozen at the end
      ],
    });
  });
});

describe("frame check on a real video", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-qa-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds a black second and a frozen picture, and nothing in moving video", async () => {
    const file = path.join(dir, "bad.mp4");
    // 0-1 s moving test pattern, 1-2 s black, 2-3.5 s moving, 3.5-5.5 s one still frame, 5.5-6 s moving.
    execFileSync(ffmpegBin(), [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30:d=1",
      "-f", "lavfi", "-i", "color=c=black:s=270x480:r=30:d=1",
      "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30:d=1.5",
      "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30:d=2",
      "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30:d=0.5",
      "-filter_complex", "[3:v]trim=end_frame=1,loop=loop=59:size=1:start=0,setpts=N/30/TB[still];[0:v][1:v][2:v][still][4:v]concat=n=5:v=1:a=0,format=yuv420p[v]",
      "-map", "[v]", "-c:v", "libx264", file,
    ]);
    const found = await detectBadFrames(file, 6);
    expect(found.black).toHaveLength(1);
    expect(found.black[0].start_s).toBeCloseTo(1, 0);
    expect(found.black[0].end_s).toBeCloseTo(2, 0);
    // The black second is also a still picture; the still frame at 3.5-5.5 s must be found.
    const still = found.frozen.find((f) => f.start_s > 3 && f.start_s < 4);
    expect(still).toBeDefined();
    expect(still!.end_s).toBeGreaterThan(5);

    const good = path.join(dir, "good.mp4");
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30:d=4", "-pix_fmt", "yuv420p", good]);
    expect(await detectBadFrames(good, 4)).toEqual({ black: [], frozen: [] });
  });
});
