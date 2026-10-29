// Step 5g.2: YouTube helpers (sections for stills, stills.txt, crossfades, end screen, glow, .srt,
// layout fallback) and short-form ends on beats.
import { describe, expect, it } from "vitest";

import {
  COVER_CENTRE_X,
  COVER_DRIFT,
  COVER_HEIGHT_SHARE,
  COVER_NEXT_LINE_SCALE,
  COVER_TEXT_SCALE,
  MOOD_COLOURS,
  assignStills,
  autoSection,
  coverDrift,
  coverMotionAt,
  coverSide,
  logoOpacity,
  logoCornerProblem,
  logoPlacement,
  moodAt,
  moodSegments,
  mulberry32,
  beatPulse,
  END_SCREEN_GLIDE_FRAMES,
  endScreenAreaAt,
  endScreenLayout,
  endScreenText,
  lyricArea,
  lyricBox,
  lyricSections,
  parsePresets,
  parseStills,
  sectionWindow,
  stillOpacity,
  stillTimings,
  toSrt,
  visibleStills,
  type SectionLine,
} from "../src";
import { chooseLayout, loadPresets, youtubeLyricSafeZone } from "../src/node";
import { grid } from "./helpers";

const presets = loadPresets();
const yt = presets.youtube;
const line = (text: string, start: number, end: number, isHook = false) => ({ text, start_ms: start, end_ms: end, isHook });

describe("YouTube preset", () => {
  it("is available: 1920x1080, full song, 1 video, cover layout by default, end screen 20 s bottom right", () => {
    expect(yt).toMatchObject({ width: 1920, height: 1080, available: true, variations: 1, length: { mode: "full" } });
    expect(yt.youtube).toMatchObject({ defaultLayout: "cover", endScreen: { seconds: 20, clear: { left: 0.5, top: 0.35 } }, grain: true, glow: true, coverZoom: [1, 1.08], titleSeconds: 4 });
  });
  it("names wrong YouTube settings", () => {
    const bad = { platforms: { standard: { ...presets.standard, length: { mode: "range", min: 45, max: 60, hardMax: 65 } }, youtube: { ...yt, youtube: { defaultLayout: "slides", coverZoom: [1, 2] } } } };
    expect(() => parsePresets(bad)).toThrow(/youtube.defaultLayout must be "cover", "stills" or "clips"[\s\S]*youtube.coverZoom must be \[from, to\] between 1 and 1.3/);
  });
});

describe("lyric sections (stills layout)", () => {
  it("from blank-line pauses and hooks: intro, verses, choruses, bridge, outro", () => {
    // verse / pause / chorus (hook) / pause / verse / pause / chorus / pause / unique block / pause / chorus
    const lines = [
      line("Verse a", 5000, 8000), line("Verse b", 8000, 11_000),
      line("Hold on", 12_000, 15_000, true), line("Through the night", 15_000, 18_000),
      line("Verse c", 19_000, 22_000), line("Verse d", 22_000, 25_000),
      line("Hold on", 26_000, 29_000, true), line("Through the night", 29_000, 32_000),
      line("Only once", 33_000, 36_000), line("Never again", 36_000, 39_000),
      line("Hold on", 40_000, 43_000, true), line("Through the night", 43_000, 46_000),
    ];
    const s = lyricSections(lines, 60_000);
    expect(s.map((x) => x.name)).toEqual(["intro", "verse 1", "chorus 1", "verse 2", "chorus 2", "bridge 1", "chorus 3", "outro"]);
    expect(s.map((x) => [x.start_ms, x.end_ms])).toEqual([[0, 5000], [5000, 12_000], [12_000, 19_000], [19_000, 26_000], [26_000, 33_000], [33_000, 40_000], [40_000, 46_000], [46_000, 60_000]]);
  });

  it("without pauses: a new section at each hook and where repeated lines change to unique ones", () => {
    const t = (k: number) => 4000 + 4000 * k;
    const texts = ["V1", "V2", "Hold on", "Night", "V3", "V4", "Hold on", "Night", "V5"];
    const lines = texts.map((x, k) => line(x, t(k), t(k + 1), x === "Hold on"));
    // The unique block after the second chorus is the bridge.
    expect(lyricSections(lines, t(9) + 1000).map((x) => x.name)).toEqual(["intro", "verse 1", "chorus 1", "verse 2", "chorus 2", "bridge 1"]);
  });

  it("without hook lines, a repeated block is a chorus", () => {
    const t = (k: number) => 1000 + 4000 * k;
    const texts = ["V1", "We run", "We fall", "V2", "We run", "We fall"];
    const s = lyricSections(texts.map((x, k) => line(x, t(k), t(k + 1))), t(6));
    expect(s.map((x) => x.kind)).toEqual(["verse", "chorus", "verse", "chorus"]);
  });
});

describe("stills.txt and crossfades", () => {
  const sections = lyricSections(
    [line("V", 5000, 9000), line("Hook", 10_000, 14_000, true), line("V2", 15_000, 19_000), line("Hook", 20_000, 24_000, true)],
    30_000,
  );

  it("exact name, then kind, then the next unused picture (never the same picture twice in a row)", () => {
    const { rules, warnings } = parseStills("# my stills\nchorus = 03_bride\nchorus 2 = 04_dance.jpg\nverse: nope\n");
    expect(warnings).toEqual(['stills.txt line 4 not understood: "verse: nope" (use e.g. "chorus = 03_bride.jpg")']);
    const images = ["01_sky.jpg", "02_road.jpg", "03_bride.jpg", "04_dance.jpg"];
    const a = assignStills(sections, images, rules);
    expect(sections.map((s) => s.name)).toEqual(["intro", "verse 1", "chorus 1", "verse 2", "chorus 2", "outro"]);
    expect(a.files).toEqual(["01_sky.jpg", "02_road.jpg", "03_bride.jpg", "01_sky.jpg", "04_dance.jpg", "02_road.jpg"]);
    expect(assignStills(sections, images, new Map([["bridge", "missing.jpg"]])).warnings[0]).toContain('"bridge = missing.jpg": no such horizontal picture');
  });

  it("each change is a 1.5 s crossfade centred on the downbeat nearest the section start", () => {
    const beats = grid(120, 80, 0); // bars at 0, 2, 4, ... s
    const t = stillTimings(sections, beats, 30, 0, 900);
    // verse 1 starts at 5 s -> nearest bar 4 s (frame 120): fade 45 frames centred on it.
    expect(t[1]).toEqual({ startFrame: 120 - 22, endFrame: 300 + 23, fadeFrames: 45 }); // chorus 1 at 10 s (frame 300)
    expect(stillOpacity(t[1], 120, false, false)).toBeCloseTo(23 / 45, 5);
    expect(stillOpacity(t[0], 120, true, false)).toBe(1); // the old one stays fully visible underneath (no dark dip)
    expect(stillOpacity(t[0], t[0].endFrame, true, false)).toBe(0); // gone once the new one has fully faded in
    expect(stillOpacity(t[0], 0, true, false)).toBe(1);
  });

  it("a video starting mid-song shows its first picture fully from frame 0 (no black)", () => {
    const beats = grid(120, 80, 0);
    const t = stillTimings(sections, beats, 30, 11_000, 300); // starts at 0:11
    const shown = visibleStills(t, 300);
    expect(shown.length).toBeGreaterThan(0);
    expect(stillOpacity(shown[0], 0, true, shown.length === 1)).toBe(1);
  });
});

describe("end screen, glow and captions", () => {
  it("in the last 20 s lyrics sit in a band above the bottom-right end-screen area, never inside it", () => {
    for (const layout of ["cover", "stills", "clips"] as const) {
      const area = lyricArea(yt, youtubeLyricSafeZone(layout, yt.safeZone), yt.lyricsAt);
      const end = endScreenLayout(yt, { ...yt.safeZone, top: 0.14 }, area, 30, 6000, yt.youtube!.endScreen);
      expect(end.fromFrame).toBe(6000 - 600);
      expect(end.clear).toEqual({ left: 960, top: 378, right: 1920, bottom: 1080 });
      for (const [lines, size] of [[1, 64], [2, 64], [3, 48]] as const) {
        const box = lyricBox(lines, size, end.lyricArea.right - end.lyricArea.left, 1.02, end.lyricArea);
        const overlaps = box.right > end.clear.left && box.bottom > end.clear.top;
        expect(overlaps, `${layout} ${lines} lines`).toBe(false);
        expect(box.top).toBeGreaterThanOrEqual(1080 * 0.14);
      }
    }
  });

  describe("the app chooses the end-screen window", () => {
    const area = lyricArea(yt, youtubeLyricSafeZone("cover", yt.safeZone), yt.lyricsAt);
    const safe = { ...yt.safeZone, top: 0.14 };
    const total = 6000; // 200 s at 30 fps
    const layout = (lastLyricEndFrame: number | null) => endScreenLayout(yt, safe, area, 30, total, { ...yt.youtube!.endScreen, lastLyricEndFrame });

    it("lyrics ending 30 s before the end: the full 20 s window", () => {
      const end = layout(total - 30 * 30);
      expect(end.fromFrame).toBe(total - 600);
      expect(end.seconds).toBe(20);
    });
    it("no lyrics: the full 20 s window", () => {
      expect(layout(null)).toMatchObject({ fromFrame: total - 600, seconds: 20 });
    });
    it("lyrics ending 12 s before the end: the window starts 0.5 s after the last line, ~11.5 s long", () => {
      const end = layout(total - 12 * 30);
      expect(end.fromFrame).toBeGreaterThanOrEqual(total - 12 * 30 + 15); // not before the last line has left + 0.5 s
      expect(end.fromFrame).toBeLessThanOrEqual(total - 11 * 30);
      expect(end.seconds).toBe(11);
      expect(end.fromFrame).toBe(total - end.seconds * 30); // consistent
    });
    it("lyrics ending 2 s before the end: a 5 s window", () => {
      const end = layout(total - 2 * 30);
      expect(end).toMatchObject({ fromFrame: total - 150, seconds: 5 });
    });
    it("lines before the glide are untouched; a line reaching the window glides to the band, then sits in it", () => {
      const end = layout(total - 2 * 30);
      const gone = endScreenAreaAt(area, end, end.fromFrame - 10, end.fromFrame - END_SCREEN_GLIDE_FRAMES); // ended before the glide
      expect(gone).toBe(area);
      const lineEnd = total - 60;
      expect(endScreenAreaAt(area, end, end.fromFrame - END_SCREEN_GLIDE_FRAMES, lineEnd).centerY).toBe(area.centerY);
      const mid = endScreenAreaAt(area, end, end.fromFrame - END_SCREEN_GLIDE_FRAMES / 2, lineEnd).centerY;
      const lo = Math.min(area.centerY, end.lyricArea.centerY);
      expect(mid).toBeGreaterThan(lo);
      expect(mid).toBeLessThan(Math.max(area.centerY, end.lyricArea.centerY));
      expect(endScreenAreaAt(area, end, end.fromFrame, lineEnd)).toBe(end.lyricArea);
      expect(endScreenAreaAt(area, end, total - 1, lineEnd)).toBe(end.lyricArea);
    });
    it("old manifests (no seconds): a line reaching into the window sits in the band, others in the normal area", () => {
      const old = { fromFrame: 5400, lyricArea: layout(null).lyricArea };
      expect(endScreenAreaAt(area, old, 100, 5500)).toBe(old.lyricArea);
      expect(endScreenAreaAt(area, old, 100, 5000)).toBe(area);
    });
    it("endScreenText: the length and start to set in YouTube Studio", () => {
      expect(endScreenText({ fromFrame: 221 * 30, seconds: 14 }, 30)).toBe("the last 14 s (from 3:41)");
    });
  });

  it("the cover layout keeps the lyrics right of the cover", () => {
    const area = lyricArea(yt, youtubeLyricSafeZone("cover", yt.safeZone), yt.lyricsAt);
    expect(area.left).toBeGreaterThan(1920 * 0.43);
  });

  it("the glow pulses on each beat and decays", () => {
    expect(beatPulse(100, [100, 115])).toBe(1);
    expect(beatPulse(106, [100, 115])).toBeCloseTo(Math.exp(-1), 5);
    expect(beatPulse(99, [100])).toBe(0);
  });

  it(".srt captions: numbered, hh:mm:ss,mmm times from the video's first frame", () => {
    expect(toSrt([{ text: "Hold on", startFrame: 0, endFrame: 45 }, { text: "Through the night", startFrame: 45, endFrame: 1_800_015 }, { text: "x", startFrame: 5, endFrame: 5 }], 30)).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\nHold on\n\n2\n00:00:01,500 --> 16:40:00,500\nThrough the night\n",
    );
  });
});

describe("cover -> stills -> clips", () => {
  it("falls back with a clear message", () => {
    expect(chooseLayout("cover", { cover: true, photos: 0, sources: 0 })).toEqual({ layout: "cover", message: null });
    expect(chooseLayout("cover", { cover: false, photos: 2, sources: 5 })).toEqual({
      layout: "stills",
      message: "cover layout: no cover (give --cover <image>, or put cover.jpg / cover.png next to the song): using the stills layout instead",
    });
    expect(chooseLayout("cover", { cover: false, photos: 0, sources: 3 }).layout).toBe("clips");
    expect(chooseLayout("stills", { cover: true, photos: 0, sources: 3 }).layout).toBe("clips");
    expect(chooseLayout("cover", { cover: false, photos: 0, sources: 0 }).layout).toBeNull();
  });
});

describe("short-form ends on beats (TikTok, Shorts)", () => {
  // 120 BPM: bars every 2 s, beats every 0.5 s. Lines are sung back to back (boundaries off the beat
  // grid), except gaps around chosen times: a gap holding only an off-bar beat can end the section
  // on a beat; a gap holding a bar can end it on a bar.
  const beats = grid(120, 400, 0);
  function song(gaps: number[]): SectionLine[] {
    const starts = [600, 3100, 6000]; // the hook starts on the bar at 6 s
    for (let t = 8430; t < 80_000; t += 2370) if (gaps.every((g) => Math.abs(t - g) > 1200)) starts.push(t % 500 === 0 ? t + 130 : t);
    for (const g of gaps) starts.push(g + 200);
    starts.sort((a, b) => a - b);
    return starts.map((start, k) => {
      const next = starts[k + 1] ?? start + 2400;
      const gap = gaps.find((g) => g + 200 === next);
      return { text: start === 6000 ? "Hold on to me" : `Line ${k + 1}`, start_ms: start, end_ms: next, sung_end_ms: gap !== undefined ? gap - 200 : next, isHook: start === 6000 };
    });
  }
  const run = (name: string, lines: SectionLine[]) => {
    const p = presets[name];
    const w = sectionWindow(p)!;
    return autoSection(lines, beats, {
      durationMs: 90_000, minMs: w.minMs, maxMs: w.maxMs, hardMaxMs: w.hardMaxMs, shortestMs: w.shortestMs, targetMs: w.targetMs, anchorMode: p.anchor, endOn: p.endOn,
    });
  };

  it("tiktok and shorts end cleanly on a beat inside the window; reels keeps bar ends", () => {
    expect([presets.tiktok.endOn, presets.shorts.endOn, presets.reels.endOn]).toEqual(["beat", "beat", "bar"]);
    const lines = song([28_500, 52_500]); // gaps around the off-bar beats 28.5 s and 52.5 s
    const expected: Record<string, number> = { tiktok: 28_500, shorts: 52_500 };
    for (const name of ["tiktok", "shorts"]) {
      const s = run(name, lines);
      expect(s.start_ms).toBe(6000);
      expect(s.end_ms).toBe(expected[name]);
      expect(s.cuts).toEqual([]);
      expect(s.reason).toContain("the first beat after");
    }
    const reels = run("reels", lines);
    expect(beats.find((b) => b.time_ms === reels.end_ms)?.is_downbeat).toBe(true); // reels never ends between bars
  });

  it("prefers a bar when one is clean in the window", () => {
    const s = run("tiktok", song([28_500, 30_000])); // the gap around 30 s holds a bar
    expect(s.end_ms).toBe(30_000);
    expect(s.reason).toContain("the first bar after");
  });
});

describe("5g.2b polish: cover sizes, motion, mood, logo, EP line", () => {
  it("cover layout sizes: active lyric +18%, next line +10%, cover +12%", () => {
    expect(COVER_TEXT_SCALE).toBeCloseTo(1.18, 5);
    expect(COVER_TEXT_SCALE * COVER_NEXT_LINE_SCALE).toBeCloseTo(0.55 * 1.1, 5); // next line, in px, +10%
    expect(COVER_HEIGHT_SHARE / 0.6).toBeCloseTo(1.12, 5);
    // The cover at its largest (zoom 1.08 + drift) stays clear of the lyrics column.
    const side = coverSide(yt);
    const right = 1920 * COVER_CENTRE_X + (side / 2) * 1.08 + side * COVER_DRIFT;
    expect(right).toBeLessThan(lyricArea(yt, youtubeLyricSafeZone("cover", yt.safeZone), yt.lyricsAt).left);
    expect(1920 * COVER_CENTRE_X - (side / 2) * 1.08 - side * COVER_DRIFT).toBeGreaterThan(0);
  });

  it("cover motion: zoom 1.00 -> 1.08 with a gentle drift; the background moves 30% the opposite way", () => {
    const drift = coverDrift(mulberry32(3), 726, COVER_DRIFT);
    expect(Math.max(Math.abs(drift.toX), Math.abs(drift.toY))).toBeLessThanOrEqual(726 * COVER_DRIFT);
    const cover = { zoomFrom: 1, zoomTo: 1.08, drift };
    expect(coverMotionAt(cover, 0, 0.3).zoom).toBe(1);
    expect(coverMotionAt(cover, 1, 0.3).zoom).toBeCloseTo(1.08, 10);
    for (const t of [0, 0.3, 0.7, 1]) {
      const m = coverMotionAt(cover, t, 0.3);
      expect(m.backgroundX).toBeCloseTo(-0.3 * m.x, 10);
      expect(m.backgroundY).toBeCloseTo(-0.3 * m.y, 10);
    }
    expect(presets.youtube.youtube?.coverZoom).toEqual([1, 1.08]);
  });

  it("section mood: warm on hooks, soft on verses, neutral on intro/outro; 2 s eased changes, never flashing", () => {
    const lines = [line("Verse a", 5000, 9000), line("Hook", 10_000, 14_000, true), line("Verse b", 15_000, 19_000), line("Hook", 20_000, 24_000, true)];
    const beats = grid(120, 80, 0);
    const segs = moodSegments(lyricSections(lines, 30_000), beats, 30, 0);
    expect(segs.map((x) => x.kind)).toEqual(["neutral", "verse", "hook", "verse", "hook", "neutral"]);
    expect(moodAt(30 * 12, segs, 30)).toEqual(MOOD_COLOURS.hook); // well inside the first chorus
    expect(moodAt(30 * 7, segs, 30)).toEqual(MOOD_COLOURS.verse);
    // Hook colour is lighter/warmer than the verse veil.
    expect(MOOD_COLOURS.hook[0]).toBeGreaterThan(MOOD_COLOURS.verse[0]);
    // Never flashing: from frame to frame the veil changes by at most a tiny step.
    let worst = 0;
    for (let f = 0; f < 900; f++) {
      const a = moodAt(f, segs, 30);
      const b = moodAt(f + 1, segs, 30);
      const lum = (c: number[]) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * c[3];
      worst = Math.max(worst, Math.abs(lum(a) - lum(b)), Math.abs(a[3] - b[3]));
    }
    expect(worst).toBeLessThan(1.5); // < 1.5 of 255 brightness per frame (a full change takes ~2 s)
    const change = segs[2].startFrame; // the chorus starts: halfway through a 60-frame blend there
    expect(moodAt(change - 31, segs, 30)).toEqual(MOOD_COLOURS.verse);
    expect(moodAt(change + 30, segs, 30)).toEqual(MOOD_COLOURS.hook);
  });

  it("logo: bottom right on YouTube, in the frame corner with a fixed margin, faded out (0.5 s) before the end-screen window", () => {
    const pos = logoPlacement(yt, "bottom-right", { width: 154, height: 62 });
    expect(pos).toEqual({ left: 1920 - 58 - 154, top: 1080 - 58 - 62 }); // 3% of the width
    expect(logoOpacity(1000, 1200, 15)).toBe(1);
    expect(logoOpacity(1192, 1200, 15)).toBeCloseTo(8 / 15, 5);
    expect(logoOpacity(1200, 1200, 15)).toBe(0);
    expect(logoOpacity(5000, null, 15)).toBe(1);
  });

  it("logo always anchored to a frame corner (never mid-frame, whatever the safe zones); QA catches anything else", () => {
    for (const name of ["standard", "reels", "tiktok", "shorts", "youtube"]) {
      const p = presets[name];
      for (const corner of ["auto", "top-left", "top-right", "bottom-left", "bottom-right"] as const) {
        const size = { width: 86, height: 35 };
        const { left, top } = logoPlacement(p, corner, size);
        const m = Math.round(p.width * 0.03);
        expect(left === m || left === p.width - m - size.width, `${name} ${corner}`).toBe(true);
        expect(top === m || top === p.height - m - size.height, `${name} ${corner}`).toBe(true);
        expect(logoCornerProblem(p, { left, top, ...size })).toBeNull();
      }
      expect(logoPlacement(p, "auto", { width: 86, height: 35 })).toEqual(logoPlacement(p, "bottom-right", { width: 86, height: 35 }));
    }
    // The old "auto" spot on Reels (inside the 35% bottom safe zone, on the subject) is now a QA failure.
    expect(logoCornerProblem(presets.reels, { left: 922, top: 1153, width: 86, height: 35 })).toMatch(/must sit in a frame corner, 32 px from both edges/);
  });
});
