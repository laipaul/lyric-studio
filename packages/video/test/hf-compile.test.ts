// The HyperFrames converter (Theme Engine v2 on HyperFrames, step 1): what it can draw (gaps), the clips at
// the plan's exact frames (start, offset, speed), dissolves and dips, our own fonts only (by our own family
// names, no generic family and no URL: HyperFrames never looks a font up), and the planner's word times.
import { describe, expect, it } from "vitest";

import { compileHyperframes, hfTiming, hyperframesGaps, SIMPLE_STYLE, type LyricVideoProps } from "../src";
import { FRAME_TEST_SHOTS, frameTestProps } from "../src/node";

const base = (extra: Partial<Omit<LyricVideoProps, "mediaBaseUrl">> = {}): Omit<LyricVideoProps, "mediaBaseUrl"> => ({ ...frameTestProps("clips/a.mp4"), ...extra });

describe("what the converter can draw", () => {
  it("clips, cuts, dissolves and dips: nothing missing", () => {
    expect(hyperframesGaps(base({ dips: [{ frame: 100, frames: 12 }] }))).toEqual([]);
  });

  it("anything else is listed in plain words (the video is then made by the current renderer)", () => {
    const props = base({
      lyrics: [{ text: "Hold on", startFrame: 0, endFrame: 30 }],
      lyricEffects: { verse: { name: "glide", intensity: "balanced" }, hook: { name: "karaoke-highlight", intensity: "balanced" }, accent: "#E8A3B5" },
      logo: { src: "brand/logo.png", left: 0, top: 0, width: 10, height: 10, goneAt: null },
      lyricBacking: true,
      shots: [{ ...base().shots[0], kind: "photo" }],
    });
    expect(hyperframesGaps(props)).toEqual(["the lyric effects (glide / karaoke-highlight)", "photos (Ken Burns)", "the logo", "the readability band"]);
    // The measurement's stand-in lyric look: the lyric effects are not counted.
    expect(hyperframesGaps(props, "all", { standInLyrics: true })).not.toContain("the lyric effects (glide / karaoke-highlight)");
  });
});

describe("the composition", () => {
  const props = base({
    shots: base().shots.map((s, i) => (i === 2 ? { ...s, dissolve: { before: 6, after: 9 }, tail: 0 } : s)),
    dips: [{ frame: 150, frames: 12 }],
    fonts: [{ family: "Cormorant Garamond", weight: 400, style: "normal", src: "_fonts/cormorant-garamond-latin-400-normal.woff2" }],
    style: { ...SIMPLE_STYLE, font: "Cormorant Garamond", weight: 400 },
    lyrics: [{ text: "Hold on to me", startFrame: 20, endFrame: 200, words: [{ text: "Hold", startFrame: 30, endFrame: 45 }, { text: "on", startFrame: 50, endFrame: 60 }, { text: "to", startFrame: 62, endFrame: 70 }, { text: "me", startFrame: 75, endFrame: 120 }] }],
  });
  const comp = compileHyperframes(props, { mode: "all" });

  it("each shot at its frames: start (a hair past the frame), offset into the clip, speed", () => {
    const videos = [...comp.html.matchAll(/<video id="s(\d+)"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)" data-media-start="([\d.]+)"(?: data-playback-rate="([\d.]+)")?/g)];
    expect(videos).toHaveLength(FRAME_TEST_SHOTS.length);
    for (const v of videos) {
      const i = Number(v[1]);
      const s = props.shots[i];
      const before = s.dissolve?.before ?? 0;
      // Read back at 30 fps, every number lands on its own frame (never the one before).
      expect(Math.floor(Number(v[2]) * 30)).toBe(s.start - before);
      expect(Math.floor(Number(v[4]) * 30)).toBe(s.clipStartFrame);
      expect(Math.round(Number(v[3]) * 30)).toBe(s.duration + before + (s.tail ?? 0));
      expect(Number(v[5] ?? 1)).toBe(s.playbackRate);
    }
    expect(comp.assets).toContainEqual({ src: "clips/a.mp4", dest: "assets/clips/a.mp4" });
  });

  it("a dissolve fades the shot in over the previous one; a dip is a black layer", () => {
    expect(comp.html).toContain('tl.fromTo("#s2", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.inOut" }');
    expect(comp.html).toMatch(/<div id="dip" class="clip"/);
  });

  it("fonts: our own file under our own name, no generic family, nothing from the web", () => {
    expect(comp.html).toContain('font-family: "vm Cormorant Garamond"; src: url("assets/fonts/cormorant-garamond-latin-400-normal.woff2")');
    expect(comp.html).not.toMatch(/https?:\/\//);
    for (const decl of comp.html.match(/font-family:[^;]+;/g) ?? []) expect(decl).not.toMatch(/\b(serif|sans-serif|monospace|cursive|system-ui)\b/);
  });

  it("the lyrics read the planner's word times (seconds from the first frame)", () => {
    expect(hfTiming(props)[0].words.map((w) => w.start)).toEqual([1, 1.666667, 2.066667, 2.5]);
    expect(compileHyperframes(props, { mode: "lyrics" }).html).not.toContain("<video");
  });
});
