// Platform presets (presets/platforms.json), lyric placement from safe zones, source orientation,
// photo motion, the Reels loop ending and the clean LRC export.
import { readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@lyric/db";
import { describe, expect, it } from "vitest";

import {
  assignClips,
  autoSection,
  choosePlatforms,
  cleanLrc,
  getCutPoints,
  kenBurns,
  kenBurnsAt,
  lyricArea,
  lyricBox,
  mulberry32,
  parseLrc,
  parsePresets,
  safeZoneProblem,
  sectionWindow,
  sourceFit,
  sungEnd,
  type PlatformPreset,
  type SectionLine,
} from "../src";
import { loadPresets } from "../src/node";
import { grid } from "./helpers";

const FILE = path.join(REPO_ROOT, "presets", "platforms.json");
const fileJson = () => JSON.parse(readFileSync(FILE, "utf8"));
const presets = loadPresets(FILE);
const vertical = Object.values(presets).filter((p) => p.layout === "vertical");

describe("presets file", () => {
  it("has the standard preset and the platforms with the approved defaults", () => {
    expect(Object.keys(presets)).toEqual(["standard", "reels", "tiktok", "shorts", "youtube", "canvas"]);
    expect(presets.standard).toMatchObject({ width: 1080, height: 1920, variations: 6, length: { mode: "range", min: 45, max: 60, hardMax: 65 }, fadeOutSeconds: 0.5 });
    expect(presets.reels).toMatchObject({ variations: 3, anchor: "hook-first", loopEnding: true, length: { seconds: 30, tolerance: 0.15 }, safeZone: { top: 0.14, bottom: 0.35, right: 0.12 } });
    expect(presets.reels.fadeOutSeconds).toBeGreaterThanOrEqual(0.1);
    expect(presets.reels.fadeOutSeconds).toBeLessThanOrEqual(0.15);
    expect(presets.tiktok).toMatchObject({ variations: 3, length: { seconds: 25 }, safeZone: { top: 0.1, bottom: 0.3, right: 0.15 } });
    expect(presets.shorts).toMatchObject({ variations: 2, length: { seconds: 50 }, safeZone: { top: 0.12, bottom: 0.25, right: 0.15 } });
    expect(presets.youtube).toMatchObject({ width: 1920, height: 1080, aspect: "16:9", available: true });
    expect(presets.canvas).toMatchObject({ width: 1080, height: 1920, lyrics: false, audio: false, available: true });
    expect(presets.tiktok.anchor).toBe("hook-first");
    expect(presets.shorts.anchor).toBe("hook-first");
    expect(sectionWindow(presets.reels)).toEqual({ minMs: 25_500, maxMs: 34_500, hardMaxMs: 39_000, shortestMs: 22_500, targetMs: 30_000 });
  });

  it("is respected: edited values come through", () => {
    const json = fileJson();
    json.platforms.reels.variations = 5;
    json.platforms.reels.safeZone.bottom = 0.4;
    json.platforms.reels.length.seconds = 20;
    const edited = parsePresets(json);
    expect(edited.reels.variations).toBe(5);
    expect(sectionWindow(edited.reels)?.targetMs).toBe(20_000);
    const before = lyricArea(presets.reels, presets.reels.safeZone, presets.reels.lyricsAt);
    const after = lyricArea(edited.reels, edited.reels.safeZone, edited.reels.lyricsAt);
    expect(after.bottom).toBe(Math.round(1920 * 0.6));
    expect(after.centerY).toBeLessThan(before.centerY); // a taller caption area moves the lyrics up
  });

  it("names the platform and field of every mistake", () => {
    const json = fileJson();
    json.platforms.tiktok.width = 1081;
    json.platforms.shorts.aspect = "16:9";
    json.platforms.reels.safeZone.bottom = 0.9;
    json.platforms.reels.length = { mode: "target", seconds: 30, tolerance: 2 };
    expect(() => parsePresets(json)).toThrow(/platform "tiktok": "width"|width and height must be even/);
    try {
      parsePresets(json);
    } catch (error) {
      const text = (error as Error).message;
      expect(text).toContain('platform "shorts": aspect 16:9 does not match 1080x1920');
      expect(text).toContain('platform "reels": safeZone.bottom must be 0-0.45');
      expect(text).toContain('platform "reels": length.tolerance must be 0-0.5');
    }
    const noStandard = fileJson();
    delete noStandard.platforms.standard;
    expect(() => parsePresets(noStandard)).toThrow(/"standard" platform is missing/);
  });

  it("--platforms: names, all, unknown and not-yet-available platforms", () => {
    expect(choosePlatforms(undefined, presets)).toEqual({ names: ["standard"], skipped: [] });
    expect(choosePlatforms("reels, tiktok", presets).names).toEqual(["reels", "tiktok"]);
    expect(choosePlatforms("all", presets)).toEqual({ names: ["reels", "tiktok", "shorts", "youtube", "canvas"], skipped: [] });
    expect(() => choosePlatforms("reels,instagram", presets)).toThrow(/Unknown platform\(s\): instagram/);
    const later = { ...presets, canvas: { ...presets.canvas, available: false, note: "comes later" } };
    expect(choosePlatforms("all", later)).toEqual({ names: ["reels", "tiktok", "shorts", "youtube"], skipped: ["canvas"] });
    expect(() => choosePlatforms("canvas", later)).toThrow(/canvas: comes later/);
  });
});

describe("lyrics and safe zones", () => {
  it("lyrics sit in the usable area, slightly above its middle, computed from each platform's safe zones", () => {
    for (const p of vertical) {
      for (const bars of [false, true]) {
        const a = lyricArea(p, p.safeZone, p.lyricsAt, bars);
        const middle = (a.top + a.bottom) / 2;
        expect(a.centerY).toBeGreaterThan(a.top);
        expect(a.centerY).toBeLessThan(middle);
        expect(middle - a.centerY).toBeLessThan((a.bottom - a.top) * 0.1);
        expect(a.top).toBeGreaterThanOrEqual(Math.round(p.height * p.safeZone.top));
        expect(a.bottom).toBeLessThanOrEqual(Math.round(p.height * (1 - p.safeZone.bottom)));
      }
    }
    // Never one fixed percentage: each platform's own zones decide (reels 14%/35%, shorts 12%/25%).
    expect(lyricArea(presets.reels, presets.reels.safeZone, 0.45).centerY).toBe(Math.round(269 + 0.45 * (1248 - 269)));
    expect(lyricArea(presets.shorts, presets.shorts.safeZone, 0.45).centerY).toBe(Math.round(230 + 0.45 * (1440 - 230)));
  });

  it("no lyric block ever overlaps any platform's safe zone (largest text, 1-3 lines, full width, pop overshoot, bars)", () => {
    for (const p of vertical) {
      for (const bars of [false, true]) {
        const a = lyricArea(p, p.safeZone, p.lyricsAt, bars);
        for (const baseSize of [64, 72]) {
          const size = baseSize * p.textScale;
          for (const [lines, fontSize] of [[1, size], [2, size], [3, size * a.minScale]] as const) {
            const box = lyricBox(lines, fontSize, a.right - a.left, 1.02, a);
            expect(safeZoneProblem(box, bars, p, p.safeZone), `${p.name} ${lines} lines bars=${bars}`).toBeNull();
          }
        }
      }
    }
  });
});

describe("sources by orientation", () => {
  const v916 = { width: 1080, height: 1920 };
  const h169 = { width: 1920, height: 1080 };
  it("9:16 uses vertical (and square) sources; horizontal ones only at 2x the output height, else fill with --allow-fill", () => {
    expect(sourceFit(1080, 1920, v916, false)).toBe("cover");
    expect(sourceFit(720, 1280, v916, false)).toBe("cover");
    expect(sourceFit(1080, 1080, v916, false)).toBe("cover");
    expect(sourceFit(1920, 1080, v916, false)).toBeNull();
    expect(sourceFit(3840, 2160, v916, false)).toBeNull(); // 4K is not 2x 1920 high
    expect(sourceFit(7680, 4320, v916, false)).toBe("cover"); // 8K: enough pixels to crop
    expect(sourceFit(1920, 1080, v916, true)).toBe("fill");
  });
  it("16:9 uses horizontal sources", () => {
    expect(sourceFit(1920, 1080, h169, false)).toBe("cover");
    expect(sourceFit(1080, 1920, h169, false)).toBeNull();
    expect(sourceFit(1080, 1920, h169, true)).toBe("fill");
  });
});

describe("photo motion (Ken Burns)", () => {
  it("zooms between 1.00 and 1.12, pans gently, never shows an edge, and is the same for the same seed", () => {
    for (let seed = 0; seed < 500; seed++) {
      const m = kenBurns(mulberry32(seed));
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const at = kenBurnsAt(m, t);
        expect(at.zoom).toBeGreaterThanOrEqual(1);
        expect(at.zoom).toBeLessThanOrEqual(1.12);
        expect(Math.abs(at.x)).toBeLessThanOrEqual((at.zoom - 1) / 2 + 1e-9);
        expect(Math.abs(at.y)).toBeLessThanOrEqual((at.zoom - 1) / 2 + 1e-9);
      }
      expect(Math.abs(m.toZoom - m.fromZoom)).toBeGreaterThanOrEqual(0.06); // a visible move
    }
    expect(kenBurns(mulberry32(7))).toEqual(kenBurns(mulberry32(7)));
    const m = kenBurns(mulberry32(3));
    expect(kenBurnsAt(m, 0)).toEqual({ zoom: m.fromZoom, x: m.fromX, y: m.fromY });
    expect(kenBurnsAt(m, 1).zoom).toBeCloseTo(m.toZoom, 10);
  });

  it("photos fill any shot length at normal speed, starting at their first frame", () => {
    const beats = grid(120, 40, 0);
    const plan = getCutPoints(beats, { start_ms: 0, end_ms: 16_000 }, { cutRate: "0.5x" });
    const shots = assignClips(plan, [{ id: "p", duration_ms: 0, name: "photo.jpg", still: true }, { id: "v", duration_ms: 500, name: "v.mp4" }], 1);
    for (const s of shots.filter((x) => x.clip_id === "p")) expect([s.clip_start_frame, s.playback_rate, s.hold_last_frame]).toEqual([0, 1, false]);
  });
});

describe("Reels loop ending", () => {
  const beats = grid(120, 80, 0);
  const plan = getCutPoints(beats, { start_ms: 0, end_ms: 30_000 }, { cutRate: "1x" });
  const clips = ["01", "02", "03", "04", "05"].map((n) => ({ id: n, name: `${n}.mp4`, duration_ms: 20_000 }));

  for (const order of ["story", "shuffle"] as const) {
    it(`${order}: the last shot plays the first clip's frames right before shot 1, so the loop is seamless`, () => {
      const shots = assignClips(plan, clips, 4, { order, loopEnding: true });
      const first = shots[0];
      const last = shots[shots.length - 1];
      expect(last.loop).toBe(true);
      expect(last.clip_id).toBe(first.clip_id);
      expect(last.clip_start_frame + last.duration_frames).toBe(first.clip_start_frame);
      expect(last.playback_rate).toBe(1);
      expect(shots[shots.length - 2].clip_id).not.toBe(first.clip_id); // never the same clip twice in a row
    });
  }

  it("a first clip too short to continue gives an ordinary last shot", () => {
    const short = clips.map((c) => ({ ...c, duration_ms: 2100 }));
    const shots = assignClips(plan, short, 1, { order: "story", loopEnding: true });
    expect(shots[shots.length - 1].loop).toBeUndefined();
  });
});

describe("platform sections", () => {
  // 120 BPM, a bar every 2 s; lines every 4 s sung for 1.5 s, a 4-line chorus (hook = its first line).
  const beats = grid(120, 480, 0);
  const texts = Array.from({ length: 55 }, (_, k) => `Verse line ${k + 1}`);
  for (const k of [12, 28, 44]) ["Hold on to me", "Through the night", "We will rise", "Into the light"].forEach((t, j) => (texts[k + j] = t));
  const lines: SectionLine[] = texts.map((text, k) => ({
    text,
    start_ms: 500 + 4000 * k,
    end_ms: 500 + 4000 * (k + 1),
    sung_end_ms: 2000 + 4000 * k,
    isHook: text === "Hold on to me",
  }));
  const singing = (t: number) => lines.filter((l) => l.start_ms - 250 < t && t < sungEnd(l));
  const isBar = (t: number) => beats.some((b) => b.is_downbeat && b.time_ms === t);

  for (const name of ["reels", "tiktok", "shorts", "standard"]) {
    it(`${name}: length within its window, on bars, never cutting a line`, () => {
      const p: PlatformPreset = presets[name];
      const w = sectionWindow(p)!;
      const s = autoSection(lines, beats, {
        durationMs: 240_000,
        minMs: w.minMs,
        maxMs: w.maxMs,
        hardMaxMs: w.hardMaxMs,
        shortestMs: w.shortestMs,
        ...(p.length.mode === "target" ? { targetMs: w.targetMs } : {}),
        anchorMode: p.anchor,
      });
      expect(s.end_ms - s.start_ms).toBeGreaterThanOrEqual(w.minMs);
      expect(s.end_ms - s.start_ms).toBeLessThanOrEqual(w.maxMs);
      expect(isBar(s.start_ms) && isBar(s.end_ms)).toBe(true);
      expect(singing(s.start_ms)).toEqual([]);
      expect(singing(s.end_ms)).toEqual([]);
      expect(s.warnings).toEqual([]);
      if (p.length.mode === "target") expect(Math.abs(s.end_ms - s.start_ms - w.targetMs)).toBeLessThanOrEqual(2000); // nearest bar to the target
      const hook = lines[12];
      expect(s.start_ms).toBeLessThanOrEqual(hook.start_ms - 250); // the first hook is in the section
      if (p.anchor === "hook-first") {
        // Hook-first: at most one bar before the first hook line, so it is heard within ~2.5 s.
        expect(hook.start_ms - s.start_ms).toBeGreaterThanOrEqual(0);
        expect(hook.start_ms - s.start_ms).toBeLessThanOrEqual(2500);
        expect(s.reason).toContain("at most one bar before the first hook line (line 13");
      }
    });
  }
});

describe("clean LRC for lyric services", () => {
  it("line stamps with the lyrics offset, pauses and the end; no word tags or hook markers", () => {
    const lrc = "[00:10.00]* <00:10.00>Hold <00:10.40>on\n[00:12.00]<00:12.00>Second line\n[00:14.00]\n[00:20.00]After the break\n[00:23.00]\n";
    const out = cleanLrc(parseLrc(lrc, 60_000), { title: "My Song", artist: "Life Lyrics", durationMs: 185_400, offsetMs: -150 });
    expect(out.split("\n")).toEqual([
      "[ti:My Song]",
      "[ar:Life Lyrics]",
      "[length:03:05]",
      "[re:Lyric Studio]",
      "[00:09.85]Hold on",
      "[00:11.85]Second line",
      "[00:13.85]",
      "[00:19.85]After the break",
      "[00:22.85]",
      "",
    ]);
  });
});

describe("Reels loop ending and repeats", () => {
  it("the loop clip is kept out of the 3 shots before the loop shot (story order cycling)", () => {
    const beats = grid(120, 80, 0);
    const plan = getCutPoints(beats, { start_ms: 0, end_ms: 32_000 }, { cutRate: "1x" });
    const clips = ["01", "02", "03", "04", "05", "06"].map((n) => ({ id: n, name: `${n}.mp4`, duration_ms: 20_000 }));
    for (const order of ["story", "shuffle"] as const) {
      for (let seed = 1; seed < 20; seed++) {
        const ids = assignClips(plan, clips, seed, { order, loopEnding: true }).map((s) => s.clip_id);
        const last = ids.length - 1;
        expect(ids[last]).toBe(ids[0]);
        expect(ids.slice(last - 3, last)).not.toContain(ids[0]);
      }
    }
  });
});
